# Roadmap

This fork takes c1570's RP2350 / Hazard3 RISC-V work and re-bases it onto the **latest** upstream
wokwi/rp2040js, then hardens it. The RISC-V *core* is corrected and tested, and the RP2350
*peripheral* layer is now parameterized (`tsc` is clean and the chip boots a real firmware).

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

## Done — RP2350 peripheral parameterization (multi-chip)

The peripheral layer is now chip-aware. `RP2040` and `RP2350` both implement a shared **`IRPChip`**
interface, peripherals depend on `IRPChip` instead of the concrete chip, and `GPIOPin` delegates its
function-select → peripheral-output dispatch to the chip (so each chip owns its own function map —
RP2350 adds `FUNCTION_PIO2`). `npx tsc --noEmit` is **clean** (was 63 errors).

| Area | Change | Status |
|---|---|---|
| Core | `RP2040 implements IRPChip`; `BasePeripheral` holds `IRPChip` | ✅ |
| GPIO | `GPIOPin` → narrow `IGPIOChipHost`; chip-owned output dispatch; `FUNCTION_PIO2` | ✅ |
| RESETS | `reset_mask` per-chip (RP2350 = `0x1fffffff`, 29 blocks) — **was the boot-hang** | ✅ |
| TIMER | `timer_irq_base` param + RP2350 INTR/INTE/INTF/INTS offsets (shifted +8) | ✅ |
| PWM / ADC / USB | `IRQ`/`DREQ` base constructor params | ✅ |
| PIO | `IRPChip`, `dreq{Rx,Tx}_base`, `getPinValue`/`getPinOutputEnabled`, `gpiobase` field | ✅ |
| UART / SPI / I²C | `IRPChip`; numeric DREQ ids (the two chips' `DREQChannel` enums differ) | ✅ |
| DMA routing | peripherals raise DREQ via `IRPChip.dma_{set,clear}DREQ` | ✅ |

The **`blink_simple`** integration test now passes (RP2350 boots its A2 bootrom, runs RISC-V
firmware, drives GPIO via SIO). The RESETS `reset_mask` fix was the boot-blocker: the bootrom
de-asserts a high-numbered reset block and spins on `RESET_DONE` for it.

## Done — two RISC-V core trap bugs (`hello_timer` now passes)

Lockstepping this engine against c1570's original (which passes both firmware tests) and bisecting
the first architectural divergence surfaced two real core bugs:

| Bug | Symptom | Fix |
|---|---|---|
| `MEINEXT` reset value was 0 | reads as "IRQ 0, NOIRQ clear"; the `!NOIRQ` gate took a phantom IRQ 0 the moment interrupts were enabled, corrupting the stack — this stalled `hello_timer` | reset `MEINEXT` to NOIRQ (index 0 still deliverable) |
| trap target used raw `mtvec` | exceptions/direct interrupts must go to `mtvec & ~3`; a vectored mtvec (RP2350 = `0x20000001`) sent an `EBREAK` to odd `0x20000001` → crash | mask the MTVEC mode bits → BASE |

`hello_timer` is now **un-skipped and passing** (250M-step run, exactly 19 timer-driven prints). The
phantom-IRQ fix also confirms the earlier `!NOIRQ` IRQ-0 gate is correct *given a correct reset*.

## Next — `pio_blink` (the last skipped integration test)

Its early crash is fixed (the MTVEC mask above). What remains is the **RP2350-specific PIO feature
set**, which c1570 implemented and upstream lacks — port it from his `pio.ts`:

- **GPIOBASE register** (`0x168`, `gpiobase = value & 16`) — moves the PIO's 32-pin window so it can
  drive GPIO32; also a `getPinValue`/`pinValuesChanged`/`checkChangedPins` index offset.
- **32-bit pin mask** for RP2350 (upstream hardcodes the RP2040 `0x3fffffff` 30-bit mask).
- **`IN_COUNT`** masking and the RP2350 **PIO IRQ-index mode** (`resolveIrqTarget`), plus the
  neighbour state-machine synchronous restart.

Each peripheral's parameterization is also a natural **upstream PR to wokwi/rp2040js** ("make the
peripheral layer multi-chip"), see below.

## Later — upstreaming to Wokwi

Offer the work back to [wokwi/rp2040js](https://github.com/wokwi/rp2040js) as small, reviewable PRs
in the maintainer's preferred order (the chip-abstraction + GPIO/PIO first, then the RISC-V core
behind a flag) rather than one large drop.
