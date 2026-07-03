# ghostshow (GhostLabs PGA2350 carrier) — RISC-V sim firmware

Prebuilt `GHOSTSHOW_SIM` (no_flash / SRAM) RISC-V image of the GhostLabs `ghostshow`
light show, used as an RP2350 firmware-integration fixture. Both PGA2350 carriers
(full `x` + `mini`) run this same build; they differ only in LED geometry.

- Entry: `0x20000220` (pico `no_flash` crt0), loaded into SRAM at `0x20000000`.
- Single-core, interrupts disabled, `busy_wait` pacing, WS2812 chain of 24 on GP28 (GRB).
- Source of truth: `pga2350-carrier/firmware/ghostshow` (build `sim-riscv`).

## ghostshow_mc.hex — dual-core variant

Same firmware built `-DGHOSTSHOW_SIM=1 -DGHOSTSHOW_SIM_MC=1`: core0 renders while **core1** runs the
FPU-heavy plasma field (`field_core1_entry`) via `multicore_launch_core1`. Exercises the emulator's
PSM/FIFO core1-launch path. The MC build adds a `busy_wait` frame pace so the WS2812 line idles
between frames (the reset gap `field_step()` used to provide on the single-core build). Drive it with
`RP2350.holdCore1ForLaunch()` before stepping (see `src/ghostshow.spec.ts`).
