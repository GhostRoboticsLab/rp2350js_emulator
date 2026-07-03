// RP2350 UF2 loader: address routing + family-id validation (the loader itself is I/O; these are the
// pure decision helpers). The RP2040 loader ignored the family id and hard-coded the flash base; this
// routes flash vs SRAM by address and flags a wrong-arch (Arm) image the RISC-V core can't run.
import { describe, expect, it } from 'vitest';
import { uf2Region, isRunnableFamily, RP2350_FAMILY } from '../demo/load-uf2-rp2350.js';

describe('RP2350 UF2 loader routing', () => {
  it('routes target addresses to flash or SRAM (or neither)', () => {
    expect(uf2Region(0x10000000)).toBe('flash');
    expect(uf2Region(0x10ffffff)).toBe('flash');
    expect(uf2Region(0x20000000)).toBe('sram');
    expect(uf2Region(0x20000220)).toBe('sram');
    expect(uf2Region(0x00000000)).toBe(null);
    expect(uf2Region(0x40000000)).toBe(null); // APB peripherals — not a load target
  });

  it('accepts RISC-V/absolute/data families and flags Arm/RP2040 images', () => {
    expect(isRunnableFamily(RP2350_FAMILY.RISCV)).toBe(true);
    expect(isRunnableFamily(RP2350_FAMILY.ABSOLUTE)).toBe(true);
    expect(isRunnableFamily(RP2350_FAMILY.DATA)).toBe(true);
    expect(isRunnableFamily(RP2350_FAMILY.ARM_S)).toBe(false);
    expect(isRunnableFamily(RP2350_FAMILY.ARM_NS)).toBe(false);
    expect(isRunnableFamily(RP2350_FAMILY.RP2040)).toBe(false);
  });
});
