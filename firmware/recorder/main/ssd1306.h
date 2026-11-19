/* Minimal SSD1306 128×64 I2C driver with a 1-bit framebuffer and a 5×7 font. */
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#define SSD1306_WIDTH 128
#define SSD1306_HEIGHT 64

esp_err_t ssd1306_init(int sda_gpio, int scl_gpio, uint8_t address);
void ssd1306_clear(void);
/* Draws ASCII text at pixel (x, page*8); scale 1 or 2. Non-ASCII bytes render as '?'. */
void ssd1306_text(int x, int page, const char *text, int scale);
void ssd1306_fill_rect(int x, int y, int w, int h, bool on);
esp_err_t ssd1306_flush(void);
