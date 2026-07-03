// RP2350 TICKS gate. TICKS_BASE was an UnimplementedPeripheral, so every generator's CTRL read
// 0xffffffff — reporting RUNNING=1 with a 0x1ff divider before software had programmed anything —
// and CYCLES/COUNT read back garbage. The real block: RUNNING mirrors ENABLE, CYCLES/COUNT read back
// the programmed divider. (This fork does not gate its timers on TICKS; see ticks.ts for why.)
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPTicks } from './ticks.js';

const TIMER0_CTRL = 0x18;
const TIMER0_CYCLES = 0x1c;
const TIMER0_COUNT = 0x20;
const ENABLE = 1 << 0;
const RUNNING = 1 << 1;
const TICKS_BASE = 0x40108000;

describe('RP2350 TICKS (tick generators)', () => {
  it('reports RUNNING=0 for a generator until CTRL.ENABLE is written', () => {
    const t = new RPTicks(new RP2350(), 'TICKS');
    expect(t.readUint32(TIMER0_CTRL) & RUNNING).toBe(0); // was 0xffffffff -> RUNNING looked set at reset
    t.writeUint32(TIMER0_CYCLES, 12);
    t.writeUint32(TIMER0_CTRL, ENABLE);
    expect(t.readUint32(TIMER0_CTRL) & RUNNING).toBe(RUNNING);
  });

  it('reads back the programmed divider, and COUNT reflects it only while running', () => {
    const t = new RPTicks(new RP2350(), 'TICKS');
    t.writeUint32(TIMER0_CYCLES, 12);
    expect(t.readUint32(TIMER0_CYCLES)).toBe(12); // was 0xffffffff on the unmapped stub
    expect(t.readUint32(TIMER0_COUNT)).toBe(0); // stopped -> COUNT idle
    t.writeUint32(TIMER0_CTRL, ENABLE);
    expect(t.readUint32(TIMER0_COUNT)).toBe(12); // running -> reload visible
  });

  it('is mapped at TICKS_BASE on the chip bus (no longer an unmapped 0xffffffff read)', () => {
    const chip = new RP2350();
    expect(chip.readUint32(TICKS_BASE + TIMER0_CTRL) & RUNNING).toBe(0);
  });
});
