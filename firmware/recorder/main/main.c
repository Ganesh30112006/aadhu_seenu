/*
 * Lecture Capture recorder (ESP32-S3-DevKitC-1-N8R8, ESP-IDF v5.3+).
 * Tasks: audio (core 1, highest), net + spill + ui + buttons (core 0). See firmware/README.md.
 */
#include "app.h"
#include "audio.h"
#include "buttons.h"
#include "chunk_store.h"
#include "config.h"
#include "esp_log.h"
#include "esp_system.h"
#include "net.h"
#include "nvs_flash.h"
#include "session.h"
#include "ui.h"

static const char *TAG = "main";

void app_main(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    app_init();
    ui_start(); /* LED/OLED first so problems below are visible */

    if (!config_load(&g_config)) {
        g_facts.fatal = true;
        app_set_error("Not provisioned");
    }
    if (chunk_store_init() != ESP_OK) {
        g_facts.fatal = true;
        app_set_error("Storage init failed");
        ESP_LOGE(TAG, "cannot continue without buffers");
        return; /* UI task keeps showing the error */
    }
    session_init();
    chunk_store_start_spill_task();
    audio_start();
    buttons_start();
    if (!g_facts.fatal) net_start(); /* without provisioning the device still records offline */
    ESP_LOGI(TAG, "started, firmware %s", FIRMWARE_VERSION);
}
