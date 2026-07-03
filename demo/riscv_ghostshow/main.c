// main.c — GhostLabs PGA2350 carrier light show.
//
//  core0: render the current effect, crossfade between effects, run the output
//         pipeline, drive the matrix, handle USB control + the buzzer.
//  core1: continuously compute the float plasma field (effects.c) — the FPU-heavy
//         work lives here so the render core stays light. This is the legible use
//         of the RP2350's second core.
//
// Data pin GP28 -> 74AHCT1G125 level shifter -> 330R -> DP1.DIN (24-pixel chain).
// Buzzer  GP22 (low-side MOSFET, PWM). Control + telemetry over USB-CDC.
#include <stdio.h>
#include <string.h>
#include "pico/stdlib.h"
#include "pico/multicore.h"
#include "hardware/clocks.h"
#include "hardware/pwm.h"
#include "matrix.h"
#include "effects.h"

#ifdef GHOSTSHOW_SIM
// Sim console: the pico stdio path uses a mutex/spinlock the emulator mis-handles,
// so under sim we talk to UART0 directly (uart_putc/uart_getc never touch the mutex).
// Output is vsnprintf'd into a buffer; input is a non-blocking UART read. uart0 is
// already configured by stdio_init_all (UART stdio is enabled for the sim build).
#include "hardware/uart.h"
#include <stdarg.h>
static void sim_printf(const char *fmt, ...) {
    char b[256]; va_list ap; va_start(ap, fmt);
    int n = vsnprintf(b, sizeof b, fmt, ap); va_end(ap);
    if (n > (int)sizeof b) n = sizeof b;
    for (int i = 0; i < n; i++) uart_putc(uart0, b[i]);
}
static int sim_getchar(void) { return uart_is_readable(uart0) ? uart_getc(uart0) : PICO_ERROR_TIMEOUT; }
#define printf(...)            sim_printf(__VA_ARGS__)
#define getchar_timeout_us(us) sim_getchar()
#endif

#define DATA_PIN    28
#define BUZZER_PIN  22
#define FRAME_US    5000     // 200 fps render pacing (the wire ceiling is ~980 fps)
#define HOLD_MS     9000     // auto-advance dwell per effect
#define FADE_MS     700      // crossfade duration

// Functional emulation runs the Hazard3 core at ~1/12 wall-speed (the JS interpreter
// ceiling), and the show paces every fade, dwell and effect off the emulated clock — so on
// screen the whole thing crawls: a 0.7 s crossfade drags out to ~9 s and buttons feel dead.
// Scale the firmware's notion of elapsed time so the show plays at real wall-speed and stays
// smooth (~52 fps wall × this gain ≈ real-time motion). This only stretches application-level
// pacing; the WS2812 decoder times its edges off the true hardware clock, so frame timing and
// decode are untouched. Hardware build uses gain 1 (identity) and is bit-for-bit unaffected.
#ifdef GHOSTSHOW_SIM
#define SIM_TIME_GAIN 12u
#else
#define SIM_TIME_GAIN 1u
#endif
static inline uint32_t show_ms(void) {
    return (uint32_t)to_ms_since_boot(get_absolute_time()) * SIM_TIME_GAIN;
}

// ----------------------------- cycle benchmark ------------------------------
#if defined(__riscv)
static inline uint32_t cpu_cycle(void) { uint32_t c; __asm volatile("csrr %0, mcycle" : "=r"(c)); return c; }
static const char *ARCH = "RISC-V (Hazard3)";
#else
#define DWT_CTRL   (*(volatile uint32_t *)0xE0001000)
#define DWT_CYCCNT (*(volatile uint32_t *)0xE0001004)
#define DEMCR      (*(volatile uint32_t *)0xE000EDFC)
static inline uint32_t cpu_cycle(void) { return DWT_CYCCNT; }
static const char *ARCH = "Arm Cortex-M33";
#endif

static void bench_init(void) {
#if !defined(__riscv)
    DEMCR |= (1u << 24);     // TRCENA
    DWT_CYCCNT = 0;
    DWT_CTRL |= 1u;          // enable the cycle counter
#endif
}

static int effect_index(const char *name) {
    for (int i = 0; i < N_EFFECTS; i++) if (strcmp(EFFECTS[i].name, name) == 0) return i;
    return 0;
}

static void run_benchmark(void) {
    uint32_t hz = clock_get_hz(clk_sys);
    const int N = 300;
    uint8_t h[PX], v[PX];
    Color tmp[PX];
    uint32_t seed = 12345;

    field_compute(h, v, 0.1f);                               // warm
    uint32_t c0 = cpu_cycle();
    for (int i = 0; i < N; i++) field_compute(h, v, i * 0.013f);
    uint32_t fcyc = (cpu_cycle() - c0) / N;

    int ni = effect_index("noise");                          // the integer plasma
    EFFECTS[ni].fn(tmp, 1000, &seed);                        // warm
    c0 = cpu_cycle();
    for (int i = 0; i < N; i++) EFFECTS[ni].fn(tmp, (uint32_t)i * 7, &seed);
    uint32_t icyc = (cpu_cycle() - c0) / N;

    printf("\n========== ghostshow benchmark ==========\n");
    printf(" ISA            : %s\n", ARCH);
    printf(" clk_sys        : %lu MHz\n", (unsigned long)(hz / 1000000u));
    printf(" float  plasma  : %lu cyc/frame  (%.1f us, %.0f fps ceiling)\n",
           (unsigned long)fcyc, fcyc * 1e6f / hz, hz / (float)fcyc);
    printf(" integer plasma : %lu cyc/frame  (%.1f us, %.0f fps ceiling)\n",
           (unsigned long)icyc, icyc * 1e6f / hz, hz / (float)icyc);
    printf(" WS2812 wire    : ~1.0 ms/frame  (~980 fps hard ceiling; PIO+DMA, 0 CPU)\n");
    printf("=========================================\n");
}

// ----------------------------- buzzer (GP22) --------------------------------
static uint     buz_slice;
#ifdef GHOSTSHOW_SIM
static bool     buz_on = false, sfx_enabled = false;     // buzzer disabled under sim (no PWM)
#else
static bool     buz_on = false, sfx_enabled = true;
#endif
static uint64_t buz_off_us = 0;

static void buzzer_init(void) {
    gpio_set_function(BUZZER_PIN, GPIO_FUNC_PWM);
    buz_slice = pwm_gpio_to_slice_num(BUZZER_PIN);
    pwm_set_enabled(buz_slice, false);
}
static void buz_tone(uint32_t freq, uint32_t ms) {
    if (!sfx_enabled || freq == 0) return;
    float div = (float)clock_get_hz(clk_sys) / (freq * 4096.0f);
    if (div < 1.0f) div = 1.0f;
    pwm_set_clkdiv(buz_slice, div);
    pwm_set_wrap(buz_slice, 4095);
    pwm_set_gpio_level(BUZZER_PIN, 2048);                    // 50% duty
    pwm_set_enabled(buz_slice, true);
    buz_on = true;
    buz_off_us = time_us_64() + (uint64_t)ms * 1000;
}
static void buz_poll(void) {
    if (buz_on && time_us_64() >= buz_off_us) { pwm_set_enabled(buz_slice, false); buz_on = false; }
}

// ----------------------------- director state -------------------------------
static Color    bufA[PX], bufB[PX], outc[PX];
static int      cur = 0, nxt = 0;
static uint32_t seedA = 0x1234abcdu, seedB = 0x9e3779b9u;
static uint32_t mode_start_ms, trans_start_ms;
static bool     transitioning = false, paused = false;

static void start_transition(int to, uint32_t ms) {
    if (transitioning) return;
    nxt = (to % N_EFFECTS + N_EFFECTS) % N_EFFECTS;
    transitioning = true;
    trans_start_ms = ms;
    seedB = 0x9e3779b9u ^ (nxt * 2654435761u);
    buz_tone(2700, 28);                                      // soft tick on change
}

static void print_help(void) {
    printf("\n[ghostshow] keys: n/p next/prev  space pause  +/- brightness  "
           "b buzzer  f benchmark  0-9 jump  ? help\n effects:");
    for (int i = 0; i < N_EFFECTS; i++) printf(" %d:%s", i, EFFECTS[i].name);
    printf("\n");
}

static void handle_input(uint32_t ms) {
    int ch = getchar_timeout_us(0);
    if (ch == PICO_ERROR_TIMEOUT) return;
    switch (ch) {
        case 'n': start_transition(cur + 1, ms); break;
        case 'p': start_transition(cur - 1, ms); break;
        case ' ': paused = !paused; printf("[ghostshow] %s\n", paused ? "paused" : "auto"); break;
        case '+': case '=': matrix_set_brightness(
            matrix_get_brightness() > 235 ? 255 : matrix_get_brightness() + 20);
            printf("[ghostshow] brightness %u\n", matrix_get_brightness()); break;
        case '-': case '_': matrix_set_brightness(
            matrix_get_brightness() < 25 ? 5 : matrix_get_brightness() - 20);
            printf("[ghostshow] brightness %u\n", matrix_get_brightness()); break;
        case 'b': sfx_enabled = !sfx_enabled; printf("[ghostshow] buzzer %s\n", sfx_enabled ? "on" : "off"); break;
        case 'f': run_benchmark(); break;
        case '?': case 'h': print_help(); break;
        default:
            if (ch >= '0' && ch <= '9') { int i = ch - '0'; if (i < N_EFFECTS) start_transition(i, ms); }
            break;
    }
}

int main(void) {
#ifdef GHOSTSHOW_SIM
    // The render loop is fully polled (blocking DMA, polled stdio, timer-read pacing),
    // so it needs no interrupts. The emulator's external-IRQ delivery is rough, so we
    // disable them outright — this is what keeps the sim build from faulting.
    save_and_disable_interrupts();
#else
    set_sys_clock_khz(150000, true);                         // 150 MHz
#endif
    stdio_init_all();
    bench_init();
    matrix_init(DATA_PIN);
#ifndef GHOSTSHOW_SIM
    buzzer_init();                                           // PWM block unimplemented in the emulator
#endif

#ifdef GHOSTSHOW_SIM
    busy_wait_us(2000);                                      // no USB to enumerate; no alarm IRQ under sim
#else
    sleep_ms(800);                                           // let USB-CDC enumerate
#endif
    printf("\nGhostLabs PGA2350 ghost matrix — light show\n");
#ifdef GHOSTSHOW_SIM
    // The cycle benchmark is meaningless under a functional (non-cycle-accurate)
    // emulator, and its float-formatting printf exercises fork gaps — skip at boot.
    printf("[sim] benchmark skipped (functional emulator; press 'f' on real hardware)\n");
#else
    run_benchmark();                                         // clean (core1 not yet running)
#endif
    print_help();

#ifndef GHOSTSHOW_SIM
    multicore_launch_core1(field_core1_entry);               // float field generator
#endif

    mode_start_ms = show_ms();
    absolute_time_t next = get_absolute_time();
    while (1) {
        uint32_t ms = show_ms();

        if (!transitioning && !paused && (ms - mode_start_ms) > HOLD_MS)
            start_transition(cur + 1, ms);

#ifdef GHOSTSHOW_SIM
        field_step();                                        // single-core: refresh the plasma field
#endif
        EFFECTS[cur].fn(bufA, ms, &seedA);
        if (transitioning) {
            EFFECTS[nxt].fn(bufB, ms, &seedB);
            uint32_t e = ms - trans_start_ms;
            uint8_t t = e >= FADE_MS ? 255 : (uint8_t)(e * 255u / FADE_MS);
            for (int i = 0; i < PX; i++) outc[i] = color_lerp(bufA[i], bufB[i], t);
            matrix_present(outc);
            if (e >= FADE_MS) { cur = nxt; transitioning = false; mode_start_ms = ms; seedA = seedB; }
        } else {
            matrix_present(bufA);
        }

        handle_input(ms);
        buz_poll();

#ifdef GHOSTSHOW_SIM
        (void)next;                                          // sim host controls pacing; free-run
#else
        next = delayed_by_us(next, FRAME_US);
        sleep_until(next);
#endif
    }
}
