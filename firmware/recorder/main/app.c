#include "app.h"

#include <string.h>
#include <sys/time.h>

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "session.h"

#define LIVE_BACKLOG_TOLERANCE 4 /* un-ACKed chunks (2 s) still counted as "live" (RTT + ACK batching) */

app_facts_t g_facts;

static SemaphoreHandle_t s_lock;
static char s_error[40];
static char s_assigned_id[37];
static char s_assigned_title[64];

void app_init(void) {
    memset(&g_facts, 0, sizeof g_facts);
    g_facts.gain = 4.0f;
    g_facts.vad_enabled = true;
    s_lock = xSemaphoreCreateMutex();
    session_preinit();
}

device_state_t app_state_derive(void) {
    const session_info_t s = session_info();
    /* Recording always wins: the red LED must be visible whenever audio is being captured,
     * even if the device cannot reach the server (e.g. not provisioned). */
    if (s.active && !s.stopped) {
        if (s.paused) return ST_PAUSED;
        if (!g_facts.server_up) return ST_RECORDING_OFFLINE;
        return g_facts.backlog > LIVE_BACKLOG_TOLERANCE ? ST_SYNCING : ST_RECORDING;
    }
    if (g_facts.fatal) return ST_ERROR;
    if (s.active && s.stopped) return ST_FINALIZING;
    if (!g_facts.wifi_up) return ST_WIFI_CONNECTING;
    if (!g_facts.server_up) return ST_SERVER_CONNECTING;
    if (g_facts.pending_all > 0) return ST_SYNCING; /* backlog of an earlier session */
    return ST_READY;
}

const char *app_state_name(device_state_t state) {
    /* Same order as device_state_t; names match contracts/schemas/device-control.schema.json. */
    static const char *const NAMES[] = {"BOOT",   "WIFI_CONNECTING", "SERVER_CONNECTING", "READY",
                                        "RECORDING", "RECORDING_OFFLINE", "PAUSED",       "SYNCING",
                                        "FINALIZING", "ERROR"};
    return (unsigned)state < sizeof NAMES / sizeof NAMES[0] ? NAMES[state] : "ERROR";
}

void app_set_error(const char *text) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    strlcpy(s_error, text, sizeof s_error);
    xSemaphoreGive(s_lock);
}

void app_get_error(char *out, size_t len) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    strlcpy(out, s_error, len);
    xSemaphoreGive(s_lock);
}

void app_set_assigned(const char *lecture_id, const char *title) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    strlcpy(s_assigned_id, lecture_id, sizeof s_assigned_id);
    strlcpy(s_assigned_title, title, sizeof s_assigned_title);
    xSemaphoreGive(s_lock);
}

bool app_get_assigned(char *lecture_id, size_t id_len, char *title, size_t title_len) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const bool has = s_assigned_id[0] != '\0';
    if (lecture_id != NULL) strlcpy(lecture_id, s_assigned_id, id_len);
    if (title != NULL) strlcpy(title, s_assigned_title, title_len);
    xSemaphoreGive(s_lock);
    return has;
}

void app_clear_assigned(void) {
    app_set_assigned("", "");
}

uint32_t app_now_ms(void) {
    return (uint32_t)(esp_timer_get_time() / 1000);
}

uint64_t app_unix_ms(void) {
    if (!g_facts.time_synced) return 0;
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)tv.tv_sec * 1000u + (uint64_t)tv.tv_usec / 1000u;
}
