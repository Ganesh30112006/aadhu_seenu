/*
 * Audio chunk frame encoding (contracts/PROTOCOL.md §1.1). Platform independent.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define LC_FRAME_MAGIC0 0x4C /* 'L' */
#define LC_FRAME_MAGIC1 0x43 /* 'C' */
#define LC_FRAME_VERSION 1
#define LC_FRAME_HEADER_LEN 26

#define LC_SAMPLE_RATE 16000
#define LC_SAMPLES_PER_CHUNK 8000 /* 500 ms */
#define LC_PCM_CHUNK_BYTES (LC_SAMPLES_PER_CHUNK * 2)
#define LC_ADPCM_HEADER_BYTES 4
#define LC_ADPCM_CHUNK_BYTES (LC_ADPCM_HEADER_BYTES + LC_SAMPLES_PER_CHUNK / 2) /* 4004 */

typedef enum {
    LC_CODEC_PCM16 = 0,
    LC_CODEC_ADPCM = 1,
} lc_codec_t;

typedef struct {
    uint8_t codec;
    uint32_t seq;
    uint64_t sample_offset;
    uint64_t capture_unix_ms;
    uint16_t payload_len;
} lc_frame_header_t;

typedef enum {
    LC_FRAME_OK = 0,
    LC_FRAME_ERR_SHORT = -1,
    LC_FRAME_ERR_MAGIC = -2,
    LC_FRAME_ERR_VERSION = -3,
    LC_FRAME_ERR_CODEC = -4,
    LC_FRAME_ERR_LENGTH = -5,
} lc_frame_result_t;

/* Writes the 26-byte header into `out`. Returns LC_FRAME_HEADER_LEN. */
size_t lc_frame_encode_header(const lc_frame_header_t *header, uint8_t out[LC_FRAME_HEADER_LEN]);

/* Parses and validates a complete frame (header + payload) of `len` bytes. */
lc_frame_result_t lc_frame_decode(const uint8_t *frame, size_t len, lc_frame_header_t *out);

/* Maximum valid payload size for a codec (a final chunk may be shorter). */
size_t lc_frame_max_payload(lc_codec_t codec);

#ifdef __cplusplus
}
#endif
