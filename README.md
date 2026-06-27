![CI](../../actions/workflows/ci.yml/badge.svg)

# rp2350js — RP2350 (Hazard3 RISC-V) emulator

A fork of [wokwi/rp2040js](https://github.com/wokwi/rp2040js) that emulates the **RP2350**
(Raspberry Pi Pico 2) **Hazard3 RISC-V** cores — a corrected, test-gated RISC-V core that boots the
A2 bootrom and runs real firmware instruction-by-instruction, with no hardware in the loop.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/ghostshow-main.gif" width="100%" alt="GhostLabs PGA2350 carrier (main): its 24-pixel WS2812 ghost matrix runs the ghostshow firmware light show — rainbow, plasma, fire, eyes — driven by this RP2350 Hazard3 emulator">
      <br><sub><b>PGA2350 carrier</b> · main</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/ghostshow-mini.gif" width="100%" alt="GhostLabs PGA2350 mini carrier: its back-nested 24-pixel WS2812 ghost matrix runs the ghostshow firmware light show, driven by this RP2350 Hazard3 emulator">
      <br><sub><b>PGA2350 carrier</b> · mini</sub>
    </td>
  </tr>
</table>

*This isn't a demo reel — it's a readout. The light show is the **`ghostshow`** firmware's [`effects.c`](https://github.com/GhostRoboticsLab/CustomPCB_ghost/tree/main/pga2350-carrier/firmware/ghostshow), and every WS2812 bit that drives it is produced by this engine stepping the Hazard3 core through the RP2350 bootrom, SIO, timers, and PIO. The boards are the [GhostLabs PGA2350 carriers](https://github.com/GhostRoboticsLab/CustomPCB_ghost) this emulator was built to bring up.*

> **Status: early but real.** The RISC-V core boots and runs RV32IMAC + Zba/Zbb/Zbs/Zcb code and
> passes a verified instruction-correctness suite. The RP2350 peripheral layer is now multi-chip
> parameterized (`tsc` is clean), and the chip boots its A2 bootrom and runs real RISC-V firmware:
> **all three** firmware integration tests pass — **`blink_simple`** (GPIO via SIO), **`hello_timer`**
> (a 250M-step run driven by RP2350 timer interrupts), and **`pio_blink`** (two PIO blocks driving
> GPIO3 and GPIO32, the latter through the RP2350 GPIOBASE pin-window). **All 348 tests pass, none
> skipped.** Some RP2350 PIO features not yet exercised by firmware remain deferred — see
> **[ROADMAP.md](./ROADMAP.md)**.

## Why a digital twin

The point of a digital twin is to fail in software, not silicon. This engine is the brain inside the
[PGA2350 carrier](https://github.com/GhostRoboticsLab/CustomPCB_ghost)'s simulation: the firmware boots
here — A2 bootrom → Hazard3 core → the WS2812 chain on GP28 — long before a board is reflowed, so a
wrong `MUL`, a dropped timer IRQ, or a mis-based PIO pin-window surfaces as a **red test**, not a dead
pixel on a soldered-down module. A Vite + TypeScript dashboard in the carrier repo drives this engine
headless, reconstructs the GP28 bitstream into 24 live pixels, and plays exactly the show above in a
browser. Same firmware binary, same instruction core — emulated here, reflowed there.

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
- `SLTIU` immediate sign-extension, `JALR` LSB masking, `CSRRC` write gating, warm-reset PC, the
  trap-entry `mstatus` update, and the **Zcb** compressed instructions the RP2350 bootrom needs.

Two further trap bugs were found by **lockstepping this engine against c1570's** (which runs the
firmware) and bisecting the first divergence — these are what make a full firmware run work, not just
the unit suite:

- **`MEINEXT` reset value.** It must reset to NOIRQ; a zeroed `MEINEXT` reads as "IRQ 0 pending", so
  the IRQ-0 gate above took a *phantom* IRQ 0 the instant firmware enabled interrupts. (This was the
  `hello_timer` stall.)
- **MTVEC mode bits.** Trap targets must mask `mtvec[1:0]`; a vectored mtvec (RP2350 firmware sets
  `0x20000001`) otherwise sends an exception to an odd address and crashes. (This was the `pio_blink`
  crash.)

Most fixes have a regression test in
[`src/riscv/test/cpu-fixes.spec.ts`](./src/riscv/test/cpu-fixes.spec.ts), each **proven to fail on
the pre-fix engine** (negative control); the two trap fixes above are covered by the `hello_timer`
firmware-integration test. The illegal-instruction `throw` is kept deliberately as a
debug aid rather than silently trapping `mcause=2`.

## Quick start

```bash
npm install
npm test       # 348 pass, 0 skipped. hello_timer takes ~22s (a 250M-step firmware run).
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
