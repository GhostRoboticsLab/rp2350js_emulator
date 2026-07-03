// RP2350 POWMAN gate. POWMAN_BASE was a near-empty stub: VREG read 0 (so the SDK's
// VREG.UPDATE_IN_PROGRESS poll wouldn't hang) but every other register — including the AON timer —
// read 0xffffffff, a garbage count, and there was no write-password enforcement at all. The real
// POWMAN gates every write behind the 0x5afe password (bits [31:16]; only [15:0] are data, which is
// why the 64-bit timer is four 16-bit registers) and latches BADPASSWD on a mismatch.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPPOWMAN } from './powman.js';

const BADPASSWD = 0x00;
const VREG = 0x0c;
const SET_TIME_47TO32 = 0x64;
const SET_TIME_31TO16 = 0x68;
const SET_TIME_15TO0 = 0x6c;
const READ_TIME_UPPER = 0x70;
const READ_TIME_LOWER = 0x74;
const TIMER = 0x88;
const RUN = 1 << 1;
const PW = 0x5afe0000; // password in bits [31:16]

describe('RP2350 POWMAN (AON timer + password gate)', () => {
  it('sets and reads back the 64-bit AON timer across the split SET_TIME registers', () => {
    const pm = new RPPOWMAN(new RP2350(), 'POWMAN');
    // time = 0x0001_2345_6789 ms
    pm.writeUint32(SET_TIME_15TO0, PW | 0x6789);
    pm.writeUint32(SET_TIME_31TO16, PW | 0x2345);
    pm.writeUint32(SET_TIME_47TO32, PW | 0x0001);
    expect(pm.readUint32(READ_TIME_LOWER) >>> 0).toBe(0x23456789); // was 0xffffffff (unmapped)
    expect(pm.readUint32(READ_TIME_UPPER) >>> 0).toBe(0x00000001);
  });

  it('drops a write with a bad password and latches BADPASSWD', () => {
    const pm = new RPPOWMAN(new RP2350(), 'POWMAN');
    expect(pm.readUint32(BADPASSWD)).toBe(0); // clean boot: no bad password yet
    pm.writeUint32(SET_TIME_15TO0, 0x1234); // no password -> dropped
    expect(pm.readUint32(BADPASSWD)).toBe(1); // latched (was 0xffffffff on the unmapped stub)
    expect(pm.readUint32(READ_TIME_LOWER) >>> 0).toBe(0); // the passwordless write did NOT take effect
  });

  it('free-runs the AON timer while TIMER_RUN is set (a real 1 ms counter, not store-only)', () => {
    const chip = new RP2350();
    const pm = new RPPOWMAN(chip, 'POWMAN');
    pm.writeUint32(TIMER, PW | RUN);
    chip.clock.tick(5_000_000); // advance 5 ms (in nanoseconds)
    expect(pm.readUint32(READ_TIME_LOWER) >>> 0).toBe(5);
  });

  it('still reads VREG as 0 so the SDK UPDATE_IN_PROGRESS poll does not hang', () => {
    expect(new RPPOWMAN(new RP2350(), 'POWMAN').readUint32(VREG)).toBe(0);
  });
});
