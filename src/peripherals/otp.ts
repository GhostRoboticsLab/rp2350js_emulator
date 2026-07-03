import { IRPChip } from '../rpchip.js';
import { BasePeripheral, Peripheral } from './peripheral.js';

// OTP — the RP2350 one-time-programmable fuse array and its access interface. Two APB blocks:
//
//   OTP_BASE (this class)  — the control/interface registers (SW_LOCKn, SBPI, CRT_KEY, CRITICAL,
//                            KEY_VALID, DEBUGEN, ARCHSEL, BOOTDIS, INT*). Modelled as
//                            store-and-readback: we do not model fuse programming or lock
//                            enforcement, we just stop the block throwing/lying on reads.
//   OTP_DATA_BASE (RPOTPData) — the *guarded* read window. Each of the 4096 fuse rows is read at
//                            row*4 and returns its ECC-corrected 16-bit value in bits [15:0].
//
// Before this, neither block was mapped, so any bootrom/sys_info OTP read (chip id, boot flags,
// crit config) hit the chip's "invalid memory address" throw. The fuse array backs the guarded
// window and is seedable (`fuse`) so a harness can stand in a programmed part.

const OTP_ROWS = 4096;
const IFACE_WORDS = 0x200 >> 2; // interface register file: offsets 0x000..0x1fc (INTS is 0x170)

export class RPOTP extends BasePeripheral implements Peripheral {
  // ECC-corrected 16-bit view of the fuse array (one entry per OTP row). 0 = blank/unfused; seed
  // entries to model a programmed device. Shared with the guarded OTP_DATA read window below.
  readonly fuse = new Uint16Array(OTP_ROWS);
  private readonly regs = new Uint32Array(IFACE_WORDS);

  readUint32(offset: number) {
    if (offset < IFACE_WORDS * 4) return this.regs[offset >> 2];
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    if (offset < IFACE_WORDS * 4) {
      this.regs[offset >> 2] = value >>> 0;
      return;
    }
    super.writeUint32(offset, value);
  }
}

// OTP_DATA_BASE — the guarded, ECC-corrected read window over the same fuse array. Read-only:
// row N is at byte offset N*4 and returns the 16-bit fuse value. Writes are ignored (fuse
// programming goes through the SBPI interface on OTP_BASE, which we don't model).
export class RPOTPData extends BasePeripheral implements Peripheral {
  constructor(
    rp2040: IRPChip,
    name: string,
    private readonly otp: RPOTP,
  ) {
    super(rp2040, name);
  }

  readUint32(offset: number) {
    const row = offset >> 2;
    if (row < this.otp.fuse.length) return this.otp.fuse[row];
    return super.readUint32(offset);
  }

  writeUint32() {
    // The guarded data window is read-only.
  }
}
