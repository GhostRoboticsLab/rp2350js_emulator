// RP2350 ACCESSCTRL gate. ACCESSCTRL_BASE was an UnimplementedPeripheral, so LOCK read 0xffffffff
// (firmware would think every lock bit was set) and the per-target permission gates read garbage.
// The real block resets LOCK to 0x4 and every per-target gate (ROM..XIP_AUX) to 0xff (all masters
// permitted). Permissions are store-and-readback only (not enforced — deferred, see ROADMAP scope).
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPAccessCtrl } from './accessctrl.js';

const LOCK = 0x00;
const CFGRESET = 0x08;
const ROM = 0x14;
const SRAM0 = 0x1c;
const ACCESSCTRL_BASE = 0x40060000;

describe('RP2350 ACCESSCTRL', () => {
  it('resets LOCK to 0x4 (not the unmapped 0xffffffff)', () => {
    expect(new RPAccessCtrl(new RP2350(), 'ACCESSCTRL').readUint32(LOCK)).toBe(0x4);
  });

  it('resets every per-target permission gate to 0xff (all masters permitted)', () => {
    const ac = new RPAccessCtrl(new RP2350(), 'ACCESSCTRL');
    expect(ac.readUint32(ROM)).toBe(0xff);
    expect(ac.readUint32(SRAM0)).toBe(0xff);
  });

  it('CFGRESET (write bit0) restores the reset defaults', () => {
    const ac = new RPAccessCtrl(new RP2350(), 'ACCESSCTRL');
    ac.writeUint32(SRAM0, 0x00); // revoke all access to SRAM0
    expect(ac.readUint32(SRAM0)).toBe(0x00);
    ac.writeUint32(CFGRESET, 0x1); // restore defaults
    expect(ac.readUint32(SRAM0)).toBe(0xff);
    expect(ac.readUint32(LOCK)).toBe(0x4);
  });

  it('is mapped on the chip bus with the correct LOCK reset', () => {
    expect(new RP2350().readUint32(ACCESSCTRL_BASE + LOCK)).toBe(0x4); // was 0xffffffff (unmapped)
  });
});
