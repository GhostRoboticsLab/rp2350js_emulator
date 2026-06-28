# Contributing

Thanks for wanting to help. This fork takes c1570's RP2350 / Hazard3 RISC-V work, re-bases it onto
the latest upstream [wokwi/rp2040js](https://github.com/wokwi/rp2040js), and hardens it. Contributions
that move that forward are welcome.

## What fits

- **RISC-V correctness.** Bugs in the Hazard3 core — RV32IMAC + Zba/Zbb/Zbs/Zcb, the CSRs, trap entry,
  the Xh3irq external-interrupt controller. Found one? See [The core principle](#the-core-principle).
- **RP2350 peripherals.** The peripheral layer is now multi-chip parameterized against `IRPChip`; the
  next concrete worklist is the deferred RP2350 PIO features (`IN_COUNT` masking, PIO IRQ-index mode,
  neighbour-SM synchronous restart, `FJOIN_RX`/`FJOIN_TX`, the `WAIT PIN` gpiobase offset). Each is
  spelled out in **[ROADMAP.md](./ROADMAP.md)**.
- **Firmware integration tests.** New real-firmware runs that exercise a path the unit suite can't —
  in the spirit of `blink_simple`, `hello_timer`, and `pio_blink`.
- **Upstreamable refactors.** Each peripheral's parameterization is a natural small PR back to Wokwi.
  Keep that path open — see the upstreaming plan at the end of **[ROADMAP.md](./ROADMAP.md)**.

If you're unsure whether something fits, open an issue first (see [Reporting & asking](#reporting--asking)).

## The core principle

**Every behavioral fix ships with a falsifiable test that is proven to fail on the pre-fix engine — a
negative control.** This is the project's signature rule. The 19 audit defects and the two trap bugs
each landed this way; without it, a "fix" is just a claim.

A green test on the fixed engine proves nothing on its own — it might be green by accident, or testing
the wrong thing. The negative control closes that gap: the test must be **red on the old behavior and
green on the new one**, so it pins down exactly the behavior you changed.

How to author one:

1. Write the test to assert the **correct** result, with the **specific** operands or register state
   that triggers the bug. Be concrete — e.g. a `MULHSU` of operands whose product crosses 2⁵³, an
   `ECALL` checking the handler runs its *first* instruction (PC == `mtvec`, not `mtvec + ilen`), a
   trap target masking `MTVEC[1:0]`, a `MEINEXT` reset value of NOIRQ.
2. **Confirm red before the fix.** Run it against the unfixed engine and watch it fail. If it passes,
   it isn't exercising the bug — fix the test, not the engine.
3. **Confirm green after the fix.** Apply the change; the same test now passes.

Unit-level fixes go in
[`src/riscv/test/cpu-fixes.spec.ts`](./src/riscv/test/cpu-fixes.spec.ts). Behavior that only surfaces
under a real firmware run (like the `MEINEXT` and `MTVEC` trap bugs, found by lockstepping against
c1570's engine and bisecting the first divergence) goes in a firmware-integration test instead.

One deferral is kept on purpose: the illegal-instruction `throw` is a debug aid, not a silent
`mcause=2` trap. Don't "fix" it without discussion.

## Dev setup

```bash
git clone https://github.com/GhostRoboticsLab/rp2350js_emulator
cd rp2350js_emulator
npm install        # Node >= 18
npm test           # 348 pass, 0 skipped. hello_timer takes ~22s (a 250M-step firmware run).
```

The RISC-V correctness suite alone:

```bash
npx vitest run src/riscv
```

`npx tsc --noEmit` must stay clean — it is (was 63 errors before the peripheral parameterization).
Don't regress it.

## Code style

prettier + eslint are enforced via `lint-staged` + `husky`, and run automatically on commit. To check
by hand:

```bash
npm run lint
npm run format:check
```

## Commits & PRs

- **Short imperative subjects**, matching the existing history (e.g. `Port RP2350 PIO GPIOBASE
  pin-window; pio_blink now passes`).
- **DCO sign-off is required** — commit with `git commit -s`, which adds a
  `Signed-off-by: Name <email>` trailer. **No co-author trailers anywhere.**
- Work through the [pull-request template](./.github/PULL_REQUEST_TEMPLATE.md) checklist before
  opening a PR.
- **Keep PRs small and reviewable.** One concern per PR — this mirrors the upstreaming philosophy of
  offering work back to Wokwi as small, ordered PRs rather than one large drop.

## Credit & lineage

This codebase is the third link in a chain of MIT-licensed work (see **[CREDITS.md](./CREDITS.md)**).
When you touch imported code:

- **Preserve original authorship.** c1570's RP2350 / Hazard3 work was imported with commit authorship
  intact; keep it that way.
- **Keep [CREDITS.md](./CREDITS.md) and [LICENSE](./LICENSE) intact** in any derivative.

## Reporting & asking

- File bugs and requests through the [issue templates](./.github/ISSUE_TEMPLATE/) — they prompt for
  the specifics (failing test, instruction, register state) that make a report actionable.
- All participation is under the [Code of Conduct](./CODE_OF_CONDUCT.md).
