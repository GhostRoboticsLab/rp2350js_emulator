import { IRPChip } from '../rpchip.js';
import { BasePeripheral, Peripheral } from './peripheral.js';

// GLITCH_DETECTOR — the RP2350 voltage-glitch detector (a security countermeasure that resets the
// chip if it sees a supply glitch). Modelled benign: store-and-readback config (ARM resets to its
// documented 0x5bad "disarmed" value, plus DISARM/SENSITIVITY/LOCK/TRIG_FORCE) and TRIG_STATUS
// always reads 0 — the detector never reports a glitch, so a pure-software emulator never spuriously
// trips it. Software-forced triggering (TRIG_FORCE) is intentionally not modelled. Before this the
// block was unmapped and every read threw.

const ARM = 0x00;
const TRIG_STATUS = 0x10; // read-only; 0 = no glitch detected
const REG_WORDS = 0x18 >> 2; // registers 0x00..0x14

const ARM_RESET = 0x5bad;

export class RPGlitchDetector extends BasePeripheral implements Peripheral {
  private readonly regs = new Uint32Array(REG_WORDS);

  constructor(rp2040: IRPChip, name: string) {
    super(rp2040, name);
    this.regs[ARM >> 2] = ARM_RESET;
  }

  readUint32(offset: number) {
    if (offset === TRIG_STATUS) return 0; // benign: never reports a glitch
    if (offset < REG_WORDS * 4) return this.regs[offset >> 2];
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    if (offset === TRIG_STATUS) return; // read-only
    if (offset < REG_WORDS * 4) {
      this.regs[offset >> 2] = value >>> 0;
      return;
    }
    super.writeUint32(offset, value);
  }
}
