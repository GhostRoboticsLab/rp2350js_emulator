import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDriver } from '../test-utils/create-test-driver.js';
import { ICortexTestDriver } from '../test-utils/test-driver.js';
import { SIO_START_ADDRESS } from './rp2040.js';
import { RP2350 } from './rp2350.js';
import { Core } from './core.js';
import { IRQ } from './irq_rp2350.js';

//Hardware Divider registers absolute address
const SIO_DIV_UDIVIDEND = SIO_START_ADDRESS + 0x060; //  Divider unsigned dividend
const SIO_DIV_UDIVISOR = SIO_START_ADDRESS + 0x064; //  Divider unsigned divisor
const SIO_DIV_SDIVIDEND = SIO_START_ADDRESS + 0x068; //  Divider signed dividend
const SIO_DIV_SDIVISOR = SIO_START_ADDRESS + 0x06c; //  Divider signed divisor
const SIO_DIV_QUOTIENT = SIO_START_ADDRESS + 0x070; //  Divider result quotient
const SIO_DIV_REMAINDER = SIO_START_ADDRESS + 0x074; //Divider result remainder
const SIO_DIV_CSR = SIO_START_ADDRESS + 0x078;

//SPINLOCK
const SIO_SPINLOCK10 = SIO_START_ADDRESS + 0x128;
const SIO_SPINLOCKST = SIO_START_ADDRESS + 0x5c;

// SIO inter-core FIFO_ST is write-1-to-clear per bit (WOF = bit 2, ROE = bit 3). The handler used
// `if (value | FIFO_ST_*_BITS)` — bitwise-OR with a nonzero constant is always truthy, so ANY write
// to FIFO_ST cleared BOTH sticky error latches (and could spuriously de-assert the SIO FIFO IRQ).
// Negative control: latch both, write only the WOF bit, and require ROE to survive.
describe('SIO FIFO_ST write-1-to-clear (WOF/ROE)', () => {
  const FIFO_ST = 0x50;
  const WOF_BIT = 0x04;
  const ROE_BIT = 0x08;

  it('clears only the bit written, leaving the other sticky latch set', () => {
    const core = new RP2350().sio.core0;
    core.WOF = true;
    core.ROE = true;
    core.writeUint32(FIFO_ST, WOF_BIT); // write-1-to-clear the WOF latch only
    expect(core.WOF).toBe(false); // WOF cleared as requested
    expect(core.ROE).toBe(true); // ROE must persist — the `|` bug cleared it too
  });

  it('clears ROE when its bit is written, and both when both are written', () => {
    const c1 = new RP2350().sio.core0;
    c1.WOF = true;
    c1.ROE = true;
    c1.writeUint32(FIFO_ST, ROE_BIT);
    expect(c1.ROE).toBe(false);
    expect(c1.WOF).toBe(true);

    const c2 = new RP2350().sio.core0;
    c2.WOF = true;
    c2.ROE = true;
    c2.writeUint32(FIFO_ST, WOF_BIT | ROE_BIT);
    expect(c2.WOF).toBe(false);
    expect(c2.ROE).toBe(false);
  });
});

// The RP2350-new inter-core DOORBELL was undecoded — reads returned 0xffffffff and SIO_IRQ_BELL never
// fired, breaking pico-sdk multicore_doorbell_*. OUT_* on one core rings the other; IN_* is self /
// acknowledge; a core takes SIO_IRQ_BELL while it has any incoming bell.
describe('SIO inter-core DOORBELL', () => {
  const OUT_SET = 0x180;
  const IN_SET = 0x188;
  const IN_CLR = 0x18c;

  it('core0 ringing appears on core1, raises SIO_IRQ_BELL, and clears on acknowledge', () => {
    const mcu = new RP2350();
    const spy = vi.spyOn(mcu, 'setInterruptCore');
    const BELL = 1 << 3;

    mcu.sio.writeUint32(OUT_SET, BELL, Core.Core0); // core0 rings bell 3 on core1
    expect(mcu.sio.readUint32(IN_SET, Core.Core1)).toBe(BELL); // core1's incoming (was 0xffffffff)
    expect(mcu.sio.readUint32(OUT_SET, Core.Core0)).toBe(BELL); // core0's outgoing view
    expect(mcu.sio.readUint32(IN_SET, Core.Core0)).toBe(0); // core0 has nothing incoming
    expect(spy).toHaveBeenCalledWith(IRQ.SIO_IRQ_BELL, true, Core.Core1);

    mcu.sio.writeUint32(IN_CLR, BELL, Core.Core1); // core1 acknowledges
    expect(mcu.sio.readUint32(IN_SET, Core.Core1)).toBe(0);
    expect(spy).toHaveBeenCalledWith(IRQ.SIO_IRQ_BELL, false, Core.Core1);
  });
});

describe('RPSIO', () => {
  let cpu: ICortexTestDriver;

  beforeEach(async () => {
    cpu = await createTestDriver();
  });

  afterEach(async () => {
    await cpu.tearDown();
  });

  describe('Hardware Divider', () => {
    it('should perform a signed hardware divider 123456 / -321 = -384 REM 192', async () => {
      await cpu.writeUint32(SIO_DIV_SDIVIDEND, 123456);
      expect(await cpu.readInt32(SIO_DIV_SDIVIDEND)).toEqual(123456);
      await cpu.writeUint32(SIO_DIV_SDIVISOR, -321);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(3);
      expect(await cpu.readInt32(SIO_DIV_SDIVISOR)).toEqual(-321);
      expect(await cpu.readInt32(SIO_DIV_REMAINDER)).toEqual(192);
      expect(await cpu.readInt32(SIO_DIV_QUOTIENT)).toEqual(-384);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(1);
    });

    it('should perform a signed hardware divider -3000 / 2 = -1500 REM 0', async () => {
      await cpu.writeUint32(SIO_DIV_SDIVIDEND, -3000);
      expect(await cpu.readInt32(SIO_DIV_SDIVIDEND)).toEqual(-3000);
      await cpu.writeUint32(SIO_DIV_SDIVISOR, 2);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(3);
      expect(await cpu.readInt32(SIO_DIV_SDIVISOR)).toEqual(2);
      expect(await cpu.readInt32(SIO_DIV_REMAINDER)).toEqual(0);
      expect(await cpu.readInt32(SIO_DIV_QUOTIENT)).toEqual(-1500);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(1);
    });

    it('should perform an unsigned hardware divider 123456 / 321 = 384 REM 192', async () => {
      await cpu.writeUint32(SIO_DIV_UDIVIDEND, 123456);
      await cpu.writeUint32(SIO_DIV_UDIVISOR, 321);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(3);
      expect(await cpu.readUint32(SIO_DIV_REMAINDER)).toEqual(192);
      expect(await cpu.readUint32(SIO_DIV_QUOTIENT)).toEqual(384);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(1);
    });

    it('should perform a division, store the result, do another division then restore the previously stored result ', async () => {
      await cpu.writeUint32(SIO_DIV_SDIVIDEND, 123456);
      await cpu.writeUint32(SIO_DIV_SDIVISOR, -321);
      const remainder = await cpu.readInt32(SIO_DIV_REMAINDER);
      const quotient = await cpu.readInt32(SIO_DIV_QUOTIENT);
      expect(remainder).toEqual(192);
      expect(quotient).toEqual(-384);
      await cpu.writeUint32(SIO_DIV_UDIVIDEND, 123);
      await cpu.writeUint32(SIO_DIV_UDIVISOR, 7);
      expect(await cpu.readUint32(SIO_DIV_REMAINDER)).toEqual(4);
      expect(await cpu.readUint32(SIO_DIV_QUOTIENT)).toEqual(17);
      await cpu.writeUint32(SIO_DIV_REMAINDER, remainder);
      await cpu.writeUint32(SIO_DIV_QUOTIENT, quotient);
      expect(await cpu.readUint32(SIO_DIV_CSR)).toEqual(3);
      expect(await cpu.readInt32(SIO_DIV_REMAINDER)).toEqual(192);
      expect(await cpu.readInt32(SIO_DIV_QUOTIENT)).toEqual(-384);
    });

    it('should perform an unsigned division by zero 123456 / 0 = 0xffffffff REM 123456', async () => {
      await cpu.writeUint32(SIO_DIV_UDIVIDEND, 123456);
      await cpu.writeUint32(SIO_DIV_UDIVISOR, 0);
      expect(await cpu.readUint32(SIO_DIV_REMAINDER)).toEqual(123456);
      expect(await cpu.readUint32(SIO_DIV_QUOTIENT)).toEqual(0xffffffff);
    });

    it('should perform an unsigned division by zero 0x80000000 / 0 = 0xffffffff REM 0x80000000', async () => {
      await cpu.writeUint32(SIO_DIV_UDIVIDEND, 0x80000000);
      await cpu.writeUint32(SIO_DIV_UDIVISOR, 0);
      expect(await cpu.readUint32(SIO_DIV_REMAINDER)).toEqual(0x80000000);
      expect(await cpu.readUint32(SIO_DIV_QUOTIENT)).toEqual(0xffffffff);
    });

    it('should perform a signed division by zero 3000 / 0 = -1 REM 3000', async () => {
      await cpu.writeUint32(SIO_DIV_SDIVIDEND, 3000);
      await cpu.writeUint32(SIO_DIV_SDIVISOR, 0);
      expect(await cpu.readInt32(SIO_DIV_REMAINDER)).toEqual(3000);
      expect(await cpu.readInt32(SIO_DIV_QUOTIENT)).toEqual(-1);
    });

    it('should perform a signed division by zero -3000 / 0 = 1 REM -3000', async () => {
      await cpu.writeUint32(SIO_DIV_SDIVIDEND, -3000);
      await cpu.writeUint32(SIO_DIV_SDIVISOR, 0);
      expect(await cpu.readInt32(SIO_DIV_REMAINDER)).toEqual(-3000);
      expect(await cpu.readInt32(SIO_DIV_QUOTIENT)).toEqual(1);
    });

    it('should perform a signed division 0x80000000 / 2 = 0xc0000000 REM 0', async () => {
      await cpu.writeUint32(SIO_DIV_SDIVIDEND, 0x80000000);
      await cpu.writeUint32(SIO_DIV_SDIVISOR, 2);
      expect(await cpu.readUint32(SIO_DIV_REMAINDER)).toEqual(0);
      expect(await cpu.readUint32(SIO_DIV_QUOTIENT)).toEqual(0xc0000000);
    });

    it('should perform an unsigned division 0x80000000 / 2 = 0x40000000 REM 0', async () => {
      await cpu.writeUint32(SIO_DIV_UDIVIDEND, 0x80000000);
      await cpu.writeUint32(SIO_DIV_UDIVISOR, 2);
      expect(await cpu.readUint32(SIO_DIV_REMAINDER)).toEqual(0);
      expect(await cpu.readUint32(SIO_DIV_QUOTIENT)).toEqual(0x40000000);
    });
  });

  it('should unlock, lock and check lock status of spinlock10', async () => {
    await cpu.writeUint32(SIO_SPINLOCK10, 0x00000001); //ensure the spinlock is released
    expect(await cpu.readUint32(SIO_SPINLOCK10)).toEqual(1024); // lock spinlock, return 1<<spinlock num if previously unlocked
    expect(await cpu.readUint32(SIO_SPINLOCKST)).toEqual(1024); //bit mask of all spinlocks, locked=1<<spinlock
    expect(await cpu.readUint32(SIO_SPINLOCK10)).toEqual(0); //0=already locked
    expect(await cpu.readUint32(SIO_SPINLOCKST)).toEqual(1024);
    await cpu.writeUint32(SIO_SPINLOCK10, 0x00000001); //release the spinlock
    expect(await cpu.readUint32(SIO_SPINLOCKST)).toEqual(0);
  });
});
