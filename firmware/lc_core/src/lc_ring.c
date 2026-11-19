#include "lc_ring.h"

#include <string.h>

static bool same_session(const lc_slot_t *slot, const uint8_t session_id[16]) {
    return memcmp(slot->session_id, session_id, 16) == 0;
}

void lc_ring_init(lc_ring_t *ring, lc_slot_t *slots, uint8_t *data, size_t slot_count, size_t slot_size) {
    ring->slots = slots;
    ring->data = data;
    ring->slot_count = slot_count;
    ring->slot_size = slot_size;
    ring->used = 0;
    for (size_t i = 0; i < slot_count; i++) {
        slots[i].state = LC_SLOT_FREE;
        slots[i].len = 0;
    }
}

bool lc_ring_push(lc_ring_t *ring, const uint8_t session_id[16], uint32_t seq, uint64_t sample_offset,
                  uint64_t capture_unix_ms, uint32_t now_ms, const uint8_t *pcm, uint16_t len) {
    if (len > ring->slot_size) return false;
    for (size_t i = 0; i < ring->slot_count; i++) {
        lc_slot_t *slot = &ring->slots[i];
        if (slot->state != LC_SLOT_FREE) continue;
        memcpy(ring->data + i * ring->slot_size, pcm, len);
        memcpy(slot->session_id, session_id, 16);
        slot->seq = seq;
        slot->sample_offset = sample_offset;
        slot->capture_unix_ms = capture_unix_ms;
        slot->captured_at_ms = now_ms;
        slot->len = len;
        slot->state = LC_SLOT_UNSENT;
        ring->used++;
        return true;
    }
    return false;
}

int lc_ring_next_to_send(const lc_ring_t *ring, const uint8_t session_id[16]) {
    int newest = -1;
    int oldest_unsent = -1;
    for (size_t i = 0; i < ring->slot_count; i++) {
        const lc_slot_t *slot = &ring->slots[i];
        if (slot->state == LC_SLOT_FREE || !same_session(slot, session_id)) continue;
        if (newest < 0 || slot->seq > ring->slots[newest].seq) newest = (int)i;
        if (slot->state == LC_SLOT_UNSENT &&
            (oldest_unsent < 0 || slot->seq < ring->slots[oldest_unsent].seq)) {
            oldest_unsent = (int)i;
        }
    }
    if (newest >= 0 && ring->slots[newest].state == LC_SLOT_UNSENT) return newest;
    return oldest_unsent;
}

int lc_ring_oldest_unsent(const lc_ring_t *ring, const uint8_t session_id[16]) {
    int oldest = -1;
    for (size_t i = 0; i < ring->slot_count; i++) {
        const lc_slot_t *slot = &ring->slots[i];
        if (slot->state != LC_SLOT_UNSENT || !same_session(slot, session_id)) continue;
        if (oldest < 0 || slot->seq < ring->slots[oldest].seq) oldest = (int)i;
    }
    return oldest;
}

void lc_ring_mark_sent(lc_ring_t *ring, int index) {
    if (index >= 0 && (size_t)index < ring->slot_count && ring->slots[index].state == LC_SLOT_UNSENT) {
        ring->slots[index].state = LC_SLOT_SENT;
    }
}

void lc_ring_free_slot(lc_ring_t *ring, int index) {
    if (index < 0 || (size_t)index >= ring->slot_count) return;
    if (ring->slots[index].state != LC_SLOT_FREE) {
        ring->slots[index].state = LC_SLOT_FREE;
        ring->used--;
    }
}

size_t lc_ring_apply_ack(lc_ring_t *ring, const uint8_t session_id[16], const lc_ack_t *ack) {
    size_t freed = 0;
    for (size_t i = 0; i < ring->slot_count; i++) {
        const lc_slot_t *slot = &ring->slots[i];
        if (slot->state != LC_SLOT_FREE && same_session(slot, session_id) && lc_ack_covers(ack, slot->seq)) {
            lc_ring_free_slot(ring, (int)i);
            freed++;
        }
    }
    return freed;
}

void lc_ring_requeue_sent(lc_ring_t *ring) {
    for (size_t i = 0; i < ring->slot_count; i++) {
        if (ring->slots[i].state == LC_SLOT_SENT) ring->slots[i].state = LC_SLOT_UNSENT;
    }
}

int lc_ring_pick_spill(const lc_ring_t *ring, const uint8_t *current_session, uint32_t now_ms, bool offline,
                       uint32_t offline_age_ms, unsigned pressure_pct) {
    int oldest = -1;
    int stale = -1; /* oldest slot of a session that is no longer current */
    for (size_t i = 0; i < ring->slot_count; i++) {
        const lc_slot_t *slot = &ring->slots[i];
        if (slot->state == LC_SLOT_FREE) continue;
        if (oldest < 0 || slot->seq < ring->slots[oldest].seq) oldest = (int)i;
        if ((current_session == NULL || !same_session(slot, current_session)) &&
            (stale < 0 || slot->seq < ring->slots[stale].seq)) {
            stale = (int)i;
        }
    }
    if (stale >= 0) return stale;
    if (oldest < 0) return -1;
    if (lc_ring_usage_pct(ring) >= pressure_pct) return oldest;
    if (offline && (uint32_t)(now_ms - ring->slots[oldest].captured_at_ms) >= offline_age_ms) return oldest;
    return -1;
}

const uint8_t *lc_ring_slot_data(const lc_ring_t *ring, int index) {
    return ring->data + (size_t)index * ring->slot_size;
}

size_t lc_ring_count_session(const lc_ring_t *ring, const uint8_t session_id[16]) {
    size_t count = 0;
    for (size_t i = 0; i < ring->slot_count; i++) {
        if (ring->slots[i].state != LC_SLOT_FREE && same_session(&ring->slots[i], session_id)) count++;
    }
    return count;
}

unsigned lc_ring_usage_pct(const lc_ring_t *ring) {
    if (ring->slot_count == 0) return 100;
    return (unsigned)((ring->used * 100) / ring->slot_count);
}
