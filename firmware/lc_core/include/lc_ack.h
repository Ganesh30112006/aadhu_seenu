/*
 * Selective acknowledgement state received from the server (contracts/PROTOCOL.md §1.3, `ack`).
 * A chunk is safe to free when it is covered by the cumulative seq or by any range.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define LC_ACK_MAX_RANGES 16

typedef struct {
    int64_t cumulative; /* -1 = nothing contiguous from 0 yet */
    uint8_t range_count;
    uint32_t lo[LC_ACK_MAX_RANGES];
    uint32_t hi[LC_ACK_MAX_RANGES]; /* inclusive */
} lc_ack_t;

void lc_ack_reset(lc_ack_t *ack);

/* Adds a range; ignores invalid (lo > hi) or overflow beyond LC_ACK_MAX_RANGES. */
bool lc_ack_add_range(lc_ack_t *ack, uint32_t lo, uint32_t hi);

bool lc_ack_covers(const lc_ack_t *ack, uint32_t seq);

#ifdef __cplusplus
}
#endif
