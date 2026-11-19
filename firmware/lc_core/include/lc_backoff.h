#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define LC_BACKOFF_BASE_MS 500u
#define LC_BACKOFF_CAP_MS 30000u

/*
 * Exponential backoff with full jitter: random in [0, min(cap, base * 2^attempt)).
 * `random_u32` is any uniformly distributed 32-bit value (esp_random() on the device).
 */
uint32_t lc_backoff_delay_ms(uint32_t attempt, uint32_t random_u32);

#ifdef __cplusplus
}
#endif
