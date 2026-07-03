import { IRPChip } from '../rpchip.js';
import { BasePeripheral, Peripheral } from './peripheral.js';

// ACCESSCTRL — the RP2350 access-control block that gates every bus master (core0/1, DMA, debug,
// secure/non-secure/priv/unpriv) against every target (ROM, XIP, each SRAM bank, each peripheral).
// Modelled as store-and-readback with the correct RESET state; permissions are NOT enforced (like
// PMP, enforcement is deferred — see ROADMAP scope notes). Replacing the UnimplementedPeripheral
// stops the block reading 0xffffffff, which lied that LOCK was fully set and returned garbage
// permission masks. At reset LOCK reads 0x4 and every per-target permission register (ROM..XIP_AUX)
// reads 0xff (all masters permitted), matching silicon; a write to CFGRESET restores those defaults.

const LOCK = 0x00;
const CFGRESET = 0x08;
const GATE_FIRST = 0x14; // ROM — first per-target permission register
const GATE_LAST = 0xe8; // XIP_AUX — last per-target permission register
const REG_WORDS = 0xf0 >> 2;

export class RPAccessCtrl extends BasePeripheral implements Peripheral {
  private readonly regs = new Uint32Array(REG_WORDS);

  constructor(rp2040: IRPChip, name: string) {
    super(rp2040, name);
    this.resetDefaults();
  }

  private resetDefaults() {
    this.regs.fill(0);
    this.regs[LOCK >> 2] = 0x4;
    for (let off = GATE_FIRST; off <= GATE_LAST; off += 4) this.regs[off >> 2] = 0xff;
  }

  readUint32(offset: number) {
    if (offset < REG_WORDS * 4) return this.regs[offset >> 2];
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    if (offset === CFGRESET) {
      if (value & 1) this.resetDefaults(); // write bit0 -> restore all ACCESSCTRL config to defaults
      return;
    }
    if (offset < REG_WORDS * 4) {
      this.regs[offset >> 2] = value >>> 0;
      return;
    }
    super.writeUint32(offset, value);
  }
}
