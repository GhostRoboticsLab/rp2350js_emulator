![CI](../../actions/workflows/ci.yml/badge.svg)

# rp2350js — RP2350 (Hazard3 RISC-V) emulator

A fork of [wokwi/rp2040js](https://github.com/wokwi/rp2040js) that emulates the **RP2350**
(Raspberry Pi Pico 2) **Hazard3 RISC-V** cores, with a corrected and tested RISC-V instruction
core.

> **Status: early but real.** The RISC-V core boots and runs RV32IMAC + Zba/Zbb/Zbs/Zcb code and
> passes a verified instruction-correctness suite (345 tests). The RP2350 *peripheral* layer is
> being re-based onto the latest upstream incrementally — see **[ROADMAP.md](./ROADMAP.md)**.

## Lineage & credit

Three links in a chain, all MIT, all credited (see **[CREDITS.md](./CREDITS.md)**):

1. **[wokwi/rp2040js](https://github.com/wokwi/rp2040js)** (Uri Shaked) — the RP2040 emulator base.
2. **[c1570/rp2040js](https://github.com/c1570/rp2040js)** (`rp2350js/WIP`) — added the entire
   RP2350 / Hazard3 RISC-V core (~50 h). Imported here with authorship preserved.
3. **This fork** — re-bases c1570's RP2350 work onto the latest upstream and fixes the RISC-V core.

## What this fork fixes in the RISC-V core

c1570's core is an honest WIP; an adversarial spec review (7 ISA-area reviewers, each finding
independently verified) surfaced 19 confirmed defects. We fixed them, each with a falsifiable test:

- **The whole RV32M multiply family.** `MUL` used JavaScript's float64 `*`, silently wrong for any
  product above 2⁵³ (~95% of random operands); `MULH`/`MULHU` lost precision; **`MULHSU` was
  undecoded and crashed the core.** Now exact via `Math.imul` / `BigInt`.
- **Synchronous trap entry.** `ECALL`/`EBREAK` skipped the handler's first instruction (landed at
  `mtvec + ilen`) — would break a FreeRTOS `portYIELD`. Fixed.
- **Hazard3 external IRQ 0** (TIMER0_IRQ_0) was never delivered (NOIRQ tested via `irq==0` instead
  of the `meinext` sign bit). Fixed.
- `SLTIU` immediate sign-extension, `JALR` LSB masking, `CSRRC` write gating, warm-reset PC,
  `mip.MEIP` preemption gating, the trap-entry `mstatus` update, and the **Zcb** compressed
  instructions the RP2350 bootrom needs.

Every fix has a regression test in
[`src/riscv/test/cpu-fixes.spec.ts`](./src/riscv/test/cpu-fixes.spec.ts), each **proven to fail on
the pre-fix engine** (negative control). The illegal-instruction `throw` is kept deliberately as a
debug aid rather than silently trapping `mcause=2`.

## Quick start

```bash
npm install
npm test       # 345 pass, 3 skipped (chip-level integration; see ROADMAP)
```

The RISC-V correctness suite alone:

```bash
npx vitest run src/riscv
```

## Layout

- `src/riscv/` — the Hazard3 RISC-V CPU, assembler, and tests (c1570's, with our fixes).
- `src/rp2350.ts`, `src/rpchip.ts`, `src/*_rp2350.ts`, `src/peripherals/*_rp2350.ts` — the RP2350
  chip and its peripheral variants (c1570's).
- everything else — upstream wokwi/rp2040js (RP2040).

## License

MIT — see [LICENSE](./LICENSE) and [CREDITS.md](./CREDITS.md).
