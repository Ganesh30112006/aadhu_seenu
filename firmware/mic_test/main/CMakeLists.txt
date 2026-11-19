idf_component_register(
    SRCS "mic_test_main.c"
    INCLUDE_DIRS "."
    REQUIRES esp_driver_i2s esp_driver_gpio mbedtls lc_core)
