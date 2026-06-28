## What & why

<!--
A short, concrete description of the change and the reason for it. Name real
things: the instruction, register, peripheral, or test involved (e.g. "MULHSU
was undecoded", "MTVEC mode bits weren't masked", "GPIOBASE pin-window"). If
this corrects RISC-V behavior, state the spec rule and how the engine violated it.
-->

Closes #

## Checklist

- [ ] Where behavior changed, a regression test was added and **PROVEN to fail on the pre-fix engine** (negative control — see `src/riscv/test/cpu-fixes.spec.ts`).
- [ ] `npm test` is green (348+ tests, 0 skipped).
- [ ] `npx tsc --noEmit` is clean.
- [ ] prettier + eslint clean (`npm run format:check` && `npm run lint`).
- [ ] DCO sign-off present on every commit (`git commit -s`); no co-author trailers.
- [ ] For any imported code, original authorship and [CREDITS.md](../CREDITS.md) are preserved.
- [ ] [ROADMAP.md](../ROADMAP.md) / [CHANGELOG.md](../CHANGELOG.md) updated if this lands or defers a tracked item.
