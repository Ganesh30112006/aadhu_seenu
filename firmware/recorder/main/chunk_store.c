#include "chunk_store.h"

#include <string.h>

#include "app.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lc_adpcm.h"
#include "lc_flashlog.h"
#include "lc_ring.h"
#include "session.h"

static const char *TAG = "chunks";

static const esp_partition_t *s_part;
static lc_ring_t s_ring;
static lc_slot_t *s_slots;
static lc_flashlog_t s_log;
static lc_flash_slot_t *s_log_index;
static SemaphoreHandle_t s_ring_lock;
static SemaphoreHandle_t s_flash_lock;
static size_t s_flash_in_flight;
static uint32_t s_dropped;

/* Last ACK per session, re-applied to records that reach flash after the ACK arrived. */
static uint8_t s_ack_session[16];
static lc_ack_t s_last_ack;

static int part_read(void *ctx, size_t off, void *dst, size_t len) {
    return esp_partition_read((const esp_partition_t *)ctx, off, dst, len) == ESP_OK ? 0 : -1;
}
static int part_write(void *ctx, size_t off, const void *src, size_t len) {
    return esp_partition_write((const esp_partition_t *)ctx, off, src, len) == ESP_OK ? 0 : -1;
}
static int part_erase(void *ctx, size_t off) {
    return esp_partition_erase_range((const esp_partition_t *)ctx, off, LC_FLASHLOG_SECTOR) == ESP_OK ? 0 : -1;
}

esp_err_t chunk_store_init(void) {
    s_ring_lock = xSemaphoreCreateMutex();
    s_flash_lock = xSemaphoreCreateMutex();
    lc_ack_reset(&s_last_ack);
    const size_t slots = CONFIG_LC_RING_SLOTS;
    s_slots = heap_caps_calloc(slots, sizeof(lc_slot_t), MALLOC_CAP_SPIRAM);
    uint8_t *data = heap_caps_malloc(slots * LC_PCM_CHUNK_BYTES, MALLOC_CAP_SPIRAM);
    if (s_slots == NULL || data == NULL) {
        ESP_LOGE(TAG, "PSRAM allocation failed (%u slots)", (unsigned)slots);
        return ESP_ERR_NO_MEM;
    }
    lc_ring_init(&s_ring, s_slots, data, slots, LC_PCM_CHUNK_BYTES);

    s_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "audiobuf");
    if (s_part == NULL) {
        ESP_LOGE(TAG, "audiobuf partition missing (flash partitions.csv)");
        return ESP_ERR_NOT_FOUND;
    }
    const size_t sectors = s_part->size / LC_FLASHLOG_SECTOR;
    s_log_index = heap_caps_calloc(sectors, sizeof(lc_flash_slot_t), MALLOC_CAP_SPIRAM);
    if (s_log_index == NULL) return ESP_ERR_NO_MEM;
    const lc_flash_ops_t ops = {(void *)s_part, part_read, part_write, part_erase};
    lc_flashlog_mount(&s_log, &ops, s_log_index, sectors);
    ESP_LOGI(TAG, "ring %u slots (%u s), flash log %u sectors (%u s), %u pending after boot", (unsigned)slots,
             (unsigned)(slots / 2), (unsigned)sectors, (unsigned)(sectors / 2), (unsigned)s_log.pending);
    return ESP_OK;
}

int64_t chunk_store_max_seq(const uint8_t session_id[16]) {
    int64_t best = -1;
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    for (size_t s = 0; s < s_log.sector_count; s++) {
        const lc_flash_slot_t *slot = &s_log_index[s];
        if (slot->write_counter != 0 && memcmp(slot->session_id, session_id, 16) == 0 && (int64_t)slot->seq > best) {
            best = slot->seq;
        }
    }
    xSemaphoreGive(s_flash_lock);
    return best;
}

bool chunk_store_push(const uint8_t session_id[16], uint32_t seq, uint64_t capture_unix_ms, const int16_t *pcm,
                      size_t samples) {
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    const bool ok = lc_ring_push(&s_ring, session_id, seq, (uint64_t)seq * LC_SAMPLES_PER_CHUNK, capture_unix_ms,
                                 app_now_ms(), (const uint8_t *)pcm, (uint16_t)(samples * 2));
    xSemaphoreGive(s_ring_lock);
    if (!ok) {
        s_dropped++;
        g_facts.buffer_full = true;
        ESP_LOGE(TAG, "buffers full: chunk %lu not saved (%lu dropped)", (unsigned long)seq, (unsigned long)s_dropped);
    }
    return ok;
}

static int newest_seq_index(const uint8_t session_id[16]) {
    int newest = -1;
    for (size_t i = 0; i < s_ring.slot_count; i++) {
        const lc_slot_t *slot = &s_ring.slots[i];
        if (slot->state == LC_SLOT_FREE || memcmp(slot->session_id, session_id, 16) != 0) continue;
        if (newest < 0 || slot->seq > s_ring.slots[newest].seq) newest = (int)i;
    }
    return newest;
}

size_t chunk_store_next_frame(const uint8_t session_id[16], uint8_t *frame, size_t cap, chunk_ref_t *ref) {
    if (cap < CHUNK_FRAME_MAX) return 0;
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    const int ring_idx = lc_ring_next_to_send(&s_ring, session_id);
    const bool live = ring_idx >= 0 && ring_idx == newest_seq_index(session_id);
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    const int flash_idx = lc_flashlog_oldest_unsent(&s_log, session_id);
    bool use_ring = ring_idx >= 0;
    if (ring_idx >= 0 && flash_idx >= 0 && !live) {
        use_ring = s_ring.slots[ring_idx].seq < s_log_index[flash_idx].seq; /* backlog: lowest seq first */
    }
    size_t len = 0;
    if (use_ring) {
        const lc_slot_t *slot = &s_ring.slots[ring_idx];
        const lc_frame_header_t h = {LC_CODEC_PCM16, slot->seq, slot->sample_offset, slot->capture_unix_ms, slot->len};
        lc_frame_encode_header(&h, frame);
        memcpy(frame + LC_FRAME_HEADER_LEN, lc_ring_slot_data(&s_ring, ring_idx), slot->len);
        len = LC_FRAME_HEADER_LEN + slot->len;
        *ref = (chunk_ref_t){.from_flash = false, .index = ring_idx, .seq = slot->seq};
    } else if (flash_idx >= 0) {
        lc_flash_record_t rec;
        if (lc_flashlog_read(&s_log, flash_idx, &rec, frame + LC_FRAME_HEADER_LEN) == 0) {
            const lc_frame_header_t h = {rec.codec, rec.seq, rec.sample_offset, rec.capture_unix_ms, rec.payload_len};
            lc_frame_encode_header(&h, frame);
            len = LC_FRAME_HEADER_LEN + rec.payload_len;
            *ref = (chunk_ref_t){.from_flash = true, .index = flash_idx, .seq = rec.seq};
        } else {
            lc_flashlog_mark_sent(&s_log, flash_idx); /* unreadable record: skip until next connection */
        }
    }
    xSemaphoreGive(s_flash_lock);
    xSemaphoreGive(s_ring_lock);
    return len;
}

void chunk_store_mark_sent(const chunk_ref_t *ref) {
    if (ref->from_flash) {
        xSemaphoreTake(s_flash_lock, portMAX_DELAY);
        lc_flashlog_mark_sent(&s_log, ref->index);
        s_flash_in_flight++;
        xSemaphoreGive(s_flash_lock);
    } else {
        xSemaphoreTake(s_ring_lock, portMAX_DELAY);
        if (s_ring.slots[ref->index].seq == ref->seq) lc_ring_mark_sent(&s_ring, ref->index);
        xSemaphoreGive(s_ring_lock);
    }
}

void chunk_store_apply_ack(const uint8_t session_id[16], const lc_ack_t *ack) {
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    lc_ring_apply_ack(&s_ring, session_id, ack);
    memcpy(s_ack_session, session_id, 16);
    s_last_ack = *ack;
    if (lc_ring_usage_pct(&s_ring) < 90) g_facts.buffer_full = false;
    xSemaphoreGive(s_ring_lock);
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    const size_t freed = lc_flashlog_apply_ack(&s_log, session_id, ack);
    s_flash_in_flight = freed >= s_flash_in_flight ? 0 : s_flash_in_flight - freed;
    xSemaphoreGive(s_flash_lock);
}

void chunk_store_requeue(void) {
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    lc_ring_requeue_sent(&s_ring);
    xSemaphoreGive(s_ring_lock);
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    lc_flashlog_requeue_sent(&s_log);
    s_flash_in_flight = 0;
    xSemaphoreGive(s_flash_lock);
}

size_t chunk_store_pending(const uint8_t session_id[16]) {
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    size_t n = lc_ring_count_session(&s_ring, session_id);
    xSemaphoreGive(s_ring_lock);
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    n += lc_flashlog_pending_for(&s_log, session_id);
    xSemaphoreGive(s_flash_lock);
    return n;
}

size_t chunk_store_in_flight(void) {
    size_t n = 0;
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    for (size_t i = 0; i < s_ring.slot_count; i++) n += s_ring.slots[i].state == LC_SLOT_SENT ? 1 : 0;
    xSemaphoreGive(s_ring_lock);
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    n += s_flash_in_flight;
    xSemaphoreGive(s_flash_lock);
    return n;
}

bool chunk_store_other_session(const uint8_t *current, uint8_t session_id[16], char lecture_id[37], bool *lecture_known) {
    bool found = false;
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    int best = -1;
    for (size_t s = 0; s < s_log.sector_count; s++) {
        const lc_flash_slot_t *slot = &s_log_index[s];
        if (!slot->pending || (current != NULL && memcmp(slot->session_id, current, 16) == 0)) continue;
        if (best < 0 || slot->write_counter < s_log_index[best].write_counter) best = (int)s;
    }
    static uint8_t payload[LC_FLASHLOG_MAX_PAYLOAD];
    lc_flash_record_t rec;
    if (best >= 0 && lc_flashlog_read(&s_log, best, &rec, payload) == 0) {
        memcpy(session_id, rec.session_id, 16);
        *lecture_known = rec.lecture_known;
        if (rec.lecture_known) uuid_to_str(rec.lecture_id, lecture_id);
        else lecture_id[0] = '\0';
        found = true;
    }
    xSemaphoreGive(s_flash_lock);
    return found;
}

/* ── spill task ─────────────────────────────────────────────────────────── */

static void refresh_facts(const session_info_t *cur) {
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    const unsigned psram = lc_ring_usage_pct(&s_ring);
    const size_t ring_cur = cur->active ? lc_ring_count_session(&s_ring, cur->id) : 0;
    const size_t ring_all = s_ring.used;
    xSemaphoreGive(s_ring_lock);
    xSemaphoreTake(s_flash_lock, portMAX_DELAY);
    const unsigned flash = lc_flashlog_usage_pct(&s_log);
    const size_t flash_cur = cur->active ? lc_flashlog_pending_for(&s_log, cur->id) : 0;
    const size_t flash_all = s_log.pending;
    xSemaphoreGive(s_flash_lock);
    g_facts.psram_pct = (uint8_t)psram;
    g_facts.flash_pct = (uint8_t)flash;
    g_facts.backlog = (uint32_t)(ring_cur + flash_cur);
    g_facts.pending_all = (uint32_t)(ring_all + flash_all);
}

static void spill_task(void *arg) {
    (void)arg;
    int16_t *pcm = heap_caps_malloc(LC_PCM_CHUNK_BYTES, MALLOC_CAP_SPIRAM);
    uint8_t *adpcm = heap_caps_malloc(LC_ADPCM_CHUNK_BYTES, MALLOC_CAP_SPIRAM);
    configASSERT(pcm != NULL && adpcm != NULL);
    uint32_t last_refresh = 0;
    for (;;) {
        const session_info_t cur = session_info();
        const bool recording = cur.active && !cur.stopped;
        lc_flash_record_t rec = {0};
        int idx;
        uint16_t len = 0;

        xSemaphoreTake(s_ring_lock, portMAX_DELAY);
        idx = lc_ring_pick_spill(&s_ring, cur.active ? cur.id : NULL, app_now_ms(), !g_facts.server_up,
                                 CONFIG_LC_OFFLINE_SPILL_AGE_MS, CONFIG_LC_SPILL_PRESSURE_PCT);
        if (idx >= 0) {
            const lc_slot_t *slot = &s_ring.slots[idx];
            memcpy(rec.session_id, slot->session_id, 16);
            rec.seq = slot->seq;
            rec.sample_offset = slot->sample_offset;
            rec.capture_unix_ms = slot->capture_unix_ms;
            len = slot->len;
            memcpy(pcm, lc_ring_slot_data(&s_ring, idx), len);
        }
        xSemaphoreGive(s_ring_lock);

        if (idx >= 0) {
            rec.codec = LC_CODEC_ADPCM;
            if (memcmp(rec.session_id, cur.id, 16) == 0 && cur.lecture_known) {
                rec.lecture_known = uuid_parse(cur.lecture_str, rec.lecture_id);
            }
            rec.payload_len = (uint16_t)lc_adpcm_encode(pcm, len / 2, adpcm);
            xSemaphoreTake(s_flash_lock, portMAX_DELAY);
            const int rc = lc_flashlog_append(&s_log, &rec, adpcm);
            if (rc == 0 && memcmp(s_ack_session, rec.session_id, 16) == 0) {
                lc_flashlog_apply_ack(&s_log, rec.session_id, &s_last_ack); /* acked while spilling */
            }
            xSemaphoreGive(s_flash_lock);
            if (rc == 0) {
                xSemaphoreTake(s_ring_lock, portMAX_DELAY);
                const lc_slot_t *slot = &s_ring.slots[idx];
                if (slot->state != LC_SLOT_FREE && slot->seq == rec.seq &&
                    memcmp(slot->session_id, rec.session_id, 16) == 0) {
                    lc_ring_free_slot(&s_ring, idx);
                }
                xSemaphoreGive(s_ring_lock);
            } else {
                vTaskDelay(pdMS_TO_TICKS(200)); /* flash full: keep the chunk in PSRAM */
            }
        }
        const uint32_t now = app_now_ms();
        if (now - last_refresh >= 250) {
            refresh_facts(&cur);
            last_refresh = now;
        }
        if (idx < 0) vTaskDelay(pdMS_TO_TICKS(recording ? 50 : 200));
    }
}

void chunk_store_start_spill_task(void) {
    xTaskCreatePinnedToCore(spill_task, "spill", 6144, NULL, 4, NULL, 0);
}
