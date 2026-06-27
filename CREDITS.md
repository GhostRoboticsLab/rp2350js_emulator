# Credits

This emulator is the third link in a chain of work, all under the MIT license. Each layer is
credited here; please keep this file intact in derivatives.

## 1. rp2040js — Uri Shaked (Wokwi)

The base RP2040 emulator: CPU bus, GPIO/PIO/DMA/UART/USB peripherals, the test harness, and the
ESM/NodeNext tooling this fork builds on.

- https://github.com/wokwi/rp2040js

## 2. RP2350 / Hazard3 RISC-V — c1570

The entire RP2350 emulation core — the Hazard3 RISC-V CPU and assembler (`src/riscv/*`), the RP2350
chip (`rp2350.ts`, `rpchip.ts`, `core.ts`, `sio*.ts`, `irq_rp2350.ts`), and the RP2350 peripheral
variants (`*_rp2350.ts`, `bootram`, `powman`, …) — is **c1570's original work** (~50 hours), first
published on the `rp2350js/WIP` branch of his rp2040js fork.

- https://github.com/c1570/rp2040js (branch `rp2350js/WIP`)

It was imported here verbatim with c1570's commit authorship preserved (see the
`Import RP2350 / Hazard3 RISC-V engine from c1570/rp2040js` commit, authored to c1570). The full
253-commit history of his branch is preserved as a git bundle in the GhostLabs project that seeds
this fork.

## 3. This fork — GhostRoboticsLab / Pratheek Balakrishna

Re-bases c1570's RP2350 work onto the **latest upstream** wokwi/rp2040js, and contributes
correctness fixes to the RISC-V core (the M-extension, trap entry, the Hazard3 external-interrupt
controller, and several base-ISA instructions), each with a falsifiable regression test. See
[ROADMAP.md](./ROADMAP.md) and the `Fix RP2350 RISC-V core` commit.

The defects fixed here were surfaced by an adversarial, multi-reviewer spec audit of c1570's core;
the fixes build directly on his groundwork and are offered back to the community in that spirit.
