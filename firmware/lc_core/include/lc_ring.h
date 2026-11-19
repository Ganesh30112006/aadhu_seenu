/*
 * Chunk ring in PSRAM: fixed slots of up to one PCM chunk each. Not thread-safe; the firmware
 * wraps every call in one mutex (chunk_store.c). Platform independent, host-tested.
 *
 * Slot life: FREE -> UNSENT (captured) -> SENT (on the wire) -> FREE (acked or spilled to flash).
 * After a disconnect every SENT slot returns to UNSENT so it is resent.
 * Every slot is tagged with its recording session: ACKs and sending are per session, and slots of
 * a session that is no longer current are moved to flash first.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "lc_ack.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LC_SLOT_FREE = 0,
    LC_SLOT_UNSENT,
    LC_SLOT_SENT,
} lc_slot_state_t;

typedef struct {
    lc_slot_state_t state;
    uint8_t session_id[16];
    uint32_t seq;
    uint64_t sample_offset;
    uint64_t capture_unix_ms;
    uint32_t captured_at_ms; /* monotonic ms (for spill age) */
    uint16_t len;            /* PCM bytes */
} lc_slot_t;

typedef struct {
    lc_slot_t *slots;
    uint8_t *data; /* slot_count * slot_size bytes (PSRAM) */
    size_t slot_count;
    size_t slot_size;
    size_t used;
} lc_ring_t;

void lc_ring_init(lc_ring_t *ring, lc_slot_t *slots, uint8_t *data, size_t slot_count, size_t slot_size);

/* Copies a captured chunk into a free slot. Returns false if the ring is full. */
bool lc_ring_push(lc_ring_t *ring, const uint8_t session_id[16], uint32_t seq, uint64_t sample_offset,
                  uint64_t capture_unix_ms, uint32_t now_ms, const uint8_t *pcm, uint16_t len);

/*
 * Live-first selection within a session: the newest slot if it is UNSENT, otherwise the oldest
 * UNSENT slot. Returns the slot index or -1.
 */
int lc_ring_next_to_send(const lc_ring_t *ring, const uint8_t session_id[16]);

/* UNSENT slot of the session with the lowest seq, or -1 (compared against the flash backlog). */
int lc_ring_oldest_unsent(const lc_ring_t *ring, const uint8_t session_id[16]);

void lc_ring_mark_sent(lc_ring_t *ring, int index);

/* Frees every slot of the session covered by the ack. Returns the number freed. */
size_t lc_ring_apply_ack(lc_ring_t *ring, const uint8_t session_id[16], const lc_ack_t *ack);

/* SENT -> UNSENT for every slot (connection lost: resend everything not acked). */
void lc_ring_requeue_sent(lc_ring_t *ring);

/*
 * Slot that must move to flash, oldest first: any slot not of `current_session` (NULL = none);
 * else the oldest slot when the ring is at/above `pressure_pct` full, or when the device is
 * offline and the chunk is older than `offline_age_ms`. Returns index or -1.
 */
int lc_ring_pick_spill(const lc_ring_t *ring, const uint8_t *current_session, uint32_t now_ms, bool offline,
                       uint32_t offline_age_ms, unsigned pressure_pct);

void lc_ring_free_slot(lc_ring_t *ring, int index);

const uint8_t *lc_ring_slot_data(const lc_ring_t *ring, int index);

/* Slots of the session not yet acknowledged (UNSENT + SENT). */
size_t lc_ring_count_session(const lc_ring_t *ring, const uint8_t session_id[16]);

unsigned lc_ring_usage_pct(const lc_ring_t *ring);

#ifdef __cplusplus
}
#endif
