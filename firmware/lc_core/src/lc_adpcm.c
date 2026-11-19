#include "lc_adpcm.h"

static const int16_t STEP_TABLE[89] = {
    7,     8,     9,     10,    11,    12,    13,    14,    16,    17,    19,    21,    23,    25,    28,
    31,    34,    37,    41,    45,    50,    55,    60,    66,    73,    80,    88,    97,    107,   118,
    130,   143,   157,   173,   190,   209,   230,   253,   279,   307,   337,   371,   408,   449,   494,
    544,   598,   658,   724,   796,   876,   963,   1060,  1166,  1282,  1411,  1552,  1707,  1878,  2066,
    2272,  2499,  2749,  3024,  3327,  3660,  4026,  4428,  4871,  5358,  5894,  6484,  7132,  7845,  8630,
    9493,  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767};

static const int8_t INDEX_TABLE[16] = {-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8};

static int clamp_index(int index) {
    return index < 0 ? 0 : (index > 88 ? 88 : index);
}

static int clamp_sample(int value) {
    return value < -32768 ? -32768 : (value > 32767 ? 32767 : value);
}

/* Reconstructs the next predictor from a 4-bit code (shared by encoder and decoder). */
static int step_decode(int predictor, int *index, uint8_t code) {
    const int step = STEP_TABLE[*index];
    int diff = step >> 3;
    if (code & 4) diff += step;
    if (code & 2) diff += step >> 1;
    if (code & 1) diff += step >> 2;
    predictor = clamp_sample((code & 8) ? predictor - diff : predictor + diff);
    *index = clamp_index(*index + INDEX_TABLE[code]);
    return predictor;
}

size_t lc_adpcm_encoded_size(size_t n_samples) {
    if (n_samples == 0) return 0;
    return 4 + n_samples / 2; /* (n-1) codes rounded up to whole bytes == n/2 */
}

/* Picks the step index that best matches the first difference, so loud starts converge fast. */
static int initial_index(const int16_t *pcm, size_t n) {
    if (n < 2) return 0;
    const int delta = pcm[1] - pcm[0];
    const int magnitude = delta < 0 ? -delta : delta;
    int index = 0;
    while (index < 88 && STEP_TABLE[index] < magnitude) index++;
    return index;
}

size_t lc_adpcm_encode(const int16_t *pcm, size_t n, uint8_t *out) {
    if (n == 0) return 0;
    int predictor = pcm[0];
    int index = initial_index(pcm, n);
    out[0] = (uint8_t)(predictor & 0xFF);
    out[1] = (uint8_t)((predictor >> 8) & 0xFF);
    out[2] = (uint8_t)index;
    out[3] = (uint8_t)((n - 1) % 2); /* bit 0: final nibble is padding */
    const size_t total = lc_adpcm_encoded_size(n);
    for (size_t i = 4; i < total; i++) out[i] = 0;

    for (size_t i = 1; i < n; i++) {
        const int step = STEP_TABLE[index];
        int diff = pcm[i] - predictor;
        uint8_t code = 0;
        if (diff < 0) {
            code = 8;
            diff = -diff;
        }
        if (diff >= step) {
            code |= 4;
            diff -= step;
        }
        if (diff >= (step >> 1)) {
            code |= 2;
            diff -= step >> 1;
        }
        if (diff >= (step >> 2)) code |= 1;
        predictor = step_decode(predictor, &index, code);
        const size_t nibble = i - 1;
        const size_t byte = 4 + nibble / 2;
        out[byte] |= (nibble % 2 == 0) ? code : (uint8_t)(code << 4);
    }
    return total;
}

size_t lc_adpcm_decode(const uint8_t *in, size_t len, int16_t *pcm_out, size_t max_samples) {
    if (len < 4 || max_samples == 0) return 0;
    int predictor = (int16_t)(in[0] | (in[1] << 8));
    int index = in[2];
    if (index > 88 || (in[3] & 0xFE) != 0) return 0;
    if (len == 4 && (in[3] & 1) != 0) return 0; /* padding flag without any code byte */
    pcm_out[0] = (int16_t)predictor;
    size_t samples = 1;
    const size_t codes = (len - 4) * 2 - (size_t)(in[3] & 1);
    for (size_t c = 0; c < codes && samples < max_samples; c++) {
        const uint8_t byte = in[4 + c / 2];
        const uint8_t code = (c % 2 == 0) ? (byte & 0x0F) : (byte >> 4);
        predictor = step_decode(predictor, &index, code);
        pcm_out[samples++] = (int16_t)predictor;
    }
    return samples;
}
