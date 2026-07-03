# ghostshow (GhostLabs PGA2350 carrier) — RISC-V sim firmware

Prebuilt `GHOSTSHOW_SIM` (no_flash / SRAM) RISC-V image of the GhostLabs `ghostshow`
light show, used as an RP2350 firmware-integration fixture. Both PGA2350 carriers
(full `x` + `mini`) run this same build; they differ only in LED geometry.

- Entry: `0x20000220` (pico `no_flash` crt0), loaded into SRAM at `0x20000000`.
- Single-core, interrupts disabled, `busy_wait` pacing, WS2812 chain of 24 on GP28 (GRB).
- Source of truth: `pga2350-carrier/firmware/ghostshow` (build `sim-riscv`).
