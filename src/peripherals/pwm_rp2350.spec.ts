// RP2350 PWM has 12 slices (RP2040 has 8). The channel count and the register offsets that follow
// the channel array (EN/INTR/INTE/INTF/INTS) are parameterised: EN sits immediately past the last
// channel block, so EN = numChannels * 0x14 (0xa0 on RP2040, 0xf0 on RP2350). Previously slices 8..11
// were absent and their registers/GPIO outputs were dead.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';

const EN = 12 * 0x14; // 0xf0 on RP2350
const CH11 = 11 * 0x14; // channel-11 register block base
const TOP = 0x10; // TOP register offset within a channel block

describe('RP2350 PWM (12 slices)', () => {
  it('instantiates 12 slices and places EN at 0xf0', () => {
    expect(new RP2350().pwm.channels.length).toBe(12);
    expect(EN).toBe(0xf0);
  });

  it('enables slice 11 through EN and reads it back at the 12-slice offset', () => {
    const pwm = new RP2350().pwm;
    pwm.writeUint32(EN, 1 << 11);
    expect(pwm.readUint32(EN) & (1 << 11)).toBe(1 << 11); // slice 11 enabled (was unreachable at 8 slices)
    pwm.writeUint32(EN, 0);
    expect(pwm.readUint32(EN) & (1 << 11)).toBe(0);
  });

  it('addresses slice 11 CH registers (TOP round-trips)', () => {
    const pwm = new RP2350().pwm;
    pwm.writeUint32(CH11 + TOP, 0x1234);
    expect(pwm.readUint32(CH11 + TOP) & 0xffff).toBe(0x1234);
  });
});
