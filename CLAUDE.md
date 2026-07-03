# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`rp2350js` is a fork of [wokwi/rp2040js](https://github.com/wokwi/rp2040js) that adds emulation of the
**RP2350** (Raspberry Pi Pico 2) **Hazard3 RISC-V** cores. Two chips live in one codebase: the
original RP2040 (ARM Cortex-M0+) and the new RP2350 (RV32IMAC + Zba/Zbb/Zbs/Zcb). It is a pure-software
instruction-by-instruction emulator — no hardware in the loop. Lineage (all MIT, all credited in
`CREDITS.md`): wokwi/rp2040js → c1570/rp2040js (RP2350 core) → this fork (re-based onto latest upstream,
RISC-V core corrected). See `ROADMAP.md` for the defect log and deferred work.

## Commands

```bash
npm install                              # Node >= 18
npm test                                 # vitest run — 379 pass, 0 skipped. hello_timer ~22s (250M-step firmware run)
npm run test:watch                       # vitest watch mode
npx vitest run src/riscv                 # RISC-V correctness suite only
npx vitest run src/rp2350.spec.ts        # RP2350 firmware integration tests only
npx vitest run -t 'MULHSU'               # single test by name substring
npx tsc --noEmit                         # MUST stay clean (was 63 errors before peripheral parameterization; don't regress)
npm run lint                             # eslint . --ext .ts
npm run format:check                     # prettier check
npm run build                            # dual ESM (tsconfig.json) + CJS (tsconfig.cjs.json) build into dist/
npm start                                # RP2040 demo runner (tsx demo/emulator-run.ts) — NOT RP2350; see below
npm run start:rp2350 -- --image f.uf2    # RP2350 (RISC-V) CLI runner: boots a .uf2/.hex, streams UART, --pin N counts GPIO edges
```

There is no vitest config file — vitest auto-discovers `*.spec.ts`. prettier + eslint auto-run on
commit via husky + lint-staged.

## Architecture

### Two chips behind one interface (`IRPChip`)

`src/rpchip.ts` defines `IRPChip`. Both `RP2040` (`src/rp2040.ts`) and `RP2350` (`src/rp2350.ts`)
implement it, and **every peripheral depends on `IRPChip`, not the concrete chip**. The file-naming
convention is load-bearing:

- **`*_rp2350.ts` / `peripherals/*_rp2350.ts`** — RP2350 variants (e.g. `sio_rp2350.ts`,
  `irq_rp2350.ts`, `peripherals/io_rp2350.ts`, `dma_rp2350.ts`, `pll_rp2350.ts`). These are c1570's,
  hardened here.
- **Everything else in `src/` and `src/peripherals/`** — upstream wokwi/rp2040js (RP2040).
- **`src/riscv/`** — the entire Hazard3 RISC-V CPU, assembler, and RV32C decoder (c1570's, with our fixes).

Peripherals are parameterized (IRQ/DREQ base ids, register offsets, reset masks) so one class serves
both chips — e.g. `RPTimer` takes a `timer_irq_base`, `RPPIO` takes `gpiobase`. When adding chip
behavior, prefer parameterizing the shared peripheral over forking a `_rp2350` copy; each such
parameterization is also a candidate upstream PR to Wokwi (see end of `ROADMAP.md`).

### Two CPU cores

- **RP2040:** `src/cortex-m0-core.ts` — ARM Thumb. One core.
- **RP2350:** `src/riscv/cpu.ts` — Hazard3 RISC-V, dual-core (`core0`, `core1`). `src/riscv/rv32c.ts`
  decompresses compressed instructions; `src/riscv/Assembler/` is a test-only RISC-V assembler. By
  default both cores run from reset; for faithful SDK bring-up call `rp2350.holdCore1ForLaunch()` — core1
  parks in the bootrom wait-loop until core0's `multicore_launch_core1` FIFO handshake releases it (see
  the dual-core `ghostshow_mc` gate in `src/ghostshow.spec.ts`).

### Two *different* execution/stepping models — do not assume they share a driver

- **RP2040** runs through `Simulator` (`src/simulator.ts`): a `setTimeout` loop calling
  `core.executeInstruction()` and ticking a `SimulationClock` by cycle count. This is what `npm start`
  and the GDB server use.
- **RP2350** has its own model on the chip itself: `rp2350.step()` → `stepCores()` (runs core0 one
  instruction, then lockstep-runs core1 until `core1.cycles` catches up to `core0.cycles`) →
  `stepThings(cycles)` (steps all three PIO blocks per cycle and ticks the clock). RP2350 has a CLI
  runner (`npm run start:rp2350`, `demo/emulator-run-rp2350.ts`) but no `Simulator`/GDB integration;
  internally you drive it by calling `step()` in a loop yourself (see `src/ghostshow.spec.ts`).

### How RP2350 firmware is actually run (the pattern to copy)

`npm start` is RP2040-only. RP2350 firmware runs live in **`src/rp2350.spec.ts`**, and that is the
canonical harness. The pattern:

```ts
const rp2350 = new RP2350();
rp2350.loadBootrom(bootrom_rp2350_A2);            // from demo/bootrom_rp2350.ts (A2 bootrom)
loadHex(hex, rp2350.sram, 0x20000000);            // or rp2350.flash, 0x10000000 for flash images
rp2350.core0.pc = rp2350.core1.pc = 0x20000220;   // entry point (SRAM image) — set BOTH cores
rp2350.gpio[N].addListener(...);                  // observe pins
rp2350.uart[0].onByte = (b) => { ... };           // observe UART
for (let i = 0; i < N; i++) rp2350.step();         // drive it
```

Three firmware integration tests gate the RISC-V path — `blink_simple` (GPIO via SIO), `hello_timer`
(250M-step timer-IRQ run), `pio_blink` (PIO driving GPIO3 and GPIO32 via the GPIOBASE pin-window).
Demo firmware sources/binaries are in `demo/riscv_blink`, `demo/riscv_timer`, `demo/riscv_pio_blink`.

### Debugging technique: lockstep + gdbdiff

The two subtle RP2350 trap bugs (`MEINEXT` reset value, `MTVEC` mode-bit masking) were found by
lockstepping this engine against c1570's reference and bisecting the first architectural divergence —
not by unit tests. `debug/gdbdiff.ts` (`npm run start:gdbdiff`) diffs emulator vs. silicon registers
instruction-by-instruction over GDB. Reach for divergence-bisection when a firmware run misbehaves but
the unit suite is green.

## Conventions

- **ESM / NodeNext.** `"type": "module"`; import specifiers **must carry the `.js` extension** even in
  `.ts` files (e.g. `import { CPU } from './riscv/cpu.js'`). tsc emits both ESM (`dist/esm`) and CJS
  (`dist/cjs`).
- **The signature rule (from `CONTRIBUTING.md`):** every behavioral fix ships a **negative-control
  test — red on the pre-fix engine, green after.** A green-only test proves nothing. Unit-level RISC-V
  fixes go in `src/riscv/test/cpu-fixes.spec.ts`; behavior that only surfaces under real firmware goes
  in a firmware-integration test (`src/rp2350.spec.ts`).
- **Intentional non-fix:** the RISC-V core `throw`s on an illegal instruction instead of trapping
  `mcause=2`. This is a deliberate debug aid — don't "fix" it without discussion.
- **Commits:** short imperative subjects; DCO sign-off required (`git commit -s`); **no co-author
  trailers**. Keep PRs small — one concern each. Preserve c1570's original authorship on imported code.

## Memory map (RP2350, from `src/rp2350.ts`)

FLASH `0x10000000` · RAM/SRAM `0x20000000` · APB peripherals `0x40000000` · USB DPRAM `0x50100000` ·
SIO `0xd0000000`. Peripherals are dispatched via an address-block-indexed `peripherals[]` array;
8/16-bit register writes are replicated across the 32-bit word, and the atomic set/clr/xor register
aliases are handled in the chip's `writeUint32`.
