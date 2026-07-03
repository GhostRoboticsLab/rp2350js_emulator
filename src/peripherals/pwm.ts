import { IClock } from '../clock/clock.js';
import { IRQ } from '../irq.js';
import { Timer32, Timer32PeriodicAlarm, TimerMode } from '../utils/timer32.js';
import { DREQChannel } from './dma.js';
import { IRPChip } from '../rpchip.js';
import { BasePeripheral, Peripheral } from './peripheral.js';

/** Control and status register */
const CHn_CSR = 0x00;
/**
 * INT and FRAC form a fixed-point fractional number.
 * Counting rate is system clock frequency divided by this number.
 * Fractional division uses simple 1st-order sigma-delta.
 */
const CHn_DIV = 0x04;
/** Direct access to the PWM counter */
const CHn_CTR = 0x08;
/** Counter compare values */
const CHn_CC = 0x0c;
/** Counter wrap value */
const CHn_TOP = 0x10;

/**
 * This register aliases the CSR_EN bits for all channels.
 * Writing to this register allows multiple channels to be enabled
 * or disabled simultaneously, so they can run in perfect sync.
 * For each channel, there is only one physical EN register bit,
 * which can be accessed through here or CHx_CSR.
 */
// EN and the INTR/INTE/INTF/INTS interrupt registers sit immediately after the channel array, so
// their offsets scale with the slice count (8 on RP2040 -> EN 0xa0; 12 on RP2350 -> EN 0xf0), and
// the interrupt bit mask is (1 << numChannels) - 1. All computed per instance in the constructor.

/* CHn_CSR bits */
const CSR_PH_ADV = 1 << 7;
const CSR_PH_RET = 1 << 6;
const CSR_DIVMODE_SHIFT = 4;
const CSR_DIVMODE_MASK = 0x3;
const CSR_B_INV = 1 << 3;
const CSR_A_INV = 1 << 2;
const CSR_PH_CORRECT = 1 << 1;
const CSR_EN = 1 << 0;

enum PWMDivMode {
  FreeRunning,
  BGated,
  BRisingEdge,
  BFallingEdge,
}

class PWMChannel {
  readonly timer = new Timer32(this.clock, this.pwm.clockFreq);
  readonly alarmA = new Timer32PeriodicAlarm(this.timer, () => {
    this.setA(false);
  });
  readonly alarmB = new Timer32PeriodicAlarm(this.timer, () => {
    this.setB(false);
  });
  readonly alarmBottom = new Timer32PeriodicAlarm(this.timer, () => this.wrap());

  csr: number = 0;
  div: number = 0;
  cc: number = 0;
  top: number = 0;
  lastBValue = false;
  countingUp = true;
  ccUpdated = false;
  topUpdated = false;
  tickCounter = 0;
  divMode = PWMDivMode.FreeRunning;

  // GPIO pin indices: Table 525. Mapping of PWM channels to GPIO pins on RP2040
  readonly pinA1 = this.index * 2;
  readonly pinB1 = this.index * 2 + 1;
  readonly pinA2 = this.index < 7 ? 16 + this.index * 2 : -1;
  readonly pinB2 = this.index < 7 ? 16 + this.index * 2 + 1 : -1;

  constructor(
    private pwm: RPPWM,
    readonly clock: IClock,
    readonly index: number,
  ) {
    this.alarmA.enable = true;
    this.alarmB.enable = true;
    this.alarmBottom.enable = true;
  }

  readRegister(offset: number) {
    switch (offset) {
      case CHn_CSR:
        return this.csr;
      case CHn_DIV:
        return this.div;
      case CHn_CTR:
        return this.timer.counter;
      case CHn_CC:
        return this.cc;
      case CHn_TOP:
        return this.top;
    }
    /* Shouldn't get here */
    return 0;
  }

  writeRegister(offset: number, value: number) {
    switch (offset) {
      case CHn_CSR:
        if (value & CSR_EN && !(this.csr & CSR_EN)) {
          this.updateDoubleBuffered();
        }
        this.csr = value & ~(CSR_PH_ADV | CSR_PH_RET);
        if (this.csr & CSR_PH_ADV) {
          this.timer.advance(1);
        }
        if (this.csr & CSR_PH_RET) {
          this.timer.advance(-1);
        }
        this.divMode = (this.csr >> CSR_DIVMODE_SHIFT) & CSR_DIVMODE_MASK;
        this.setBDirection(this.divMode === PWMDivMode.FreeRunning);
        this.updateEnable();
        this.lastBValue = this.gpioBValue;
        this.timer.mode = value & CSR_PH_CORRECT ? TimerMode.ZigZag : TimerMode.Increment;
        break;
      case CHn_DIV: {
        this.div = value & 0x000f_ffff;
        const intValue = (value >> 4) & 0xff;
        const fracValue = value & 0xf;
        this.timer.prescaler = (intValue ? intValue : 256) + fracValue / 16;
        break;
      }
      case CHn_CTR:
        this.timer.set(value & 0xffff);
        break;
      case CHn_CC:
        this.cc = value;
        this.ccUpdated = true;
        break;
      case CHn_TOP:
        this.top = value & 0xffff;
        this.topUpdated = true;
        break;
    }
  }

  reset() {
    this.writeRegister(CHn_CSR, 0);
    this.writeRegister(CHn_DIV, 0x01 << 4);
    this.writeRegister(CHn_CTR, 0);
    this.writeRegister(CHn_CC, 0);
    this.writeRegister(CHn_TOP, 0xffff);
    this.countingUp = true;
    this.timer.enable = false;
    this.timer.reset();
  }

  private updateDoubleBuffered() {
    if (this.ccUpdated) {
      this.alarmB.target = this.cc >>> 16;
      this.alarmA.target = this.cc & 0xffff;
      this.ccUpdated = false;
    }
    if (this.topUpdated) {
      this.timer.top = this.top;
      this.topUpdated = false;
    }
  }

  private wrap() {
    this.pwm.channelInterrupt(this.index);
    this.updateDoubleBuffered();
    if (!(this.csr & CSR_PH_CORRECT)) {
      this.setA(this.alarmA.target > 0);
      this.setB(this.alarmB.target > 0);
    }
  }

  setA(value: boolean) {
    if (this.csr & CSR_A_INV) {
      value = !value;
    }
    this.pwm.gpioSet(this.pinA1, value);
    if (this.pinA2 >= 0) {
      this.pwm.gpioSet(this.pinA2, value);
    }
  }

  setB(value: boolean) {
    if (this.csr & CSR_B_INV) {
      value = !value;
    }
    this.pwm.gpioSet(this.pinB1, value);
    if (this.pinB2 >= 0) {
      this.pwm.gpioSet(this.pinB2, value);
    }
  }

  get gpioBValue() {
    return (
      this.pwm.gpioRead(this.pinB1) || (this.pinB2 > 0 ? this.pwm.gpioRead(this.pinB2) : false)
    );
  }

  setBDirection(value: boolean) {
    this.pwm.gpioSetDir(this.pinB1, value);
    if (this.pinB2 >= 0) {
      this.pwm.gpioSetDir(this.pinB2, value);
    }
  }

  gpioBChanged() {
    const value = this.gpioBValue;
    if (value === this.lastBValue) {
      return;
    }
    this.lastBValue = value;
    switch (this.divMode) {
      case PWMDivMode.BGated:
        this.updateEnable();
        break;

      case PWMDivMode.BRisingEdge:
        if (value) {
          this.tickCounter++;
        }
        break;

      case PWMDivMode.BFallingEdge:
        if (!value) {
          this.tickCounter++;
        }
        break;
    }

    if (this.tickCounter >= this.timer.prescaler) {
      this.timer.advance(1);
      this.tickCounter -= this.timer.prescaler;
    }
  }

  updateEnable() {
    const { csr, divMode } = this;
    const enable = !!(csr & CSR_EN);
    this.timer.enable =
      enable &&
      (divMode === PWMDivMode.FreeRunning || (divMode === PWMDivMode.BGated && this.gpioBValue));
  }

  get en(): number {
    // The EN register aliases every channel's CSR_EN bit. Without this getter `channel.en` read as
    // undefined, so the aggregated EN read always returned 0 (undefined << i === 0) — enabled slices
    // never showed up in a read-back of EN.
    return this.csr & CSR_EN ? 1 : 0;
  }

  set en(value: number) {
    if (value && !(this.csr & CSR_EN)) {
      this.updateDoubleBuffered();
    }
    if (value) {
      this.csr |= CSR_EN;
    } else {
      this.csr &= ~CSR_EN;
    }
    this.updateEnable();
  }
}

export class RPPWM extends BasePeripheral implements Peripheral {
  readonly channels: PWMChannel[];
  private readonly en: number; // EN register offset (immediately past the channel array)
  private readonly intr: number;
  private readonly inte: number;
  private readonly intf: number;
  private readonly ints: number;
  private readonly intMask: number; // (1 << numChannels) - 1
  private intRaw = 0;
  private intEnable = 0;
  private intForce = 0;

  gpioValue = 0;
  gpioDirection = 0;

  // pwm_wrap_irq: the PWM wrap IRQ (RP2040 PWM_WRAP vs RP2350 PWM_IRQ_WRAP_0).
  // pwm_dreq_base: first PWM-wrap DREQ; slice i raises pwm_dreq_base + i.
  constructor(
    rp2040: IRPChip,
    name: string,
    readonly pwm_wrap_irq: number = IRQ.PWM_WRAP,
    readonly pwm_dreq_base: number = DREQChannel.DREQ_PWM_WRAP0,
    numChannels: number = 8, // RP2040 has 8 PWM slices; RP2350 has 12
  ) {
    super(rp2040, name);
    this.channels = Array.from(
      { length: numChannels },
      (_, i) => new PWMChannel(this, this.rp2040.clock, i),
    );
    this.en = numChannels * 0x14; // EN immediately follows the channel blocks
    this.intr = this.en + 0x04;
    this.inte = this.en + 0x08;
    this.intf = this.en + 0x0c;
    this.ints = this.en + 0x10;
    this.intMask = (1 << numChannels) - 1;
  }

  get intStatus() {
    return (this.intRaw & this.intEnable) | this.intForce;
  }

  readUint32(offset: number) {
    if (offset < this.en) {
      const channel = Math.floor(offset / 0x14);
      return this.channels[channel].readRegister(offset % 0x14);
    }
    if (offset === this.en) {
      let value = 0;
      for (let i = 0; i < this.channels.length; i++) {
        if (this.channels[i].en) value |= 1 << i;
      }
      return value;
    }
    if (offset === this.intr) return this.intRaw;
    if (offset === this.inte) return this.intEnable;
    if (offset === this.intf) return this.intForce;
    if (offset === this.ints) return this.intStatus;
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    if (offset < this.en) {
      const channel = Math.floor(offset / 0x14);
      return this.channels[channel].writeRegister(offset % 0x14, value);
    }
    if (offset === this.en) {
      for (let i = 0; i < this.channels.length; i++) {
        this.channels[i].en = value & (1 << i);
      }
      return;
    }
    if (offset === this.intr) {
      this.intRaw &= ~(value & this.intMask);
      this.checkInterrupts();
      return;
    }
    if (offset === this.inte) {
      this.intEnable = value & this.intMask;
      this.checkInterrupts();
      return;
    }
    if (offset === this.intf) {
      this.intForce = value & this.intMask;
      this.checkInterrupts();
      return;
    }
    super.writeUint32(offset, value);
  }

  get clockFreq() {
    return this.rp2040.clkSys;
  }

  channelInterrupt(index: number) {
    this.intRaw |= 1 << index;
    this.checkInterrupts();

    // We also set the DMA Request (DREQ) for the channel
    this.rp2040.dma_setDREQ(this.pwm_dreq_base + index);
  }

  checkInterrupts() {
    this.rp2040.setInterrupt(this.pwm_wrap_irq, !!this.intStatus);
  }

  gpioSet(index: number, value: boolean) {
    const bit = 1 << index;
    const newGpioValue = value ? this.gpioValue | bit : this.gpioValue & ~bit;
    if (this.gpioValue != newGpioValue) {
      this.gpioValue = newGpioValue;
      this.rp2040.gpio[index].checkForUpdates();
    }
  }

  gpioSetDir(index: number, output: boolean) {
    const bit = 1 << index;
    const newGpioDirection = output ? this.gpioDirection | bit : this.gpioDirection & ~bit;
    if (this.gpioDirection != newGpioDirection) {
      this.gpioDirection = newGpioDirection;
      this.rp2040.gpio[index].checkForUpdates();
    }
  }

  gpioRead(index: number) {
    return this.rp2040.gpio[index].inputValue;
  }

  gpioOnInput(index: number) {
    if (this.gpioDirection && 1 << index) {
      return;
    }
    for (const channel of this.channels) {
      if (channel.pinB1 === index || channel.pinB2 === index) {
        channel.gpioBChanged();
      }
    }
  }

  reset() {
    this.gpioDirection = 0xffffffff;
    for (const channel of this.channels) {
      channel.reset();
    }
  }
}
