#include "lc_ack.h"

void lc_ack_reset(lc_ack_t *ack) {
    ack->cumulative = -1;
    ack->range_count = 0;
}

bool lc_ack_add_range(lc_ack_t *ack, uint32_t lo, uint32_t hi) {
    if (lo > hi || ack->range_count >= LC_ACK_MAX_RANGES) return false;
    ack->lo[ack->range_count] = lo;
    ack->hi[ack->range_count] = hi;
    ack->range_count++;
    return true;
}

bool lc_ack_covers(const lc_ack_t *ack, uint32_t seq) {
    if ((int64_t)seq <= ack->cumulative) return true;
    for (uint8_t i = 0; i < ack->range_count; i++) {
        if (seq >= ack->lo[i] && seq <= ack->hi[i]) return true;
    }
    return false;
}
