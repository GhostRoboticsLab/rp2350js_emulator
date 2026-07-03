import { IRPChip } from './rpchip.js';
import { Core } from './core.js';
import { RPSIOCore } from './sio-core.js';
import { IRQ } from './irq_rp2350.js';

const CPUID = 0x000;

// GPIO
const GPIO_IN = 0x004; // Input value for GPIO pins
const GPIO_HI_IN = 0x008; // Input value for QSPI pins

const GPIO_OUT = 0x010; // GPIO output value
const GPIO_OUT_SET = 0x018; // GPIO output value set
const GPIO_OUT_CLR = 0x020; // GPIO output value clear
const GPIO_OUT_XOR = 0x028; // GPIO output value XOR
const GPIO_OE = 0x030; // GPIO output enable
const GPIO_OE_SET = 0x038; // GPIO output enable set
const GPIO_OE_CLR = 0x040; // GPIO output enable clear
const GPIO_OE_XOR = 0x048; // GPIO output enable XOR

const GPIO_HI_OUT = 0x014; // GPIO32..47, QSPI, USB output value
const GPIO_HI_OUT_SET = 0x01c; // GPIO32..47, QSPI, USB output value set
const GPIO_HI_OUT_CLR = 0x024; // GPIO32..47, QSPI, USB output value clear
const GPIO_HI_OUT_XOR = 0x02c; // GPIO32..47, QSPI, USB output value XOR
const GPIO_HI_OE = 0x034; // GPIO32..47, QSPI, USB output enable
const GPIO_HI_OE_SET = 0x03c; // GPIO32..47, QSPI, USB output enable set
const GPIO_HI_OE_CLR = 0x044; // GPIO32..47, QSPI, USB output enable clear
const GPIO_HI_OE_XOR = 0x04c; // GPIO32..47, QSPI, USB output enable XOR

const GPIO_MASK = 0x3fffffff;

//SPINLOCK
const SPINLOCK_ST = 0x5c;
const SPINLOCK0 = 0x100;
const SPINLOCK31 = 0x17c;

// DOORBELL (RP2350) — cross-core notification. OUT_* ring/rescind bells on the OTHER core; IN_* set
// (self-ring) / acknowledge bells on THIS core. Reading OUT_* returns the outgoing state (bells this
// core has set on the other); reading IN_* returns this core's incoming bells. SIO_IRQ_BELL is
// asserted on a core while it has any incoming bell set.
const DOORBELL_OUT_SET = 0x180;
const DOORBELL_OUT_CLR = 0x184;
const DOORBELL_IN_SET = 0x188;
const DOORBELL_IN_CLR = 0x18c;

export class RPSIO {
  gpioValue = 0;
  gpioOutputEnable = 0;
  gpioHiValue = 0;
  gpioHiOutputEnable = 0;
  spinLock = 0;
  // Incoming doorbell bitmask per core (indexed by Core). A core takes SIO_IRQ_BELL while its entry
  // is non-zero. OUT_* on one core writes the other core's entry; IN_* writes its own.
  readonly doorbellIn = [0, 0];
  readonly core0;
  readonly core1;

  // core1 launch handshake state (emulating the bootrom wait-for-vector loop). The SDK sends
  // {0, 0, 1, vector_table, sp, entry} over the inter-core FIFO and expects each value echoed;
  // a 0 resyncs, a 1 starts capture, then the next three are vtor/sp/entry.
  private launchWaiting = false;
  private launchCapturing = false;
  private launchBuf: number[] = [];

  constructor(private readonly rp2040: IRPChip, readonly sio_proc0_irq: number, readonly sio_proc1_irq: number) {
    const cores = RPSIOCore.create2Cores(rp2040, sio_proc0_irq, sio_proc1_irq);
    this.core0 = cores[0];
    this.core1 = cores[1];
  }

  readUint32(offset: number, core: Core) : number {
    if (offset >= SPINLOCK0 && offset <= SPINLOCK31) {
      const bitIndexMask = 1 << ((offset - SPINLOCK0) / 4);
      if (this.spinLock & bitIndexMask) {
        return 0;
      } else {
        this.spinLock |= bitIndexMask;
        return bitIndexMask;
      }
    }
    switch (offset) {
      case GPIO_IN:
        return this.rp2040.gpioValues(0);
      case GPIO_HI_IN: {
        const { qspi } = this.rp2040;
        let result = 0;
        for (let qspiIndex = 0; qspiIndex < qspi.length; qspiIndex++) {
          if (qspi[qspiIndex].inputValue) {
            result |= 1 << qspiIndex;
          }
        }
        result <<= 26;
        result |= this.rp2040.gpioValues(32);
        return result;
      }
      case GPIO_OUT:
        return this.gpioValue;
      case GPIO_OE:
        return this.gpioOutputEnable;
      case GPIO_HI_OUT:
        return this.gpioHiValue;
      case GPIO_HI_OE:
        return this.gpioHiOutputEnable;
      case GPIO_OUT_SET:
      case GPIO_OUT_CLR:
      case GPIO_OUT_XOR:
      case GPIO_OE_SET:
      case GPIO_OE_CLR:
      case GPIO_OE_XOR:
      case GPIO_HI_OUT_SET:
      case GPIO_HI_OUT_CLR:
      case GPIO_HI_OUT_XOR:
      case GPIO_HI_OE_SET:
      case GPIO_HI_OE_CLR:
      case GPIO_HI_OE_XOR:
        return 0; // TODO verify with silicone
      case CPUID:
        switch (core) {
          case Core.Core0:
            return 0;
          case Core.Core1:
            return 1;
        }
        break;
      case SPINLOCK_ST:
        return this.spinLock;
      case DOORBELL_OUT_SET:
      case DOORBELL_OUT_CLR:
        // Outgoing view: the bells this core has rung on the other core.
        return this.doorbellIn[core === Core.Core0 ? Core.Core1 : Core.Core0];
      case DOORBELL_IN_SET:
      case DOORBELL_IN_CLR:
        return this.doorbellIn[core]; // incoming bells on this core
    }
    // Divider, Interpolator, FIFO get handled per core in sio-core
    switch (core) {
      case Core.Core0:
        return this.core0.readUint32(offset);
      case Core.Core1:
        return this.core1.readUint32(offset);
    }
  }

  private ringDoorbell(target: Core, setMask: number, clearMask: number) {
    this.doorbellIn[target] = (this.doorbellIn[target] | setMask) & ~clearMask;
    this.rp2040.setInterruptCore(IRQ.SIO_IRQ_BELL, this.doorbellIn[target] !== 0, target);
  }

  /** Put core1 into the launch wait-loop and post the bootrom "alive" 0 to core0's mailbox. */
  enterCore1LaunchWait() {
    this.launchWaiting = true;
    this.launchCapturing = false;
    this.launchBuf = [];
    this.core1.launchEcho(0); // core1 signals it drained its FIFO and is ready (multicore_reset_core1)
  }

  /**
   * Service the core1 launch handshake: echo every value core0 pushes and track the
   * {0, 0, 1, vector_table, sp, entry} sequence. Returns the launch parameters once complete
   * (core0's echoes matched, so no resync was needed), otherwise null. Call once per step while held.
   */
  core1LaunchPoll(): { vtor: number; sp: number; entry: number } | null {
    if (!this.launchWaiting) return null;
    while (this.core1.launchHasIncoming) {
      const v = this.core1.launchPopIncoming() >>> 0;
      this.core1.launchEcho(v); // echo back to core0's mailbox
      if (v === 0) {
        this.launchCapturing = false;
        this.launchBuf = [];
        continue;
      }
      if (!this.launchCapturing) {
        if (v === 1) this.launchCapturing = true; // the "1" marker precedes vtor/sp/entry
        continue;
      }
      this.launchBuf.push(v);
      if (this.launchBuf.length === 3) {
        this.launchWaiting = false;
        const [vtor, sp, entry] = this.launchBuf;
        return { vtor, sp, entry };
      }
    }
    return null;
  }

  writeUint32(offset: number, value: number, core: Core) {
    if (offset >= SPINLOCK0 && offset <= SPINLOCK31) {
      const bitIndexMask = ~(1 << ((offset - SPINLOCK0) / 4));
      this.spinLock &= bitIndexMask;
      return;
    }
    const prevGpioValue = this.gpioValue;
    const prevGpioOutputEnable = this.gpioOutputEnable;
    const prevGpioHiValue = this.gpioHiValue;
    const prevGpioHiOutputEnable = this.gpioHiOutputEnable;
    switch (offset) {
      case GPIO_OUT:
        this.gpioValue = value & GPIO_MASK;
        break;
      case GPIO_OUT_SET:
        this.gpioValue |= value & GPIO_MASK;
        break;
      case GPIO_OUT_CLR:
        this.gpioValue &= ~value;
        break;
      case GPIO_OUT_XOR:
        this.gpioValue ^= value & GPIO_MASK;
        break;
      case GPIO_OE:
        this.gpioOutputEnable = value & GPIO_MASK;
        break;
      case GPIO_OE_SET:
        this.gpioOutputEnable |= value & GPIO_MASK;
        break;
      case GPIO_OE_CLR:
        this.gpioOutputEnable &= ~value;
        break;
      case GPIO_OE_XOR:
        this.gpioOutputEnable ^= value & GPIO_MASK;
        break;
      case GPIO_HI_OUT:
        this.gpioHiValue = value & GPIO_MASK;
        break;
      case GPIO_HI_OUT_SET:
        this.gpioHiValue |= value & GPIO_MASK;
        break;
      case GPIO_HI_OUT_CLR:
        this.gpioHiValue &= ~value;
        break;
      case GPIO_HI_OUT_XOR:
        this.gpioHiValue ^= value & GPIO_MASK;
        break;
      case GPIO_HI_OE:
        this.gpioHiOutputEnable = value & GPIO_MASK;
        break;
      case GPIO_HI_OE_SET:
        this.gpioHiOutputEnable |= value & GPIO_MASK;
        break;
      case GPIO_HI_OE_CLR:
        this.gpioHiOutputEnable &= ~value;
        break;
      case GPIO_HI_OE_XOR:
        this.gpioHiOutputEnable ^= value & GPIO_MASK;
        break;
      case DOORBELL_OUT_SET: // ring bells on the other core
        this.ringDoorbell(core === Core.Core0 ? Core.Core1 : Core.Core0, value, 0);
        break;
      case DOORBELL_OUT_CLR: // rescind bells on the other core
        this.ringDoorbell(core === Core.Core0 ? Core.Core1 : Core.Core0, 0, value);
        break;
      case DOORBELL_IN_SET: // self-ring bells on this core
        this.ringDoorbell(core, value, 0);
        break;
      case DOORBELL_IN_CLR: // acknowledge bells on this core
        this.ringDoorbell(core, 0, value);
        break;
      default:
        // Divider, Interpolator, FIFO get handled per core in sio-core
        switch (core) {
          case Core.Core0:
            this.core0.writeUint32(offset, value);
            break;
          case Core.Core1:
            this.core1.writeUint32(offset, value);
            break;
        }
    }

    let pinsToUpdate =
      (this.gpioValue ^ prevGpioValue) | (this.gpioOutputEnable ^ prevGpioOutputEnable);
    const { gpio } = this.rp2040;
    if (pinsToUpdate) {
      for (let gpioIndex = 0; gpioIndex < 32; gpioIndex++) {
        if (pinsToUpdate & (1 << gpioIndex)) {
          gpio[gpioIndex].checkForUpdates();
        }
      }
    }

    pinsToUpdate =
      (this.gpioHiValue ^ prevGpioHiValue) | (this.gpioHiOutputEnable ^ prevGpioHiOutputEnable);
    if (pinsToUpdate) {
      for (let gpioIndex = 32; gpioIndex < gpio.length; gpioIndex++) {
        if (pinsToUpdate & (1 << (gpioIndex - 32))) {
          gpio[gpioIndex].checkForUpdates();
        }
      }
    }
    //TODO qspi pins
  }

  getPinValue(index: number) {
    if (index < 32) {
      return !!(this.gpioValue & (1 << index));
    } else if (index < 48) {
      return !!(this.gpioHiValue & (1 << (index - 32)));
    }
    //TODO qspi pins
    return false;
  }

  getOutputEnabled(index: number) {
    if (index < 32) {
      return !!(this.gpioOutputEnable & (1 << index));
    } else if (index < 48) {
      return !!(this.gpioHiOutputEnable & (1 << (index - 32)));
    }
    //TODO qspi pins
    return false;
  }
}
