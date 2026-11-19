#include "session.h"

#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "app.h"
#include "chunk_store.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"

#define NVS_NS "lc_sess"
#define PERSIST_EVERY 20u

static const char *TAG = "session";
static SemaphoreHandle_t s_lock;
static session_info_t s_cur;
static session_info_t s_prev;

void uuid_to_str(const uint8_t id[16], char out[37]) {
    snprintf(out, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", id[0], id[1], id[2],
             id[3], id[4], id[5], id[6], id[7], id[8], id[9], id[10], id[11], id[12], id[13], id[14], id[15]);
}

static int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

bool uuid_parse(const char *text, uint8_t out[16]) {
    if (text == NULL || strlen(text) != 36) return false;
    int byte = 0;
    for (int i = 0; i < 36 && byte < 16;) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (text[i] != '-') return false;
            i++;
            continue;
        }
        const int hi = hex_value(text[i]);
        const int lo = hex_value(text[i + 1]);
        if (hi < 0 || lo < 0) return false;
        out[byte++] = (uint8_t)((hi << 4) | lo);
        i += 2;
    }
    return byte == 16;
}

static void persist(const char *key, const session_info_t *s) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) != ESP_OK) return;
    if (nvs_set_blob(nvs, key, s, sizeof *s) == ESP_OK) nvs_commit(nvs);
    nvs_close(nvs);
}

static void load(const char *key, session_info_t *s) {
    memset(s, 0, sizeof *s);
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READONLY, &nvs) != ESP_OK) return;
    size_t len = sizeof *s;
    /* Firmware before the pause feature stored the struct without its last field. */
    const bool ok = nvs_get_blob(nvs, key, s, &len) == ESP_OK &&
                    (len == sizeof *s || len == offsetof(session_info_t, paused));
    if (!ok) memset(s, 0, sizeof *s);
    else if (len != sizeof *s) s->paused = false;
    nvs_close(nvs);
}

void session_preinit(void) {
    s_lock = xSemaphoreCreateMutex();
    memset(&s_cur, 0, sizeof s_cur);
    memset(&s_prev, 0, sizeof s_prev);
}

void session_init(void) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    load("cur", &s_cur);
    load("prev", &s_prev);
    if (s_cur.active && !s_cur.stopped) {
        const int64_t flash_max = chunk_store_max_seq(s_cur.id);
        int64_t last = (int64_t)s_cur.next_seq - 1;
        if (flash_max > last) last = flash_max;
        s_cur.stopped = true;
        s_cur.paused = false;
        s_cur.last_seq = (int32_t)last;
        s_cur.next_seq = (uint32_t)(last + 1);
        persist("cur", &s_cur);
        ESP_LOGW(TAG, "recovered session %s after reboot, last_seq=%ld", s_cur.id_str, (long)s_cur.last_seq);
    }
    xSemaphoreGive(s_lock);
}

session_info_t session_info(void) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const session_info_t copy = s_cur;
    xSemaphoreGive(s_lock);
    return copy;
}

session_info_t session_previous(void) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const session_info_t copy = s_prev;
    xSemaphoreGive(s_lock);
    return copy;
}

bool session_start(const char *assigned_lecture) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_cur.active && !s_cur.stopped) {
        xSemaphoreGive(s_lock);
        return false;
    }
    if (s_cur.active && s_cur.stopped) {
        /* Still finalising the last lecture: keep it in the previous slot so its stop is sent. */
        s_prev = s_cur;
        persist("prev", &s_prev);
    }
    memset(&s_cur, 0, sizeof s_cur);
    esp_fill_random(s_cur.id, sizeof s_cur.id);
    s_cur.id[6] = (uint8_t)((s_cur.id[6] & 0x0F) | 0x40); /* UUID v4 */
    s_cur.id[8] = (uint8_t)((s_cur.id[8] & 0x3F) | 0x80);
    uuid_to_str(s_cur.id, s_cur.id_str);
    s_cur.active = true;
    s_cur.last_seq = -1;
    s_cur.started_unix_ms = app_unix_ms();
    if (assigned_lecture != NULL && strlen(assigned_lecture) == 36) {
        strlcpy(s_cur.lecture_str, assigned_lecture, sizeof s_cur.lecture_str);
        s_cur.lecture_known = true;
    }
    persist("cur", &s_cur);
    xSemaphoreGive(s_lock);
    ESP_LOGI(TAG, "session %s started", s_cur.id_str);
    return true;
}

bool session_take_seq(uint32_t *seq, uint8_t session_id[16]) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const bool recording = s_cur.active && !s_cur.stopped && !s_cur.paused;
    if (recording) {
        *seq = s_cur.next_seq++;
        memcpy(session_id, s_cur.id, 16);
        if (s_cur.next_seq % PERSIST_EVERY == 0) persist("cur", &s_cur);
    }
    xSemaphoreGive(s_lock);
    return recording;
}

void session_stop(void) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_cur.active && !s_cur.stopped) {
        s_cur.stopped = true;
        s_cur.paused = false;
        s_cur.last_seq = (int32_t)s_cur.next_seq - 1;
        persist("cur", &s_cur);
    }
    xSemaphoreGive(s_lock);
}

bool session_set_paused(bool paused) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const bool changed = s_cur.active && !s_cur.stopped && s_cur.paused != paused;
    if (changed) {
        s_cur.paused = paused;
        persist("cur", &s_cur);
    }
    xSemaphoreGive(s_lock);
    if (changed) ESP_LOGI(TAG, "session %s %s", s_cur.id_str, paused ? "paused" : "resumed");
    return changed;
}

void session_set_lecture(const char *lecture_id) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_cur.active && strlen(lecture_id) == 36) {
        strlcpy(s_cur.lecture_str, lecture_id, sizeof s_cur.lecture_str);
        s_cur.lecture_known = true;
        persist("cur", &s_cur);
    }
    xSemaphoreGive(s_lock);
}

void session_confirm_stopped(const uint8_t id[16]) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_cur.active && s_cur.stopped && memcmp(s_cur.id, id, 16) == 0) {
        memset(&s_cur, 0, sizeof s_cur);
        persist("cur", &s_cur);
    } else if (s_prev.active && memcmp(s_prev.id, id, 16) == 0) {
        memset(&s_prev, 0, sizeof s_prev);
        persist("prev", &s_prev);
    }
    xSemaphoreGive(s_lock);
}
