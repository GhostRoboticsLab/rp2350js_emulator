import { RP2040 } from '../rp2040.js';
import { BasePeripheral, Peripheral } from './peripheral.js';

// RP2040-only peripheral (RP2350 uses syscfg_rp2350). It reaches into the ARM core's NMI mask,
// which only exists on RP2040, so the chip reference is narrowed here.
const PROC0_NMI_MASK = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PROC1_NMI_MASK = 4;

export class RP2040SysCfg extends BasePeripheral implements Peripheral {
  readUint32(offset: number) {
    switch (offset) {
      case PROC0_NMI_MASK:
        return (this.rp2040 as RP2040).core.interruptNMIMask;
    }
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    switch (offset) {
      case PROC0_NMI_MASK:
        (this.rp2040 as RP2040).core.interruptNMIMask = value;
        break;

      default:
        super.writeUint32(offset, value);
    }
  }
}
