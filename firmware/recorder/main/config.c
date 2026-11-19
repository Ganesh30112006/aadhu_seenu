#include "config.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"

static const char *TAG = "config";

device_config_t g_config;

static void read_str(nvs_handle_t nvs, bool opened, const char *key, char *out, size_t len, const char *fallback) {
    size_t size = len;
    if (!opened || nvs_get_str(nvs, key, out, &size) != ESP_OK) strlcpy(out, fallback, len);
}

bool config_load(device_config_t *out) {
    memset(out, 0, sizeof *out);
    nvs_handle_t nvs = 0;
    const bool opened = nvs_open("lc_cfg", NVS_READONLY, &nvs) == ESP_OK;
    read_str(nvs, opened, "wifi_ssid", out->wifi_ssid, sizeof out->wifi_ssid, CONFIG_LC_WIFI_SSID);
    read_str(nvs, opened, "wifi_pass", out->wifi_pass, sizeof out->wifi_pass, CONFIG_LC_WIFI_PASSWORD);
    read_str(nvs, opened, "server_url", out->server_url, sizeof out->server_url, CONFIG_LC_SERVER_URL);
    read_str(nvs, opened, "device_id", out->device_id, sizeof out->device_id, CONFIG_LC_DEVICE_ID);
    read_str(nvs, opened, "device_token", out->device_token, sizeof out->device_token, CONFIG_LC_DEVICE_TOKEN);
    if (opened) nvs_close(nvs);
    const bool ok = out->wifi_ssid[0] != '\0' && out->server_url[0] != '\0' && strlen(out->device_id) == 36 &&
                    strlen(out->device_token) >= 16;
    if (!ok) ESP_LOGE(TAG, "incomplete configuration: provision NVS (see firmware/README.md)");
    ESP_LOGI(TAG, "device %s → %s (token not logged)", out->device_id, out->server_url);
    return ok;
}
