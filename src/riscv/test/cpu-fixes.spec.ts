// Regression tests for the RP2350 RISC-V core defects found in the adversarial spec review of
// c1570's fork (2026-06). Each test encodes the reviewer's repro and asserts the SPEC-correct
// result; the comment records what the original (buggy) code produced, so each test is
// falsifiable — it fails on the pre-fix engine and passes on the fixed one.
//
// Harness mirrors cpu.spec.ts: a real RP2350, drive core0 directly. Raw 32-bit encodings are
// used (with the assembly in a comment) so the tests don't depend on the assembler.
import { describe, expect, test } from 'vitest';
import { RP2350 } from '../../rp2350.js';

function freshCore() {
  const chip = new RP2350();
  chip.core1.waiting = true;
  return chip.core0;
}

describe('RV32M multiply (was computed with float64 * — wrong above 2^53)', () => {
  test('MUL low word is exact (Math.imul), not the rounded float64 product', () => {
    const cpu = freshCore();
    cpu.registerSet.setRegisterU(1, 0x10000001);
    cpu.registerSet.setRegisterU(2, 0x10000001);
    cpu.step(0x022081b3); // mul x3, x1, x2
    // (0x10000001 * 0x10000001) low32 = 0x20000001. Buggy float64 multiply gave 0x20000000.
    expect(cpu.registerSet.getRegisterU(3) >>> 0).toBe(0x20000001);
  });

  test('MULH high word is correct for a negative product (BigInt, not trunc-toward-zero)', () => {
    const cpu = freshCore();
    cpu.registerSet.setRegisterU(1, 0xffffffff); // -1
    cpu.registerSet.setRegisterU(2, 0x00000002); // 2
    cpu.step(0x022091b3); // mulh x3, x1, x2
    // signed -1 * 2 = -2 = 0xFFFFFFFFFFFFFFFE; high word = 0xFFFFFFFF. Buggy code gave 0x00000000.
    expect(cpu.registerSet.getRegisterU(3) >>> 0).toBe(0xffffffff);
  });

  test('MULHSU is decoded and correct (previously threw, aborting the core)', () => {
    const cpu = freshCore();
    cpu.registerSet.setRegisterU(1, 0xffffffff); // signed -1
    cpu.registerSet.setRegisterU(2, 0x00000002); // unsigned 2
    // mulhsu x3, x1, x2 = 0x0220a1b3. Must NOT throw.
    expect(() => cpu.step(0x0220a1b3)).not.toThrow();
    // high word of (signed -1) * (unsigned 2) = high of 0xFFFFFFFE * ... = 0xFFFFFFFF.
    expect(cpu.registerSet.getRegisterU(3) >>> 0).toBe(0xffffffff);
  });

  test('MULHU high word is exact near a 2^32 boundary (BigInt, not float64 division)', () => {
    const cpu = freshCore();
    cpu.registerSet.setRegisterU(1, 0x6ad3f95d);
    cpu.registerSet.setRegisterU(2, 0xac135f14);
    cpu.step(0x0220b1b3); // mulhu x3, x1, x2
    // true high word = 0x47ce80f2. Buggy float64 division gave 0x47ce80f3 (off by one).
    expect(cpu.registerSet.getRegisterU(3) >>> 0).toBe(0x47ce80f2);
  });
});

describe('RV32I SLTIU immediate (must be sign-extended then compared unsigned)', () => {
  test('sltiu rd, rs1, -1 compares against 0xFFFFFFFF, not 0x00000FFF', () => {
    const cpu = freshCore();
    cpu.registerSet.setRegisterU(1, 0x00010000); // 65536
    cpu.step(0xfff0b193); // sltiu x3, x1, -1
    // imm sign-extends to 0xFFFFFFFF (unsigned 4294967295); 65536 < that => 1.
    // Buggy code compared against immU=4095, so 65536 < 4095 => 0.
    expect(cpu.registerSet.getRegister(3)).toBe(1);
  });
});

describe('JALR target alignment (LSB must be cleared)', () => {
  test('jalr clears bit 0 of (rs1 + imm)', () => {
    const cpu = freshCore();
    cpu.pc = 0x20000000;
    cpu.registerSet.setRegisterU(1, 0x20000100);
    cpu.step(0x00108067); // jalr x0, 1(x1)
    // target = (0x20000100 + 1) & ~1 = 0x20000100. Buggy code left it odd: 0x20000101.
    expect(cpu.pc >>> 0).toBe(0x20000100);
  });
});

describe('Synchronous trap entry (ECALL) lands at MTVEC, not MTVEC+ilen', () => {
  test('ECALL executes the first handler instruction at mtvec', () => {
    const cpu = freshCore();
    cpu.csrs[0x305] = 0x20001000; // mtvec, direct mode
    cpu.pc = 0x20004320;
    cpu.inst_length = 4;          // a real fetch of the 32-bit ecall sets this; the bug only
                                  // manifests when step()'s tail adds a non-zero inst_length.
    cpu.step(0x00000073); // ecall
    // pc must be exactly mtvec; the old next_pc==0 sentinel made it mtvec+4 (skipping the
    // handler's first instruction).
    expect(cpu.pc >>> 0).toBe(0x20001000);
    expect(cpu.csrs[0x341] >>> 0).toBe(0x20004320); // mepc = faulting pc
    expect(cpu.csrs[0x342] >>> 0).toBe(11);         // mcause = ecall-from-M
  });

  test('trap-entry mstatus saves MIE->MPIE, clears only MIE, preserves MPP', () => {
    const cpu = freshCore();
    cpu.csrs[0x305] = 0x20001000;
    cpu.setCSR(0x300, (3 << 11) | (1 << 3), 0); // MPP=3, MIE=1  (0x1808)
    cpu.pc = 0x20004320;
    cpu.step(0x00000073); // ecall
    // Expect MPP preserved (3<<11), MPIE set (1<<7), MIE cleared. = 0x1880.
    // Buggy `mstatus &= 1<<7` wiped MPP and left 0x0080.
    expect(cpu.getCSR(0x300, 0) >>> 0).toBe((3 << 11) | (1 << 7));
  });
});

describe('Hazard3 Xh3irq external interrupt index 0 (TIMER0_IRQ_0) is deliverable', () => {
  test('an asserted, enabled IRQ 0 is taken (NOIRQ tested via bit 31, not irq==0)', () => {
    const cpu = freshCore();
    cpu.csrs[0x305] = 0x20001000;            // mtvec
    cpu.csrs[0x304] |= 1 << 11;              // mie.MEIE
    cpu.csrs[0x300] |= 1 << 3;               // mstatus.MIE
    cpu.meipra[0] = 1;                        // priority of IRQ 0
    cpu.meiea[0] = 1;                         // IRQ 0 enabled
    cpu.setInterrupt(0, true);                // assert IRQ 0 -> meinext.irq=0, NOIRQ=0
    cpu.checkForInterrupts();
    // With the fix, trapEntry runs for IRQ 0: mcause = (1<<31)|11, and a branch is pending.
    // Buggy `meinext_irq_number > 0` gate dropped IRQ 0 entirely (mcause stays 0).
    expect(cpu.csrs[0x342] >>> 0).toBe(((1 << 31) | 11) >>> 0);
    expect(cpu.branch_taken).toBe(true);
  });
});

describe('Standard RISC-V WFI parks the core instead of aborting', () => {
  test('wfi decodes and parks the core (was: threw "Unknown instruction 0x10500073")', () => {
    const cpu = freshCore();
    // The SYSTEM func3=0 table only knew mret/ecall/ebreak, so the standard wfi encoding hit the
    // default `throw`, killing the core on the first __wfi() of any idle loop.
    expect(() => cpu.step(0x10500073)).not.toThrow(); // wfi
    expect(cpu.waiting).toBe(true);
  });

  test('a parked core wakes and traps when an enabled interrupt becomes pending', () => {
    const cpu = freshCore();
    cpu.csrs[0x305] = 0x20001000; // mtvec
    cpu.csrs[0x304] |= 1 << 11; // mie.MEIE
    cpu.csrs[0x300] |= 1 << 3; // mstatus.MIE
    cpu.meipra[0] = 1; // priority of IRQ 0
    cpu.meiea[0] = 1; // IRQ 0 enabled
    cpu.step(0x10500073); // wfi -> park
    expect(cpu.waiting).toBe(true);
    cpu.setInterrupt(0, true); // assert IRQ 0
    cpu.checkForInterrupts(); // pending + enabled -> wake and trap
    expect(cpu.waiting).toBe(false);
    expect(cpu.csrs[0x342] >>> 0).toBe(((1 << 31) | 11) >>> 0); // external-interrupt cause
  });
});

describe('Performance counters read the live counts (were undecoded, read 0)', () => {
  test('mcycle/cycle expose cpu.cycles as a 64-bit low/high pair', () => {
    const cpu = freshCore();
    cpu.cycles = 0x100000005; // > 2^32 to exercise the high word
    expect(cpu.getCSR(0xb00, 0) >>> 0).toBe(0x00000005); // mcycle low
    expect(cpu.getCSR(0xb80, 0) >>> 0).toBe(0x00000001); // mcycleh
    expect(cpu.getCSR(0xc00, 0) >>> 0).toBe(0x00000005); // cycle (unprivileged mirror)
  });

  test('minstret/instret expose the retired-instruction count', () => {
    const cpu = freshCore();
    cpu.retired = 42;
    expect(cpu.getCSR(0xb02, 0) >>> 0).toBe(42); // minstret
    expect(cpu.getCSR(0xc02, 0) >>> 0).toBe(42); // instret
  });
});

describe('RV32A atomics (only amoswap/amoor/amoand existed; the rest aborted the core)', () => {
  const ADDR = 0x20000010; // SRAM
  // Build an AMO/LR/SC encoding. func7 = funct5<<2 | aqrl; funct3 = 0b010; opcode = 0x2f.
  const amo = (funct5: number, rd: number, rs1: number, rs2: number, aqrl = 0) =>
    ((((funct5 << 2) | aqrl) << 25) | (rs2 << 20) | (rs1 << 15) | (0x2 << 12) | (rd << 7) | 0x2f) >>> 0;

  function setup(mem: number, operand: number) {
    const cpu = freshCore();
    cpu.chip.writeUint32(ADDR, mem);
    cpu.registerSet.setRegisterU(1, ADDR); // x1 = address
    cpu.registerSet.setRegisterU(2, operand >>> 0); // x2 = operand
    return cpu;
  }

  test('amoadd.w: memory += rs2, rd = old value', () => {
    const cpu = setup(100, 23);
    cpu.step(amo(0x00, 3, 1, 2)); // amoadd.w x3, x2, (x1) — previously threw
    expect(cpu.registerSet.getRegisterU(3) >>> 0).toBe(100); // rd = original
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(123); // memory updated
  });

  test('amoxor.w', () => {
    const cpu = setup(0xf0f0, 0x0ff0);
    cpu.step(amo(0x04, 3, 1, 2));
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe((0xf0f0 ^ 0x0ff0) >>> 0);
  });

  test('amomin.w is signed, amominu.w is unsigned', () => {
    let cpu = setup(0xffffffff, 1); // signed -1 vs 1
    cpu.step(amo(0x10, 3, 1, 2)); // amomin.w -> -1
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(0xffffffff);
    cpu = setup(0xffffffff, 1); // unsigned 4294967295 vs 1
    cpu.step(amo(0x18, 3, 1, 2)); // amominu.w -> 1
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(1);
  });

  test('amomaxu.w is unsigned', () => {
    const cpu = setup(0xffffffff, 1);
    cpu.step(amo(0x1c, 3, 1, 2)); // amomaxu.w -> 0xffffffff
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(0xffffffff);
  });

  test('ordering-annotated variants (.aqrl) decode via funct5', () => {
    const cpu = setup(5, 7);
    cpu.step(amo(0x00, 3, 1, 2, 0b11)); // amoadd.w.aqrl
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(12);
  });

  test('LR.W/SC.W round-trip: SC succeeds after LR, then fails (reservation cleared)', () => {
    const cpu = setup(111, 0);
    cpu.step(amo(0x02, 3, 1, 0)); // lr.w x3, (x1)
    expect(cpu.registerSet.getRegisterU(3) >>> 0).toBe(111); // rd = loaded value
    cpu.registerSet.setRegisterU(2, 222);
    cpu.step(amo(0x03, 4, 1, 2)); // sc.w x4, x2, (x1)
    expect(cpu.registerSet.getRegisterU(4) >>> 0).toBe(0); // success
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(222);
    cpu.registerSet.setRegisterU(2, 333);
    cpu.step(amo(0x03, 4, 1, 2)); // sc.w again — reservation was cleared
    expect(cpu.registerSet.getRegisterU(4) >>> 0).toBe(1); // failure
    expect(cpu.chip.readUint32(ADDR) >>> 0).toBe(222); // memory unchanged
  });
});
