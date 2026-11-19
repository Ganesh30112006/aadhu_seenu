/*
 * IMA-ADPCM codec with the block layout of contracts/PROTOCOL.md §1.2:
 *   int16 predictor (first sample) | uint8 step index | uint8 flags (bit0 = last nibble is padding)
 *   | 4-bit codes, low nibble first
 * The Python decoder (backend/app/audio/adpcm.py) must produce bit-identical output.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Encoded size for n samples (n >= 1). */
size_t lc_adpcm_encoded_size(size_t n_samples);

/* Encodes n >= 1 samples into `out` (must hold lc_adpcm_encoded_size(n) bytes). Returns bytes written. */
size_t lc_adpcm_encode(const int16_t *pcm, size_t n_samples, uint8_t *out);

/* Decodes a block of `len` bytes. Returns the number of samples written (<= max_samples), 0 on error. */
size_t lc_adpcm_decode(const uint8_t *in, size_t len, int16_t *pcm_out, size_t max_samples);

#ifdef __cplusplus
}
#endif
