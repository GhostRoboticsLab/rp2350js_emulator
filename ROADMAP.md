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

## Done — `pio_blink` (PIO drives GPIO32 via GPIOBASE)

The early crash was fixed by the MTVEC mask above; the remaining gap was the RP2350 **PIO pin-window**
feature. `pio_blink` runs the classic counter-blink (`pull / out y / mov x,y / set pins / jmp x--`)
on two PIO blocks — one driving GPIO3/4, one driving GPIO32/33 — and asserts exactly two rising
edges on each. GPIO32 is only reachable once a PIO block re-bases its internal 32-pin window:

| Change | Why | Status |
|---|---|---|
| **GPIOBASE register** (`0x168`, `gpiobase = value & 16`) | re-bases the PIO's 32-pin window onto chip GPIO16..47, so internal pin 16 = GPIO32 | ✅ |
| `checkChangedPins` offset (loop 0..31, `gpio[pinIndex + gpiobase]`) | the old loop did `1 << gpioIndex` over `gpio.length`, which aliases pins 32..47 onto 0..15 (JS shifts are mod-32) and never applied the offset — GPIO16..47 were never notified | ✅ |
| **32-bit pad mask** (`isRp2040 ? 0x3fffffff : 0xffffffff`) | upstream hardcodes the RP2040 30-bit mask | ✅ |

`pio_blink` is **un-skipped and passing** (gpio3toggle == 2, gpio32toggle == 2 over 2M steps; the
SDK's free-SM allocator places the GPIO0..31 program on PIO2 and the GPIO32 program on PIO1). The
surgical port deliberately does **not** adopt c1570's SM step-model rewrite (`curClockInt/Frac`,
`remainingDelay`, `machinesRunning`): the blink program uses the default clock divider (1.0), at
which the new fork's one-instruction-per-cycle model and c1570's divided model are identical, so the
working RP2040 step model is left untouched (verified: 348/348 tests pass).

## Next — remaining RP2350 PIO features (deferred, not yet exercised)

c1570 also implemented these RP2350 PIO behaviours; none are exercised by `pio_blink`, so each is
deferred to land with its own falsifiable test rather than ported unverified:

- **`IN_COUNT`** masking — masks the low pins kept by `IN PINS` / `MOV x, PINS` (RP2350 only).
- **PIO IRQ-index mode** (`resolveIrqTarget`) — `WAIT IRQ` / `IRQ` instructions can target a
  neighbouring PIO block (prev/next) or use the relative-index encoding.
- **Neighbour state-machine synchronous restart** — `CTRL` bits 16..25 enable/disable/clk-restart
  SMs across adjacent PIO blocks atomically.
- **`FJOIN_RX`/`FJOIN_TX`** — joined 8-deep RX/TX FIFOs.
- **`WAIT PIN` gpiobase offset** — the pin-relative wait source should also honour `gpiobase`
  (subtle: the absolute-GPIO wait source must not), so it is staged separately.

Each peripheral's parameterization is also a natural **upstream PR to wokwi/rp2040js** ("make the
peripheral layer multi-chip"), see below.

## Done — realism & completeness pass (gated by the ghostshow carrier twin)

An adversarial multi-dimension audit drove a realism pass, verified against the real GhostLabs
`ghostshow` firmware (both PGA2350 carriers) running on this engine — headless (`ghostshow.spec.ts`)
and in the browser digital twin. See `plan.md` for the full tiered record. Highlights:

| Area | Change | Status |
|---|---|---|
| PIO | **fractional CLKDIV + per-instruction delay slots honoured** (were stored, never consumed) — WS2812 bit timing is now real; the ghost decodes to colour instead of all-black | ✅ |
| RV32A | full atomics — all AMOs + LR/SC with a per-core reservation (only amoswap/or/and existed; the rest aborted) | ✅ |
| RV32I/Zicsr | `wfi` decoded (idle loops parked, not aborted); mcycle/minstret/cycle/instret wired (read 0 before) | ✅ |
| Zbb/Zbs | register-form `rol`/`ror`/`binv` + `orc.b` (threw) | ✅ |
| SIO | FIFO_ST write-1-to-clear (`|`→`&`); RP2350 inter-core **DOORBELL** + SIO_IRQ_BELL | ✅ |
| Peripherals | watchdog enabled (1 MHz tick, working SCRATCH); PWM 12 slices + fixed EN read-back | ✅ |
| Tooling | `npm run start:rp2350` CLI + family-id-aware UF2 loader (routes flash/SRAM; **rejects Arm images loudly**) | ✅ |

### Known boundaries (deliberately not modelled — do not mistake green for silicon)

- **No Arm Cortex-M33 path.** This fork emulates only the two Hazard3 RISC-V cores; the SDK's default
  target is `rp2350-arm-s`, which cannot run here (the RP2040 M0+ core is not reusable). The UF2 loader
  flags such images.
- **`clk_sys` is a fixed 125 MHz**, not PLL-driven; the RP2350 SDK default is 150 MHz. Absolute
  peripheral rates are off until per-firmware PLL-driven clocking lands (deferred to avoid shifting the
  `hello_timer` gate).
- **Boot flow is bypassed** (PC jumped to the image entry; core1 not held in reset via PSM, so the
  `multicore_launch_core1` FIFO handshake isn't exercised); OTP/secure-boot/TICKS gating absent.
- **Leader/follower dual-core stepping** is core0-favoured quantised lockstep — a green multicore test
  does **not** prove race-freedom.

Deferred items (OTP/POWMAN/TICKS/SHA models, privilege M/U, PSM core1 launch, PMP CSRs, GDB target +
disassembler, PLL-driven clocking, assembler-based ISA harness) are tracked in `plan.md`.

## Later — upstreaming to Wokwi

Offer the work back to [wokwi/rp2040js](https://github.com/wokwi/rp2040js) as small, reviewable PRs
in the maintainer's preferred order (the chip-abstraction + GPIO/PIO first, then the RISC-V core
behind a flag) rather than one large drop.
