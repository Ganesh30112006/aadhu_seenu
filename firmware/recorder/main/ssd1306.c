#include "ssd1306.h"

#include <string.h>

#include "driver/i2c_master.h"
#include "font5x7.h"

static i2c_master_bus_handle_t s_bus;
static i2c_master_dev_handle_t s_dev;
static uint8_t s_fb[SSD1306_WIDTH * SSD1306_HEIGHT / 8];

static esp_err_t command_list(const uint8_t *cmds, size_t n) {
    uint8_t buf[32];
    buf[0] = 0x00; /* control byte: command stream */
    memcpy(buf + 1, cmds, n);
    return i2c_master_transmit(s_dev, buf, n + 1, 100);
}

esp_err_t ssd1306_init(int sda_gpio, int scl_gpio, uint8_t address) {
    const i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = sda_gpio,
        .scl_io_num = scl_gpio,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    esp_err_t err = i2c_new_master_bus(&bus_cfg, &s_bus);
    if (err != ESP_OK) return err;
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = address,
        .scl_speed_hz = 400000,
    };
    err = i2c_master_bus_add_device(s_bus, &dev_cfg, &s_dev);
    if (err != ESP_OK) return err;
    static const uint8_t init[] = {
        0xAE,       /* display off */
        0xD5, 0x80, /* clock divide */
        0xA8, 0x3F, /* multiplex 64 */
        0xD3, 0x00, /* display offset */
        0x40,       /* start line 0 */
        0x8D, 0x14, /* charge pump on */
        0x20, 0x00, /* horizontal addressing */
        0xA1,       /* segment remap */
        0xC8,       /* COM scan descending */
        0xDA, 0x12, /* COM pins */
        0x81, 0xCF, /* contrast */
        0xD9, 0xF1, /* pre-charge */
        0xDB, 0x40, /* VCOMH */
        0xA4,       /* resume to RAM */
        0xA6,       /* normal (not inverted) */
        0x2E,       /* no scroll */
        0xAF,       /* display on */
    };
    return command_list(init, sizeof init);
}

void ssd1306_clear(void) {
    memset(s_fb, 0, sizeof s_fb);
}

static void set_pixel(int x, int y, bool on) {
    if (x < 0 || x >= SSD1306_WIDTH || y < 0 || y >= SSD1306_HEIGHT) return;
    uint8_t *byte = &s_fb[(y / 8) * SSD1306_WIDTH + x];
    if (on) *byte |= (uint8_t)(1u << (y % 8));
    else *byte &= (uint8_t)~(1u << (y % 8));
}

void ssd1306_fill_rect(int x, int y, int w, int h, bool on) {
    for (int i = 0; i < w; i++)
        for (int j = 0; j < h; j++) set_pixel(x + i, y + j, on);
}

void ssd1306_text(int x, int page, const char *text, int scale) {
    const int y0 = page * 8;
    for (const char *p = text; *p != '\0' && x < SSD1306_WIDTH; p++) {
        unsigned char c = (unsigned char)*p;
        if (c < 0x20 || c > 0x7E) c = '?';
        const uint8_t *glyph = FONT5X7[c - 0x20];
        for (int col = 0; col < 5; col++) {
            for (int row = 0; row < 8; row++) {
                if ((glyph[col] >> row) & 1) ssd1306_fill_rect(x + col * scale, y0 + row * scale, scale, scale, true);
            }
        }
        x += 6 * scale;
    }
}

esp_err_t ssd1306_flush(void) {
    static const uint8_t window[] = {0x21, 0x00, 0x7F, 0x22, 0x00, 0x07};
    esp_err_t err = command_list(window, sizeof window);
    if (err != ESP_OK) return err;
    uint8_t buf[129];
    buf[0] = 0x40; /* control byte: data stream */
    for (size_t off = 0; off < sizeof s_fb; off += 128) {
        memcpy(buf + 1, s_fb + off, 128);
        err = i2c_master_transmit(s_dev, buf, sizeof buf, 100);
        if (err != ESP_OK) return err;
    }
    return ESP_OK;
}
