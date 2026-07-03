// RP2350 GLITCH_DETECTOR gate. GLITCH_DETECTOR_BASE was unmapped, so every read threw and (had it
// been an UnimplementedPeripheral) TRIG_STATUS would have read 0xffffffff — a phantom "glitch
// detected". Model it benign: ARM resets to its documented 0x5bad, config is store-and-readback, and
// TRIG_STATUS always reads 0 so a pure-software emulator never trips the detector.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPGlitchDetector } from './glitch_detector.js';

const ARM = 0x00;
const SENSITIVITY = 0x08;
const TRIG_STATUS = 0x10;
const GLITCH_DETECTOR_BASE = 0x40158000;

describe('RP2350 GLITCH_DETECTOR (benign)', () => {
  it('resets ARM to 0x5bad (disarmed) and never reports a glitch', () => {
    const g = new RPGlitchDetector(new RP2350(), 'GLITCH');
    expect(g.readUint32(ARM)).toBe(0x5bad);
    expect(g.readUint32(TRIG_STATUS)).toBe(0); // benign: no glitch, ever
  });

  it('store-and-readback on config; TRIG_STATUS stays read-only 0', () => {
    const g = new RPGlitchDetector(new RP2350(), 'GLITCH');
    g.writeUint32(SENSITIVITY, 0x2a);
    expect(g.readUint32(SENSITIVITY)).toBe(0x2a);
    g.writeUint32(TRIG_STATUS, 0xf); // write ignored (read-only)
    expect(g.readUint32(TRIG_STATUS)).toBe(0);
  });

  it('is mapped on the chip bus (reads no longer throw)', () => {
    const chip = new RP2350();
    expect(() => chip.readUint32(GLITCH_DETECTOR_BASE + ARM)).not.toThrow();
    expect(chip.readUint32(GLITCH_DETECTOR_BASE + TRIG_STATUS)).toBe(0);
  });
});
