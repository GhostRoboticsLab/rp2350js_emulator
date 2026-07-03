# RP2350 emulator — realism & completeness plan

**Goal:** make `rp2350js` much more realistic and complete, and *prove it* by running the real
**GhostLabs `ghostshow`** firmware on both PGA2350 carriers (full `x` + `mini`) — headless in the
test suite and live in the browser digital-twin — while the web sim stays running for manual watching.

This plan is the single source of truth. Each item lists the file, the **negative-control test** it
ships with (red before, green after — the project's signature rule), and a status box.

---

## Strategy (why this order)

1. **Stand up the living verification harness first** so every later change is watched, not asserted:
   the `ghostshow` firmware (both carriers) becomes an emulator integration test *and* the browser
   twin, driven by **this fork** (not the vendored c1570 WIP the sim currently uses).
2. **Tier 0/1 (ISA survival + correctness)** — cheap, high-impact, unblock arbitrary stock firmware.
3. **Tier 2 (runnability)** — a real RP2350 Simulator/CLI/UF2 loader + GDB target, the force-multiplier.
4. **Tier 3 (timing)** — PIO CLKDIV + `clk_sys`=150 MHz: the fidelity under the WS2812/"digital twin" claim.
5. **Tier 4 (RP2350-new peripherals)** — stop crashing/lying on OTP, watchdog, POWMAN, doorbells, TICKS…
6. **Tier 5 (architectural honesty)** — store-and-readback + document scope (M33, PMP, boot flow).

**Scope honesty:** the full roadmap spans small → multi-month (a Cortex-M33 core). "Complete
everything" here means: **finish Tiers 0–3 fully verified**, do the tractable Tier-4 peripherals,
and **scaffold + document** the large Tier-5 items rather than fake them. Deferrals are marked ⏸ and
explained, never silently skipped.

---

## Verification harness (how we test — GhostLabs carriers)

- **Firmware:** `…/pga2350-carrier/firmware/ghostshow/build/sim-riscv/ghostshow.hex` (RISC-V, no-flash
  SRAM image, entry `0x20000220`). Both carriers run this same build; `x` vs `mini` differ only in LED
  geometry, so one firmware test covers both.
- **Emulator integration test** (`src/rp2350.spec.ts` or new `ghostshow.spec.ts`): boot A2 bootrom →
  `loadHex` into SRAM → step → decode the GP28 WS2812 bitstream → assert a valid 24-pixel frame and
  expected console output. This is the 4th firmware gate, alongside blink/hello_timer/pio_blink.
- **Browser twin** (`…/ghostshow/sim`, Vite): repointed from `vendor/rp2040js` (c1570) to **this fork**,
  so the dashboard renders *this engine* running ghostshow. `npm run dev` (HMR) stays running; editing
  the fork's `.ts` hot-reloads the ghost → the dev is watchable live. Model dropdown switches full/mini.
- **Dual-core stretch:** the sim parks core1 today (c1570's dual-core was WIP). This fork fixed
  dual-core (hello_timer/SIO-FIFO/MEINEXT), so running ghostshow's core1 float-field is a concrete,
  visible realism win once the `multicore_launch_core1` FIFO handshake lands (Tier 5).

---

## Verified current state (spot-checked against code, not assumed)

- `wfi` (`0x10500073`) → `throw` at `cpu.ts:1315`; RV32A AMO table (`cpu.ts:917-949`) handles only
  func7 `0x4/0x20/0x22/0x30`, else throws; `misa` advertises A anyway (`cpu.ts:76`).
- `mcycle/minstret/cycle/instret` read 0 (not in `getCSR`; `0xc00/0xc02` are no-op writes).
- **Real bug:** `sio-core.ts:320,323` use `if (value | FIFO_ST_*_BITS)` (always truthy) — any FIFO_ST
  write wipes both WOF+ROE latches and can drop the SIO FIFO IRQ. Should be `&`.
- `clkSys`/`clkPeri` frozen at `125*MHz` (`rp2350.ts:64-65`), never driven by PLL; RP2350 SDK = 150 MHz.
- PIO `clockDivInt/Frac` + delay slots stored but never consumed → every SM runs at full `clk_sys`.
- `RPWatchdog` imported but not instantiated (`rp2350.ts:142` UnimplementedPeripheral); PWM = 8 slices (RP2350 has 12).
- OTP/SHA/TRNG/GLITCH/POWMAN/TICKS/DOORBELL absent or stubbed (unmapped → `throw`).

---

## Tier 0 — Quick wins (small, high-value)

- [ ] **0.1 Fix FIFO_ST write-1-to-clear** — `sio-core.ts:320,323` `|` → `&`.
  *NC test:* latch ROE, write only WOF bit, assert ROE persists. *(→ `sio.spec.ts`)*
- [ ] **0.2 Decode `wfi` (`0x10500073`)** — SYSTEM func3=0 table `cpu.ts:~1289`, set `waiting=true`, reuse
  `h3.block`/`checkForInterrupts` wake path (wfi ignores MSTATUS.MIE).
  *NC test:* wfi with pending enabled IRQ wakes+traps; without, cycles advance, PC frozen. *(→ `cpu-fixes.spec.ts`)*
- [ ] **0.3 Wire counters** `mcycle 0xb00 / minstret 0xb02 / cycle 0xc00 / instret 0xc02` (+high words)
  in `getCSR` → `cpu.cycles`. *NC test:* step N, assert `mcycle` advanced ~N.
- [ ] **0.4 Enable `RPWatchdog`** (`rp2350.ts:142`), tick 1 MHz (drop RP2040-E1 2 MHz doubling `watchdog.ts:43`).
  *NC test:* SCRATCH write survives read; REASON not all-ones after clean boot.
- [ ] **0.5 PWM 8→12 slices** via constructor param (RP2040=8, RP2350=12); extend WRAP IRQ/DREQ ranges.
  *NC test:* toggle slice 11.
- [ ] **0.6 Add register-form Zbb/Zbs:** ROL (f3=1,f7=0x30), ROR (f3=5,f7=0x30), BINV reg (f3=1,f7=0x34),
  ORC.B (f3=5,f7=0x14) — currently throw. *NC tests:* one per op (folds into 1.2 harness).

## Tier 1 — Stock-firmware survival (ISA)

- [ ] **1.1 Complete RV32A** — dispatch on `func5=func7>>2` (mask aq/rl); add amoadd/xor/min/max/minu/maxu.w
  and LR.W/SC.W with a per-core reservation. *NC tests:* one per AMO + an LR/SC round-trip.
- [ ] **1.2 Extend the RISC-V test assembler + table-driven ISA specs** — cover A + Zba/Zbb/Zbs/Zcb + RVC
  round-trips (closes the biggest coverage hole; is the NC harness 0.6/1.1 need). *(→ new `isa.spec.ts`)*

## Tier 2 — Runnable & debuggable (force-multiplier)

- [ ] **2.1 `RP2350Simulator` + CLI** — generalize `IGDBTarget` (`rp2040:RP2040` → `chip:IRPChip`), add a
  driver over `rp2350.step()`, `demo/emulator-run-rp2350.ts`, `npm run start:rp2350 -- --image … --entry …`.
- [ ] **2.2 UF2 family-id loader** — `loadUF2(chip, …)` reads `familyID` (RISC-V `0xe48bff5a` vs ARM/data),
  routes flash vs SRAM, warns on mismatch. *NC test:* a RISC-V .uf2 lands at the right base.
- [ ] **2.3 Hazard3 GDB target + RISC-V `gdbdiff`** — x0..x31+pc, RISC-V `target.xml`, CSR access, per-core
  `Hg`; revives the lockstep/gdbdiff method for the RISC-V core. ⏸ *large; after 2.1.*
- [ ] **2.4 RISC-V disassembler + per-instruction trace** — reuse `cpu.ts`/`rv32c.ts` decode tables. *pairs with 2.3.*

## Tier 3 — Timing fidelity (the "digital twin" claim)

- [ ] **3.1 Honor PIO CLKDIV + delay slots** — per-SM fractional accumulator (`curClockInt/Frac`), advance
  on rollover, consume delay slots. *NC test:* CLKDIV=2 toggles a pin at half the CLKDIV=1 rate.
- [ ] **3.2 Drive `clkSys/clkPeri` from PLL/CLOCKS, default 150 MHz** — make mutable, compute from
  refdiv/fbdiv/postdiv + mux. *NC test:* set PLL cfg → `clkSys` changes → UART divider matches.
- [ ] **3.3 (opt) flash XIP wait-states + per-beat DMA time** ⏸ *large; after 3.2.*

## Tier 4 — RP2350-new peripherals that crash or lie

- [ ] **4.1 OTP + OTP_DATA** backing-store peripheral (bootrom/sys_info reads stop throwing). *NC:* seeded row read.
- [ ] **4.2 POWMAN always-on 64-bit timer** + password-gated regs (RP2350 has no RTC → no time-of-day today). *NC:* set/read AON count; bad password rejected.
- [ ] **4.3 Inter-core DOORBELL + `SIO_IRQ_BELL`** (`sio_rp2350.ts`). *NC:* ring from core0 → core1 takes BELL.
- [ ] **4.4 TICKS block** + gate timer/mtime/watchdog on it. *NC:* RUNNING=0 until CTRL enabled.
- [ ] **4.5 SHA-256 (real, NIST-vector-tested) + TRNG (seeded PRNG) + GLITCH_DETECTOR (benign)** ⏸ *after 4.1-4.4.*

## Tier 5 — Architectural honesty (store-and-readback + document)

- [ ] **5.1 Track privilege M/U** — set in trapEntry (save MPP), restore in mret, ecall cause from mode, gate CSR access. *NC:* U-mode ecall → mcause==8.
- [ ] **5.2 PSM core1 reset-hold + real FIFO launch handshake** — unblocks dual-core ghostshow in the sim. *NC:* launch core1 via FIFO, not manual PC.
- [ ] **5.3 Store PMP CSRs; explicit-reset ACCESSCTRL; reject Arm-vector image loudly; document scope**
  (no M33; leader/follower quantization; boot-flow bypass) in `ROADMAP.md`. ⏸ *enforcement deferred.*
- [ ] **5.4 ⏸ Cortex-M33 core** — out of scope this cycle (multi-month; M0+ not reusable). Documented as a boundary.

---

## Running it

```bash
# emulator tests (this repo)
npm test                                   # full suite incl. ghostshow gate
npx vitest run src/riscv                    # ISA correctness
npx vitest run -t ghostshow                 # the carrier integration test

# the live web twin (GhostLabs carrier repo, repointed at this fork)
cd …/pga2350-carrier/firmware/ghostshow/sim && npm run dev   # http://localhost:5173  — Model dropdown = full/mini
```

## Status log

**Verification harness — DONE.** `src/ghostshow.spec.ts` boots the real GhostLabs ghostshow RISC-V
image (both carriers), decodes the GP28 WS2812 line into 24-px frames, asserts boot/console/power/
input. The carrier web twin (`…/ghostshow/sim`) is repointed from the vendored c1570 engine to **this
fork** via a symlink (+ `vite.config` fs.allow) and runs live with HMR — editing the fork hot-reloads
the ghost. Confirmed rendering in colour in the browser. Suite: **377 pass** (was 348).

### Landed (each its own signed commit, negative-control tested, suite green)

- **Tier 3.1** ✅ PIO fractional CLKDIV + delay slots — the keystone. GP28 '1'/'0' pulses went from
  ~8-32 ns to ~1050/300 ns; the ghost decodes from all-black to colour. No-op at divider=1.0 (pio_blink exact).
- **Tier 0.1** ✅ FIFO_ST write-1-to-clear (`|`→`&`) — real correctness bug.
- **Tier 0.2** ✅ WFI decode (idle loops park instead of aborting).
- **Tier 0.3** ✅ mcycle/minstret/cycle/instret CSRs (were 0).
- **Tier 0.4** ✅ Watchdog enabled (1 MHz tick, working SCRATCH).
- **Tier 0.5** ✅ PWM 12 slices + fixed the latent `PWMChannel.get en` bug (EN read always returned 0).
- **Tier 0.6** ✅ ROL/ROR/BINV/ORC.B (Zbb/Zbs register forms that threw).
- **Tier 1.1** ✅ Full RV32A atomics (all AMOs + LR/SC with a per-core reservation).
- **Tier 2.1/2.2** ✅ `npm run start:rp2350` CLI + family-id-aware UF2 loader (routes flash/SRAM, flags
  Arm images — the Tier 5.3 loud-Arm-rejection). Verified booting ghostshow .hex and .uf2.
- **Tier 4.3** ✅ Inter-core DOORBELL + SIO_IRQ_BELL (multicore_doorbell_*).
- Added the first `*_rp2350` peripheral specs (watchdog, pwm) — starts closing Tier 4.22's gap.

### Deferred (with rationale — captured as todos, not silently dropped)

- **Tier 3.2 (clk_sys 150 MHz from PLL)** ⏸ — a naive default change from 125→150 shifts `hello_timer`'s
  250M-step timing (2 s → 1.67 s) and would break that green firmware gate. The right fix is
  PLL-*driven* per-firmware clocking + recalibrating the timer-print expectation; staged to avoid
  destabilising the suite. The ghost already decodes correctly at 125 MHz.
- **Tier 1.2 (assembler-based table-driven ISA harness)** ⏸ — the hand-encoded `cpu-fixes.spec.ts`
  negative controls already satisfy the signature rule for every op added; extending the in-repo
  assembler to all of A/Zb*/C is a large separate task.
- **Tier 2.3/2.4 (Hazard3 GDB target + RISC-V disassembler)** ⏸ — large; the CLI runner covers the
  common "run a .uf2" need.
- **Tier 4.1/4.2/4.4/4.5 (OTP, POWMAN AON timer, TICKS, SHA-256/TRNG)** ⏸ — register-model stubs to
  stop unmapped-throw / 0xffffffff-lie; not exercised by the ghostshow twin, so staged behind the
  higher-value ISA/timing work.
- **Tier 5.1/5.2/5.3-rest (privilege M/U, PSM core1 reset-hold + real FIFO launch, PMP CSR storage)** ⏸.
  5.2 would unblock dual-core ghostshow in the sim (a great demo) but is a larger, riskier change.
- **Tier 5.4 (Arm Cortex-M33 core)** ⏸ — out of scope (multi-month; M0+ not reusable). Documented as
  a hard boundary; the UF2 loader now rejects Arm images loudly.

**Note:** the carrier repo's sim wiring (vendor symlink → this fork, `vite.config` fs.allow) is local
dev scaffolding and intentionally NOT committed to that repo (machine-specific absolute path).
