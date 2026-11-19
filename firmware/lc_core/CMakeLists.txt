# ESP-IDF component (platform-independent core: frame, ADPCM, ACK, ring, flash log, backoff).
idf_component_register(
    SRCS "src/lc_frame.c" "src/lc_adpcm.c" "src/lc_ack.c" "src/lc_ring.c" "src/lc_flashlog.c" "src/lc_backoff.c"
    INCLUDE_DIRS "include")
