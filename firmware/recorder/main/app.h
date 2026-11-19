/*
 * Shared device state. Facts (wifi up, server up, recording, …) are set by the tasks that own
 * them; the visible state (READY, RECORDING, …) is derived from those facts in one place
 * (app_state_derive), so the OLED, LED and `status` message can never disagree.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    ST_BOOT = 0,
    ST_WIFI_CONNECTING,
    ST_SERVER_CONNECTING,
    ST_READY,
    ST_RECORDING,
    ST_RECORDING_OFFLINE,
    ST_PAUSED,
    ST_SYNCING,
    ST_FINALIZING,
    ST_ERROR,
} device_state_t;

typedef struct {
    volatile bool wifi_up;
    volatile bool server_up;
    volatile bool time_synced;
    volatile bool buffer_full;     /* PSRAM and flash full: audio not being saved */
    volatile bool mic_silent;      /* vad_enabled and no speech energy for 60 s */
    volatile bool fatal;           /* e.g. auth rejected */
    volatile int8_t wifi_rssi;
    volatile uint16_t level_db10;  /* audio level, tenths of dB above -90 dBFS (0..900) */
    volatile uint32_t backlog;     /* chunks pending for the current session, excluding live */
    volatile uint32_t pending_all; /* all un-ACKed chunks (any session) */
    volatile uint8_t psram_pct;
    volatile uint8_t flash_pct;
    volatile float gain;           /* linear, from server config */
    volatile bool vad_enabled;
} app_facts_t;

extern app_facts_t g_facts;

void app_init(void);

/* The single derivation of the visible state from facts + session. */
device_state_t app_state_derive(void);
const char *app_state_name(device_state_t state);

/* Strings shown on the OLED (copied under a lock). */
void app_set_error(const char *text);
void app_get_error(char *out, size_t len);
void app_set_assigned(const char *lecture_id, const char *title);
bool app_get_assigned(char *lecture_id, size_t id_len, char *title, size_t title_len);
void app_clear_assigned(void);

uint32_t app_now_ms(void);
/* Unix ms if SNTP has synced, else 0 (per protocol). */
uint64_t app_unix_ms(void);
