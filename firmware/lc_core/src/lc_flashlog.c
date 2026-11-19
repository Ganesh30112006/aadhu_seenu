#include "lc_flashlog.h"

#include <string.h>

static const uint8_t MAGIC[4] = {'L', 'C', 'F', 'L'};

uint32_t lc_crc32(const uint8_t *data, size_t len) {
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(crc & 1u)));
    }
    return ~crc;
}

static void put32(uint8_t *p, uint32_t v) {
    for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i));
}
static void put64(uint8_t *p, uint64_t v) {
    for (int i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (8 * i));
}
static uint32_t get32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t get64(const uint8_t *p) {
    return (uint64_t)get32(p) | ((uint64_t)get32(p + 4) << 32);
}

static void encode_header(uint8_t h[LC_FLASHLOG_HEADER], const lc_flash_record_t *r, uint32_t counter,
                          uint32_t payload_crc) {
    memset(h, 0, LC_FLASHLOG_HEADER);
    memcpy(h, MAGIC, 4);
    put32(h + 4, counter);
    memcpy(h + 8, r->session_id, 16);
    memcpy(h + 24, r->lecture_id, 16);
    put32(h + 40, r->seq);
    put64(h + 44, r->sample_offset);
    put64(h + 52, r->capture_unix_ms);
    h[60] = r->codec;
    h[61] = r->lecture_known ? 1 : 0;
    h[62] = (uint8_t)(r->payload_len & 0xFF);
    h[63] = (uint8_t)(r->payload_len >> 8);
    put32(h + 64, payload_crc);
    put32(h + 68, lc_crc32(h, 68));
}

static bool decode_header(const uint8_t h[LC_FLASHLOG_HEADER], lc_flash_record_t *r, uint32_t *counter,
                          uint32_t *payload_crc) {
    if (memcmp(h, MAGIC, 4) != 0) return false;
    if (get32(h + 68) != lc_crc32(h, 68)) return false;
    *counter = get32(h + 4);
    memcpy(r->session_id, h + 8, 16);
    memcpy(r->lecture_id, h + 24, 16);
    r->seq = get32(h + 40);
    r->sample_offset = get64(h + 44);
    r->capture_unix_ms = get64(h + 52);
    r->codec = h[60];
    r->lecture_known = (h[61] & 1) != 0;
    r->payload_len = (uint16_t)(h[62] | (h[63] << 8));
    *payload_crc = get32(h + 64);
    return r->payload_len <= LC_FLASHLOG_MAX_PAYLOAD && *counter != 0;
}

int lc_flashlog_mount(lc_flashlog_t *log, const lc_flash_ops_t *ops, lc_flash_slot_t *index, size_t sector_count) {
    static uint8_t payload[LC_FLASHLOG_MAX_PAYLOAD];
    log->ops = *ops;
    log->index = index;
    log->sector_count = sector_count;
    log->head = 0;
    log->next_counter = 1;
    log->pending = 0;
    uint32_t newest = 0;
    for (size_t s = 0; s < sector_count; s++) {
        lc_flash_slot_t *slot = &index[s];
        memset(slot, 0, sizeof(*slot));
        uint8_t header[LC_FLASHLOG_HEADER];
        const size_t base = s * LC_FLASHLOG_SECTOR;
        if (ops->read(ops->ctx, base, header, sizeof header) != 0) continue;
        lc_flash_record_t record;
        uint32_t counter = 0;
        uint32_t payload_crc = 0;
        if (!decode_header(header, &record, &counter, &payload_crc)) continue;
        if (ops->read(ops->ctx, base + LC_FLASHLOG_HEADER, payload, record.payload_len) != 0) continue;
        if (lc_crc32(payload, record.payload_len) != payload_crc) continue;
        uint8_t ack_word[4];
        if (ops->read(ops->ctx, base + LC_FLASHLOG_ACK_OFFSET, ack_word, 4) != 0) continue;
        slot->write_counter = counter;
        slot->seq = record.seq;
        memcpy(slot->session_id, record.session_id, 16);
        slot->pending = get32(ack_word) == 0xFFFFFFFFu;
        if (slot->pending) log->pending++;
        if (counter >= newest) {
            newest = counter;
            log->head = (s + 1) % sector_count;
        }
    }
    log->next_counter = newest + 1;
    return 0;
}

int lc_flashlog_append(lc_flashlog_t *log, const lc_flash_record_t *record, const uint8_t *payload) {
    if (record->payload_len > LC_FLASHLOG_MAX_PAYLOAD || log->sector_count == 0) return -1;
    /* Find the next sector at/after head that is not pending (never overwrite unsent audio). */
    size_t sector = log->head;
    size_t tried = 0;
    while (log->index[sector].pending) {
        if (++tried >= log->sector_count) return -1;
        sector = (sector + 1) % log->sector_count;
    }
    const size_t base = sector * LC_FLASHLOG_SECTOR;
    if (log->ops.erase_sector(log->ops.ctx, base) != 0) return -1;
    uint8_t header[LC_FLASHLOG_HEADER];
    encode_header(header, record, log->next_counter, lc_crc32(payload, record->payload_len));
    /* Payload first, header last: an interrupted write never looks valid. */
    if (log->ops.write(log->ops.ctx, base + LC_FLASHLOG_HEADER, payload, record->payload_len) != 0) return -1;
    if (log->ops.write(log->ops.ctx, base, header, sizeof header) != 0) return -1;
    lc_flash_slot_t *slot = &log->index[sector];
    slot->write_counter = log->next_counter;
    slot->seq = record->seq;
    memcpy(slot->session_id, record->session_id, 16);
    slot->pending = true;
    slot->sent = false;
    log->next_counter++;
    log->pending++;
    log->head = (sector + 1) % log->sector_count;
    return 0;
}

size_t lc_flashlog_apply_ack(lc_flashlog_t *log, const uint8_t session_id[16], const lc_ack_t *ack) {
    static const uint8_t zero[4] = {0, 0, 0, 0};
    size_t count = 0;
    for (size_t s = 0; s < log->sector_count; s++) {
        lc_flash_slot_t *slot = &log->index[s];
        if (!slot->pending || memcmp(slot->session_id, session_id, 16) != 0) continue;
        if (!lc_ack_covers(ack, slot->seq)) continue;
        if (log->ops.write(log->ops.ctx, s * LC_FLASHLOG_SECTOR + LC_FLASHLOG_ACK_OFFSET, zero, 4) != 0) continue;
        slot->pending = false;
        slot->sent = false;
        log->pending--;
        count++;
    }
    return count;
}

int lc_flashlog_oldest_unsent(const lc_flashlog_t *log, const uint8_t session_id[16]) {
    int best = -1;
    for (size_t s = 0; s < log->sector_count; s++) {
        const lc_flash_slot_t *slot = &log->index[s];
        if (!slot->pending || slot->sent || memcmp(slot->session_id, session_id, 16) != 0) continue;
        if (best < 0 || slot->seq < log->index[best].seq) best = (int)s;
    }
    return best;
}

int lc_flashlog_oldest_pending(const lc_flashlog_t *log) {
    int best = -1;
    for (size_t s = 0; s < log->sector_count; s++) {
        const lc_flash_slot_t *slot = &log->index[s];
        if (!slot->pending) continue;
        if (best < 0 || slot->write_counter < log->index[best].write_counter) best = (int)s;
    }
    return best;
}

int lc_flashlog_read(const lc_flashlog_t *log, int sector, lc_flash_record_t *record, uint8_t *payload) {
    if (sector < 0 || (size_t)sector >= log->sector_count) return -1;
    const size_t base = (size_t)sector * LC_FLASHLOG_SECTOR;
    uint8_t header[LC_FLASHLOG_HEADER];
    if (log->ops.read(log->ops.ctx, base, header, sizeof header) != 0) return -1;
    uint32_t counter = 0;
    uint32_t payload_crc = 0;
    if (!decode_header(header, record, &counter, &payload_crc)) return -1;
    if (log->ops.read(log->ops.ctx, base + LC_FLASHLOG_HEADER, payload, record->payload_len) != 0) return -1;
    return lc_crc32(payload, record->payload_len) == payload_crc ? 0 : -1;
}

void lc_flashlog_mark_sent(lc_flashlog_t *log, int sector) {
    if (sector >= 0 && (size_t)sector < log->sector_count) log->index[sector].sent = true;
}

void lc_flashlog_requeue_sent(lc_flashlog_t *log) {
    for (size_t s = 0; s < log->sector_count; s++) log->index[s].sent = false;
}

size_t lc_flashlog_pending_for(const lc_flashlog_t *log, const uint8_t session_id[16]) {
    size_t count = 0;
    for (size_t s = 0; s < log->sector_count; s++) {
        if (log->index[s].pending && memcmp(log->index[s].session_id, session_id, 16) == 0) count++;
    }
    return count;
}

unsigned lc_flashlog_usage_pct(const lc_flashlog_t *log) {
    if (log->sector_count == 0) return 100;
    return (unsigned)((log->pending * 100) / log->sector_count);
}
