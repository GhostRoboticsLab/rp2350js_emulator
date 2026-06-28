# Security Policy

`rp2350js` is a development-time, instruction-level emulator of the RP2350 (Hazard3 RISC-V)
that **executes arbitrary firmware binaries inside a Node.js process on your machine**. That
is its job. This file states what it does and does not defend against, what counts as a
security issue here, and how to report one.

## Scope & threat model (read this first)

This is a **digital twin for bringing up firmware**, not a security sandbox. It steps the
Hazard3 core through the RP2350 bootrom and your firmware to surface a wrong `MUL` or a dropped
timer IRQ as a red test — see [README.md](./README.md) and [ROADMAP.md](./ROADMAP.md). It is
**not** an isolation boundary.

Concretely:

- The emulated guest (firmware) runs in the **same OS process** as the emulator host. There is
  no syscall filter, no separate address space, no capability drop, no resource cap. The guest
  is confined only by the correctness of the host code that models the machine.
- A firmware image is **code you are choosing to run on your computer**, with whatever access
  the Node process has. Treat running a firmware binary in this emulator exactly as you would
  treat running any other untrusted program locally.
- **Do not run untrusted firmware expecting isolation.** If you need to contain a hostile
  binary, run the emulator itself inside a real sandbox (container, VM, locked-down user) — the
  emulator does not provide one.

Within that honest boundary, the host code should still be sound: a correct emulator must not
let the modeled machine reach beyond the modeled machine.

## What is a security issue here vs. a normal bug

A **security issue** is a defect in the **host** (the TypeScript/Node emulator process), for
example:

- A memory-safety / host-impact defect in host code — an unbounded read or write into host
  memory, a crash or hang reachable from emulated state that a normal firmware run can trigger,
  unbounded host resource consumption driven by guest behavior.
- A guest that can affect the **host beyond the emulated machine** — escaping the modeled
  address space, reaching the host filesystem, network, environment, or process outside the
  documented emulation surface; influencing the host beyond producing emulated outputs.
- A vulnerable dependency (a CVE in a package we ship) that is actually reachable in how this
  project uses it.

A **normal bug** is wrong *emulation*, and belongs in the
[issue tracker](https://github.com/GhostRoboticsLab/rp2350js_emulator/issues), not here:

- "Firmware misbehaves" or "the emulated result is wrong" — a mis-decoded instruction, an
  off-by-one in a peripheral, a wrong CSR value (`MTVEC`, `MEINEXT`, `GPIOBASE`), an
  `MULHSU`/`MULH` precision error, a missed IRQ, a PIO pin-window mismatch. These are
  correctness defects in the *guest model*. They are exactly the class of bug this fork exists
  to find and fix (see [README.md](./README.md)), but they are not security vulnerabilities —
  a wrong emulated result does not, by itself, cross the host boundary. File one as a normal
  issue with a falsifiable repro, ideally a failing test in the style of
  [`src/riscv/test/cpu-fixes.spec.ts`](./src/riscv/test/cpu-fixes.spec.ts).

If you are unsure which category a finding falls in, report it privately (below) and we will
triage it.

## Supported versions

Security fixes target the current fork release line only. The `v0.1.0..v1.3.3` tags are
inherited from upstream wokwi/rp2040js and are **not** this fork's releases (see
[CREDITS.md](./CREDITS.md)); they are not separately supported here.

| Version | Supported |
|---|---|
| `rp2350-v0.1.x` (this fork) | ✅ |
| inherited pre-fork tags (`v0.1.0`..`v1.3.3`) | ❌ — report upstream to [wokwi/rp2040js](https://github.com/wokwi/rp2040js) |

## Reporting a vulnerability

**Preferred:** use GitHub private vulnerability reporting — go to the repository
[**Security** tab](https://github.com/GhostRoboticsLab/rp2350js_emulator/security) and choose
**"Report a vulnerability"**. This keeps the report private until a fix is ready.

**Fallback:** email the maintainer at **pratheekb96@gmail.com**.

Please do **not** open a public issue for a suspected vulnerability.

A useful report includes: the version or commit, the host platform and Node version (CI runs
Node 20 and 22; the project requires Node >= 18), the firmware or input that triggers it, and
the observed host-side impact (crash, host read/write, resource exhaustion, escape).

What to expect:

- **Acknowledgement within 7 days** of your report.
- Coordinated disclosure: we will work with you on a fix and a disclosure timeline, and credit
  you in the release notes / [CHANGELOG.md](./CHANGELOG.md) unless you ask us not to.
- No bug-bounty program, and no legal action against good-faith research that stays within this
  policy.
