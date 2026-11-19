/* Device configuration from NVS namespace "lc_cfg" (D10), falling back to menuconfig values. */
#pragma once

#include <stdbool.h>

typedef struct {
    char wifi_ssid[33];
    char wifi_pass[65];
    char server_url[160];
    char device_id[37];
    char device_token[129];
} device_config_t;

/* Loads the configuration; returns false if anything required is missing. */
bool config_load(device_config_t *out);

extern device_config_t g_config;

#define FIRMWARE_VERSION "1.0.0"
