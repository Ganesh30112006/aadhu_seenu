#include "lc_frame.h"

static void put_u16(uint8_t *p, uint16_t v) {
    p[0] = (uint8_t)(v & 0xFF);
    p[1] = (uint8_t)(v >> 8);
}

static void put_u32(uint8_t *p, uint32_t v) {
    for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i));
}

static void put_u64(uint8_t *p, uint64_t v) {
    for (int i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (8 * i));
}

static uint16_t get_u16(const uint8_t *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

static uint32_t get_u32(const uint8_t *p) {
    uint32_t v = 0;
    for (int i = 3; i >= 0; i--) v = (v << 8) | p[i];
    return v;
}

static uint64_t get_u64(const uint8_t *p) {
    uint64_t v = 0;
    for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
    return v;
}

size_t lc_frame_max_payload(lc_codec_t codec) {
    switch (codec) {
        case LC_CODEC_PCM16: return LC_PCM_CHUNK_BYTES;
        case LC_CODEC_ADPCM: return LC_ADPCM_CHUNK_BYTES;
        default: return 0;
    }
}

size_t lc_frame_encode_header(const lc_frame_header_t *h, uint8_t out[LC_FRAME_HEADER_LEN]) {
    out[0] = LC_FRAME_MAGIC0;
    out[1] = LC_FRAME_MAGIC1;
    out[2] = LC_FRAME_VERSION;
    out[3] = h->codec;
    put_u32(&out[4], h->seq);
    put_u64(&out[8], h->sample_offset);
    put_u64(&out[16], h->capture_unix_ms);
    put_u16(&out[24], h->payload_len);
    return LC_FRAME_HEADER_LEN;
}

lc_frame_result_t lc_frame_decode(const uint8_t *frame, size_t len, lc_frame_header_t *out) {
    if (len < LC_FRAME_HEADER_LEN) return LC_FRAME_ERR_SHORT;
    if (frame[0] != LC_FRAME_MAGIC0 || frame[1] != LC_FRAME_MAGIC1) return LC_FRAME_ERR_MAGIC;
    if (frame[2] != LC_FRAME_VERSION) return LC_FRAME_ERR_VERSION;
    const uint8_t codec = frame[3];
    if (codec != LC_CODEC_PCM16 && codec != LC_CODEC_ADPCM) return LC_FRAME_ERR_CODEC;
    const uint16_t payload_len = get_u16(&frame[24]);
    if ((size_t)payload_len + LC_FRAME_HEADER_LEN != len) return LC_FRAME_ERR_LENGTH;
    if (payload_len == 0 || payload_len > lc_frame_max_payload((lc_codec_t)codec)) return LC_FRAME_ERR_LENGTH;
    if (codec == LC_CODEC_PCM16 && (payload_len % 2) != 0) return LC_FRAME_ERR_LENGTH;
    if (codec == LC_CODEC_ADPCM && payload_len < LC_ADPCM_HEADER_BYTES) return LC_FRAME_ERR_LENGTH;
    out->codec = codec;
    out->seq = get_u32(&frame[4]);
    out->sample_offset = get_u64(&frame[8]);
    out->capture_unix_ms = get_u64(&frame[16]);
    out->payload_len = payload_len;
    return LC_FRAME_OK;
}
