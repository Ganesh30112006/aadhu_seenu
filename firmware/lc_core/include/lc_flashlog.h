/*
 * Circular flash log of ADPCM chunks: exactly one record per 4 KB erase sector.
 *
 * Record layout (little-endian):
 *   0  4  magic "LCFL"            40  4  seq
 *   4  4  write_counter           44  8  sample_offset
 *   8 16  session_id              52  8  capture_unix_ms
 *  24 16  lecture_id (0 = none)   60  1  codec (1 = ADPCM)
 *  61  1  flags (bit0 lecture known)  62 2 payload_len
 *  64  4  payload_crc32           68  4  header_crc32 (bytes 0..67)
 *  72  n  payload (<= 4004)
 *  4092 4 ack word: 0xFFFFFFFF = pending, 0x00000000 = acknowledged (written without erase)
 *
 * NOR flash can clear bits without an erase, so ACK marking is a single 4-byte write. A record
 * is valid only if both CRCs match, so a power cut during a write leaves an ignorable record.
 * Sectors are erased right before reuse; the log rotates through all sectors (wear levelling).
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "lc_ack.h"

#ifdef __cplusplus
extern "C" {
#endif

#define LC_FLASHLOG_SECTOR 4096
#define LC_FLASHLOG_HEADER 72
#define LC_FLASHLOG_ACK_OFFSET (LC_FLASHLOG_SECTOR - 4)
#define LC_FLASHLOG_MAX_PAYLOAD (LC_FLASHLOG_ACK_OFFSET - LC_FLASHLOG_HEADER)

typedef struct {
    void *ctx;
    int (*read)(void *ctx, size_t offset, void *dst, size_t len);
    int (*write)(void *ctx, size_t offset, const void *src, size_t len);
    int (*erase_sector)(void *ctx, size_t offset);
} lc_flash_ops_t;

typedef struct {
    uint8_t session_id[16];
    uint8_t lecture_id[16];
    bool lecture_known;
    uint32_t seq;
    uint64_t sample_offset;
    uint64_t capture_unix_ms;
    uint8_t codec;
    uint16_t payload_len;
} lc_flash_record_t;

/* In-RAM index entry per sector, rebuilt from flash at boot. */
typedef struct {
    uint32_t write_counter; /* 0 = empty/invalid */
    uint32_t seq;
    uint8_t session_id[16];
    bool pending; /* valid and not yet acknowledged */
    bool sent;    /* sent on the current connection */
} lc_flash_slot_t;

typedef struct {
    lc_flash_ops_t ops;
    lc_flash_slot_t *index; /* sector_count entries */
    size_t sector_count;
    size_t head;            /* next sector to write */
    uint32_t next_counter;
    size_t pending;
} lc_flashlog_t;

/* Scans the partition and rebuilds the index (call once at boot). */
int lc_flashlog_mount(lc_flashlog_t *log, const lc_flash_ops_t *ops, lc_flash_slot_t *index, size_t sector_count);

/* Appends a record. Returns 0, or -1 if every sector holds a pending record (log full). */
int lc_flashlog_append(lc_flashlog_t *log, const lc_flash_record_t *record, const uint8_t *payload);

/* Marks every pending record of `session_id` covered by `ack` as acknowledged. Returns count. */
size_t lc_flashlog_apply_ack(lc_flashlog_t *log, const uint8_t session_id[16], const lc_ack_t *ack);

/* Oldest pending record of the session not yet sent on this connection; -1 if none. */
int lc_flashlog_oldest_unsent(const lc_flashlog_t *log, const uint8_t session_id[16]);

/* Any pending record (any session) with the lowest write counter; -1 if none. */
int lc_flashlog_oldest_pending(const lc_flashlog_t *log);

/* Reads a record and payload (payload buffer >= LC_FLASHLOG_MAX_PAYLOAD). 0 = ok. */
int lc_flashlog_read(const lc_flashlog_t *log, int sector, lc_flash_record_t *record, uint8_t *payload);

void lc_flashlog_mark_sent(lc_flashlog_t *log, int sector);
void lc_flashlog_requeue_sent(lc_flashlog_t *log);

/* Pending records of a session (for "N chunks to sync" on the OLED). */
size_t lc_flashlog_pending_for(const lc_flashlog_t *log, const uint8_t session_id[16]);

unsigned lc_flashlog_usage_pct(const lc_flashlog_t *log);

uint32_t lc_crc32(const uint8_t *data, size_t len);

#ifdef __cplusplus
}
#endif
