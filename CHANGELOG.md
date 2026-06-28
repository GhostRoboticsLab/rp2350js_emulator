# Changelog

All notable changes to this fork are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases here are fork-namespaced (`rp2350-vX.Y.Z`). The inherited `v0.1.0`..`v1.3.3`
tags belong to upstream [wokwi/rp2040js](https://github.com/wokwi/rp2040js) and are
**not** this fork's releases.

## [Unreleased]

Nothing yet.

## [rp2350-v0.1.0] - 2026-06-28

First fork-namespaced release: c1570's RP2350 / Hazard3 RISC-V core, re-based onto
the latest upstream wokwi/rp2040js and corrected until the chip boots its A2 bootrom
and runs real firmware. **348 tests pass, 0 skipped.** See [CREDITS.md](./CREDITS.md)
for lineage and [ROADMAP.md](./ROADMAP.md) for what remains deferred.

### Added

- Imported c1570's RP2350 / Hazard3 RISC-V engine (the CPU and assembler under
  `src/riscv/*`, the RP2350 chip in `rp2350.ts` / `rpchip.ts`, and the RP2350
  peripheral variants `*_rp2350.ts`), with c1570's commit authorship preserved.
- Three firmware integration tests against the A2 bootrom:
  - **`blink_simple`** — GPIO driven via SIO.
  - **`hello_timer`** — a 250M-step run driven by RP2350 timer interrupts
    (~22 s; exactly 19 timer-driven prints).
  - **`pio_blink`** — two PIO blocks driving GPIO3 and GPIO32, the latter through
    the RP2350 GPIOBASE pin-window.
- RP2350 PIO **GPIOBASE** pin-window: register `0x168` (`gpiobase = value & 16`)
  re-bases a PIO block's internal 32-pin window onto chip GPIO16..47, with the
  matching `checkChangedPins` offset so GPIO16..47 are actually notified.
- Fork identity: GitHub Actions CI (Node 20 + 22), [CREDITS.md](./CREDITS.md),
  [ROADMAP.md](./ROADMAP.md), [README.md](./README.md), and the demo firmware
  fixtures the integration tests run.
- Digital-twin hero light-show GIFs and docs (the `ghostshow` firmware stepped
  through the RP2350 bootrom, SIO, timers, and PIO).

### Changed

- Adapted the imported engine to upstream's NodeNext ESM module resolution.
- Parameterized the peripheral layer to be multi-chip: `RP2040` and `RP2350` both
  implement a shared **`IRPChip`** interface, peripherals depend on `IRPChip`
  instead of the concrete chip, and `GPIOPin` delegates function-select dispatch
  to the chip. `npx tsc --noEmit` is now clean (was 63 errors).
- Widened the PIO pad mask to 32 bits for the RP2350 (`isRp2040 ? 0x3fffffff :
  0xffffffff`); upstream hardcoded the RP2040 30-bit mask.

### Fixed

- **RV32M multiply family.** `MUL`/`MULH`/`MULHU` are now exact via
  `Math.imul` / `BigInt` (the old float64 `*` was wrong above 2⁵³); **`MULHSU`
  was undecoded and crashed the core** and is now implemented.
- **Synchronous trap entry.** `ECALL`/`EBREAK` no longer skip the handler's first
  instruction (they previously landed at `mtvec + ilen`).
- **Hazard3 external IRQ 0** (TIMER0) is now delivered (NOIRQ is tested via the
  `MEINEXT` sign bit, not `irq == 0`).
- **Base-ISA defects:** `SLTIU` immediate sign-extension, `JALR` LSB masking,
  `CSRRC` write gating, warm-reset PC restore, and the trap-entry `mstatus`
  update (clear only MIE, preserve MPP).
- **Zcb** compressed instructions the RP2350 bootrom needs.
- **`MEINEXT` reset value** (found by lockstepping against c1570's engine): it now
  resets to NOIRQ, so the IRQ-0 gate no longer takes a *phantom* IRQ 0 the instant
  firmware enables interrupts (this was the `hello_timer` stall).
- **`MTVEC` mode-bit masking** (also found by lockstepping): trap targets now mask
  `mtvec[1:0]`, so a vectored mtvec (RP2350 firmware sets `0x20000001`) no longer
  sends an exception to an odd address and crashes (this was the `pio_blink` crash).

Each fix above is guarded by a falsifiable regression test in
[`src/riscv/test/cpu-fixes.spec.ts`](./src/riscv/test/cpu-fixes.spec.ts), proven to
fail on the pre-fix engine (a negative control). One deferral is kept on purpose:
the illegal-instruction `throw` remains a debug aid rather than `mcause = 2`.

[Unreleased]: https://github.com/GhostRoboticsLab/rp2350js_emulator/compare/rp2350-v0.1.0...HEAD
[rp2350-v0.1.0]: https://github.com/GhostRoboticsLab/rp2350js_emulator/releases/tag/rp2350-v0.1.0
