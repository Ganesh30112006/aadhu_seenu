/*
 * Recording session (D3): a device-generated UUID created when Start is pressed, so a lecture can
 * begin offline. Persisted in NVS so an unfinished session survives a reboot.
 * Two slots: `current`, and `previous` (stopped but not yet confirmed by the server).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool active;
    bool stopped;
    uint8_t id[16];
    char id_str[37];
    bool lecture_known;
    char lecture_str[37];
    uint32_t next_seq;
    int32_t last_seq; /* valid when stopped; -1 = no chunk */
    uint64_t started_unix_ms;
    bool paused; /* capture suspended (Pause button or web command). Last field: older NVS blobs
                    without it still load (see load()). */
} session_info_t;

/* Creates the lock and an empty state; called from app_init() before any task starts. */
void session_preinit(void);

/* Loads both slots. A session that was recording when power was lost is finalised with
 * last_seq = max(persisted, highest seq in the flash log) (server also uses its max stored seq). */
void session_init(void);

session_info_t session_info(void);
session_info_t session_previous(void);

/* Starts a new session (returns false if one is already recording). */
bool session_start(const char *assigned_lecture_or_empty);

/* Allocates the next seq for a captured chunk; false if no session is recording (atomic with
 * stop, so no chunk can get a seq beyond last_seq). Persists progress every 20 chunks. */
bool session_take_seq(uint32_t *seq, uint8_t session_id[16]);

void session_stop(void);

/* Pauses/resumes capture of the recording session. Returns true if the state changed.
 * While paused no seq is handed out, so lecture time excludes the pause. */
bool session_set_paused(bool paused);
void session_set_lecture(const char *lecture_id);

/* Server confirmed `stop` for this session id: forget it. */
void session_confirm_stopped(const uint8_t id[16]);

void uuid_to_str(const uint8_t id[16], char out[37]);
bool uuid_parse(const char *text, uint8_t out[16]);
