# Roadmap

This fork takes c1570's RP2350 / Hazard3 RISC-V work and re-bases it onto the **latest** upstream
wokwi/rp2040js, then hardens it. The RISC-V *core* is in good shape; the RP2350 *peripheral* layer
is the main outstanding work.

## Done — RISC-V core correctness

An adversarial spec review of c1570's core found 19 confirmed defects; all are fixed and guarded by
falsifiable tests (`src/riscv/test/cpu-fixes.spec.ts`).

| Area | Defect | Status |
|---|---|---|
| RV32M | `MUL` low word via float64 `*` (wrong > 2⁵³) | ✅ `Math.imul` |
| RV32M | `MULH` high word truncates toward zero (wrong for negatives) | ✅ BigInt |
| RV32M | `MULHSU` undecoded → core abort | ✅ implemented |
| RV32M | `MULHU` off-by-one near 2³² | ✅ BigInt |
| Trap | `ECALL`/`EBREAK` land at `mtvec+ilen` (skip handler insn) | ✅ `branch_taken` flag |
| Trap | jump/branch to address 0 dropped (sentinel collision) | ✅ `branch_taken` flag |
| Trap | `mstatus` on trap wiped MPP (was `&= 1<<7`) | ✅ clear only MIE |
| Reset | warm reset never restores PC | ✅ |
| RV32I | `SLTIU` immediate not sign-extended | ✅ |
| RV32I | `JALR` LSB not masked | ✅ |
| Zicsr | `CSRRC` gated on value, not `rs1` index | ✅ |
| Xh3irq | external IRQ 0 (TIMER0) never delivered | ✅ NOIRQ via bit 31 |
| Xh3irq | `mip.MEIP` gated by PPREEMPT not PREEMPT | ✅ |
| RVC | Zcb (`c.lbu/lhu/lh/sb/sh`, `c.zext/sext.b/h`, `c.mul`, `c.not`) | ✅ completed |
| Trap | illegal instruction `throw`s instead of `mcause=2` | ⏸ intentional debug aid |

## Next — RP2350 peripheral parameterization (the main work)

c1570 made the peripheral layer chip-aware: each peripheral takes its **IRQ number and DMA DREQ
channels** as constructor parameters (RP2350's differ from RP2040's), routed through an `IRPChip`
interface. On *this* (latest-upstream) base the shared peripherals are still RP2040-parameterized,
so:

- **Type-clean the build** (`npm run build` / `tsc`). The engine *runs* (the test suite is green
  via vitest, which transpiles without type-checking), but `tsc` still reports the `IRPChip`-vs-
  `RP2040` and constructor-arity mismatches. Porting the `IRPChip` abstraction + optional
  IRQ/DREQ parameters onto the upstream peripherals resolves these.
- **Un-skip the three chip-level integration tests** in `src/rp2350.spec.ts` (`blink_simple`,
  `hello_timer`, `pio_blink`). They assert c1570's exact GPIO/UART behaviour and currently fail
  **identically on the pristine import** — i.e. they need the RP2350-parameterized peripherals,
  not a CPU fix.

Each peripheral's parameterization (ADC, I²C, PWM, SPI, PIO, TIMER, UART, DMA, …) is a small,
self-contained change — and a natural **upstream PR to wokwi/rp2040js** ("make the peripheral layer
multi-chip"), see below.

## Later — upstreaming to Wokwi

Offer the work back to [wokwi/rp2040js](https://github.com/wokwi/rp2040js) as small, reviewable PRs
in the maintainer's preferred order (the chip-abstraction + GPIO/PIO first, then the RISC-V core
behind a flag) rather than one large drop.
