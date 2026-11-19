#include "buttons.h"

#include "app.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "session.h"

#define PIN_START GPIO_NUM_1
#define PIN_STOP GPIO_NUM_2
#define PIN_PAUSE GPIO_NUM_7
#define SETTLE_MS 30
#define REPEAT_GUARD_MS 400

static const char *TAG = "buttons";
static QueueHandle_t s_events;

static void IRAM_ATTR on_edge(void *arg) {
    const uint32_t pin = (uint32_t)arg;
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(s_events, &pin, &woken);
    if (woken) portYIELD_FROM_ISR();
}

static void on_start(void) {
    char lecture[37] = "";
    app_get_assigned(lecture, sizeof lecture, NULL, 0);
    if (g_facts.buffer_full) {
        ESP_LOGW(TAG, "start ignored: buffers full");
        return;
    }
    if (session_start(lecture)) ESP_LOGI(TAG, "recording started");
}

static void on_pause(void) {
    const session_info_t s = session_info();
    if (!s.active || s.stopped) {
        ESP_LOGI(TAG, "pause ignored: not recording");
        return;
    }
    session_set_paused(!s.paused); /* the net task tells the server */
}

static void button_task(void *arg) {
    (void)arg;
    uint32_t last_accept[3] = {0, 0, 0};
    uint32_t pin;
    for (;;) {
        if (xQueueReceive(s_events, &pin, portMAX_DELAY) != pdTRUE) continue;
        vTaskDelay(pdMS_TO_TICKS(SETTLE_MS));
        if (gpio_get_level((gpio_num_t)pin) != 0) continue; /* bounce or glitch */
        const int which = pin == PIN_START ? 0 : pin == PIN_STOP ? 1 : 2;
        const uint32_t now = app_now_ms();
        if (now - last_accept[which] < REPEAT_GUARD_MS) continue;
        last_accept[which] = now;
        if (which == 0) on_start();
        else if (which == 2) on_pause();
        else {
            session_stop();
            ESP_LOGI(TAG, "recording stopped");
        }
    }
}

void buttons_start(void) {
    s_events = xQueueCreate(8, sizeof(uint32_t));
    const gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << PIN_START) | (1ULL << PIN_STOP) | (1ULL << PIN_PAUSE),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&cfg));
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(PIN_START, on_edge, (void *)(uint32_t)PIN_START));
    ESP_ERROR_CHECK(gpio_isr_handler_add(PIN_STOP, on_edge, (void *)(uint32_t)PIN_STOP));
    ESP_ERROR_CHECK(gpio_isr_handler_add(PIN_PAUSE, on_edge, (void *)(uint32_t)PIN_PAUSE));
    xTaskCreatePinnedToCore(button_task, "buttons", 3072, NULL, 6, NULL, 0);
}
