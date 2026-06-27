import { IRPChip } from '../rpchip.js';
import { BasePeripheral, Peripheral } from './peripheral.js';

const RESET = 0x0; //Reset control.
const WDSEL = 0x4; //Watchdog select.
const RESET_DONE = 0x8; //Reset Done

export class RPReset extends BasePeripheral implements Peripheral {
  private reset: number = 0;
  private wdsel: number = 0;
  private reset_done: number;

  // reset_mask is the set of valid reset blocks. RP2040 has 25 (0x1ffffff); RP2350 has 29
  // (0x1fffffff). The bootrom de-asserts a block then polls RESET_DONE for it, so a too-narrow
  // mask leaves the firmware spinning forever on a high-numbered block (e.g. RP2350 IO_BANK0).
  constructor(rp2040: IRPChip, name: string, private readonly reset_mask: number = 0x1ffffff) {
    super(rp2040, name);
    this.reset_done = reset_mask;
  }

  readUint32(offset: number) {
    switch (offset) {
      case RESET:
        return this.reset;
      case WDSEL:
        return this.wdsel;
      case RESET_DONE:
        return this.reset_done;
    }
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    switch (offset) {
      case RESET:
        this.reset = value & this.reset_mask;
        break;
      case WDSEL:
        this.wdsel = value & this.reset_mask;
        break;
      default:
        super.writeUint32(offset, value);
        break;
    }
  }
}
