idf_component_register(
    SRCS "main.c" "app.c" "config.c" "session.c" "chunk_store.c" "audio.c" "net.c" "ui.c" "ssd1306.c" "buttons.c"
    INCLUDE_DIRS "."
    REQUIRES lc_core esp_driver_i2s esp_driver_gpio esp_driver_i2c esp_driver_ledc esp_wifi esp_netif
             esp_event nvs_flash esp_partition esp_timer json mbedtls)
