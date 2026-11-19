/*
 * One buffer, one mechanism (brief §2): every chunk lives in the PSRAM ring or the flash log
 * until an ACK covers it. Live streaming and offline sync are the same code path.
 *
 * Locks: `ring` (fast, shared with the audio task) and `flash` (slow: erase/write). The audio task
 * only ever takes the ring lock, so a flash erase can never block audio capture. When both are
 * needed they are taken in the order ring → flash.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "lc_ack.h"
#include "lc_frame.h"

#define CHUNK_FRAME_MAX (LC_FRAME_HEADER_LEN + LC_PCM_CHUNK_BYTES)

typedef struct {
    bool from_flash;
    int index; /* ring slot or flash sector */
    uint32_t seq;
} chunk_ref_t;

esp_err_t chunk_store_init(void);

/* Highest seq of a session held in the flash log, or -1 (used for reboot recovery). */
int64_t chunk_store_max_seq(const uint8_t session_id[16]);

/* Audio task: stores one captured chunk; returns false (and flags buffer_full) if nowhere to put it. */
bool chunk_store_push(const uint8_t session_id[16], uint32_t seq, uint64_t capture_unix_ms, const int16_t *pcm,
                      size_t samples);

/* Net task: builds the next frame to send for the session (live first). Returns frame length or 0. */
size_t chunk_store_next_frame(const uint8_t session_id[16], uint8_t *frame, size_t cap, chunk_ref_t *ref);
void chunk_store_mark_sent(const chunk_ref_t *ref);
void chunk_store_apply_ack(const uint8_t session_id[16], const lc_ack_t *ack);
void chunk_store_requeue(void);
size_t chunk_store_pending(const uint8_t session_id[16]);
size_t chunk_store_in_flight(void);

/* Oldest pending session in flash other than `current` (may be NULL). */
bool chunk_store_other_session(const uint8_t *current, uint8_t session_id[16], char lecture_id[37], bool *lecture_known);

/* Starts the spill task (core 0) that moves chunks to flash and refreshes buffer facts. */
void chunk_store_start_spill_task(void);
