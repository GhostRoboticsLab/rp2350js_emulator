// RP2350 OTP gate. Neither OTP_BASE nor OTP_DATA_BASE was mapped, so any OTP read (chip id, boot
// flags, critical config from the bootrom / sys_info) hit the chip's "invalid memory address" throw.
// Add the interface block (store-and-readback) plus the guarded OTP_DATA read window over a seedable
// 4096-row fuse array.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPOTP, RPOTPData } from './otp.js';

const OTP_BASE = 0x40120000;
const OTP_DATA_BASE = 0x40130000;
const SW_LOCK0 = 0x00;
const CHIPID0_ROW = 0x00;
const CHIPID2_ROW = 0x02;

describe('RP2350 OTP', () => {
  it('reads a seeded fuse row back through the guarded OTP_DATA window', () => {
    const otp = new RPOTP(new RP2350(), 'OTP');
    const data = new RPOTPData(new RP2350(), 'OTP_DATA', otp);
    otp.fuse[CHIPID0_ROW] = 0xcafe; // model a programmed CHIPID0
    otp.fuse[CHIPID2_ROW] = 0xbeef;
    expect(data.readUint32(CHIPID0_ROW * 4)).toBe(0xcafe);
    expect(data.readUint32(CHIPID2_ROW * 4)).toBe(0xbeef);
    expect(data.readUint32(0x10 * 4)).toBe(0); // unfused row reads blank
  });

  it('store-and-readback on the OTP interface registers (SW_LOCK etc.)', () => {
    const otp = new RPOTP(new RP2350(), 'OTP');
    otp.writeUint32(SW_LOCK0, 0x3);
    expect(otp.readUint32(SW_LOCK0)).toBe(0x3);
  });

  it('OTP reads through the chip bus no longer throw (were unmapped)', () => {
    const chip = new RP2350();
    chip.otp.fuse[CHIPID0_ROW] = 0x1234;
    expect(() => chip.readUint32(OTP_BASE + SW_LOCK0)).not.toThrow();
    expect(chip.readUint32(OTP_DATA_BASE + CHIPID0_ROW * 4)).toBe(0x1234); // seeded row via the bus
  });

  it('the guarded OTP_DATA window is read-only', () => {
    const otp = new RPOTP(new RP2350(), 'OTP');
    const data = new RPOTPData(new RP2350(), 'OTP_DATA', otp);
    data.writeUint32(CHIPID0_ROW * 4, 0xffff);
    expect(data.readUint32(CHIPID0_ROW * 4)).toBe(0); // write ignored
  });
});
