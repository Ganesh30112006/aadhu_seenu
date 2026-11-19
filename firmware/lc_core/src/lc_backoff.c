#include "lc_backoff.h"

uint32_t lc_backoff_delay_ms(uint32_t attempt, uint32_t random_u32) {
    uint32_t ceiling = LC_BACKOFF_CAP_MS;
    if (attempt < 16) {
        const uint64_t grown = (uint64_t)LC_BACKOFF_BASE_MS << attempt;
        if (grown < ceiling) ceiling = (uint32_t)grown;
    }
    return (uint32_t)(((uint64_t)random_u32 * ceiling) >> 32);
}
