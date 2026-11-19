/* Start (GPIO1), Stop (GPIO2) and Pause/Resume (GPIO7) buttons to GND with internal pull-ups;
 * ISR + debounce task. */
#pragma once

void buttons_start(void);
