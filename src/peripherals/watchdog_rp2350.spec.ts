// RP2350 watchdog gate. WATCHDOG_BASE was an UnimplementedPeripheral, so REASON read 0xffffffff
// (firmware would think the last reset was a watchdog reset) and the 8 SCRATCH registers — used by
// the SDK/picotool for reboot-to-BOOTSEL and boot rendezvous — didn't retain values. Enabling the
// real RPWatchdog (1 MHz tick, no RP2040-E1 2 MHz errata doubling) fixes all three.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';

const REASON = 0x08;
const SCRATCH0 = 0x0c;
const SCRATCH7 = 0x28;

describe('RP2350 watchdog (enabled, 1 MHz tick)', () => {
  it('retains SCRATCH register writes (reboot-to-BOOTSEL / boot rendezvous)', () => {
    const wd = new RP2350().watchdog;
    wd.writeUint32(SCRATCH0, 0xdeadbeef);
    wd.writeUint32(SCRATCH7, 0x1234);
    expect(wd.readUint32(SCRATCH0) >>> 0).toBe(0xdeadbeef); // was 0xffffffff (unmapped)
    expect(wd.readUint32(SCRATCH7) >>> 0).toBe(0x1234);
  });

  it('reports no reset reason after a clean boot (not the 0xffffffff of an unmapped block)', () => {
    expect(new RP2350().watchdog.readUint32(REASON) >>> 0).toBe(0);
  });

  it('ticks at 1 MHz (RP2350 has no RP2040-E1 double-decrement errata)', () => {
    expect(new RP2350().watchdog.timer.frequency).toBe(1_000_000);
  });
});
