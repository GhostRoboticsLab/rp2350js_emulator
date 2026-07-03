import { BasePeripheral, Peripheral } from './peripheral.js';

// POWMAN — the always-on (AON) power manager. This models the two pieces firmware actually depends
// on: the 64-bit AON millisecond timer and the write-password gate. Every POWMAN register WRITE must
// carry the password 0x5afe in bits [31:16]; only bits [15:0] are data (which is exactly why the
// 64-bit timer is split across four 16-bit SET_TIME registers). A write with the wrong password is
// dropped and latches BADPASSWD. Reads are never password-protected.
//
// Before this, POWMAN was a near-empty stub: it returned 0 for VREG (so the SDK's
// VREG.UPDATE_IN_PROGRESS poll wouldn't hang) and 0xffffffff for everything else — including the
// timer, which read as a garbage count. Everything unmodelled here is now store-and-readback backed
// by a zero-initialised register file (a benign "idle" default), and VREG still reads back 0 by
// default. Alarm/PWRUP/low-power power-state sequencing is deliberately out of scope (no firmware
// gate exercises it); those registers are plain store-and-readback.

const BADPASSWD = 0x00;
const SET_TIME_63TO48 = 0x60;
const SET_TIME_47TO32 = 0x64;
const SET_TIME_31TO16 = 0x68;
const SET_TIME_15TO0 = 0x6c;
const READ_TIME_UPPER = 0x70;
const READ_TIME_LOWER = 0x74;
const TIMER = 0x88;

const PASSWORD = 0x5afe;

const TIMER_RUN = 1 << 1;
const TIMER_CLEAR = 1 << 2;
const TIMER_USING_LPOSC = 1 << 17; // read-only status: timer is clocked from the low-power oscillator

const TWO32 = 0x100000000;
const REG_WORDS = 0x100 >> 2; // store-and-readback file for the unmodelled registers (offsets 0..0xfc)

export class RPPOWMAN extends BasePeripheral implements Peripheral {
  // AON timer, in milliseconds. While stopped, `baseMs` is the live value; while running the live
  // value is baseMs + (now - runStartNanos)/1e6 — the AON tick is nominally 1 kHz (1 ms), and this
  // free-runs off the chip clock so a firmware that starts the timer and reads it back sees it count.
  private baseMs = 0;
  private runStartNanos = 0;
  private running = false;
  private badPasswd = false;
  // The four 16-bit SET_TIME halves ([15:0],[31:16],[47:32],[63:48]); only applied while stopped.
  private readonly setWords = new Uint16Array(4);
  private readonly regs = new Uint32Array(REG_WORDS);

  private nowMs(): number {
    if (!this.running) return this.baseMs;
    return this.baseMs + (this.rp2040.clock.nanos - this.runStartNanos) / 1e6;
  }

  readUint32(offset: number) {
    switch (offset) {
      case BADPASSWD:
        return this.badPasswd ? 1 : 0;
      case READ_TIME_LOWER:
        return Math.floor(this.nowMs()) % TWO32 >>> 0;
      case READ_TIME_UPPER:
        return Math.floor(Math.floor(this.nowMs()) / TWO32) >>> 0;
      case TIMER:
        return (this.regs[TIMER >> 2] | (this.running ? TIMER_RUN | TIMER_USING_LPOSC : 0)) >>> 0;
    }
    if (offset < 0x100) return this.regs[offset >> 2];
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    // Password gate: bits [31:16] must equal 0x5afe. A bad password is dropped and latches BADPASSWD.
    if (((value >>> 16) & 0xffff) !== PASSWORD) {
      this.badPasswd = true;
      return;
    }
    const data = value & 0xffff;
    switch (offset) {
      case BADPASSWD:
        this.badPasswd = false; // a correctly-passworded write clears the latch
        return;
      case SET_TIME_15TO0:
        this.applySet(0, data);
        return;
      case SET_TIME_31TO16:
        this.applySet(1, data);
        return;
      case SET_TIME_47TO32:
        this.applySet(2, data);
        return;
      case SET_TIME_63TO48:
        this.applySet(3, data);
        return;
      case TIMER:
        if (data & TIMER_CLEAR) {
          this.baseMs = 0;
          this.setWords.fill(0);
          this.runStartNanos = this.rp2040.clock.nanos;
        }
        if (data & TIMER_RUN) {
          if (!this.running) {
            this.baseMs = this.nowMs();
            this.runStartNanos = this.rp2040.clock.nanos;
            this.running = true;
          }
        } else if (this.running) {
          this.baseMs = this.nowMs();
          this.running = false;
        }
        this.regs[TIMER >> 2] = data & ~(TIMER_RUN | TIMER_CLEAR);
        return;
    }
    if (offset < 0x100) this.regs[offset >> 2] = data;
  }

  // "SET_TIME_* must only be written when TIMER_RUN=0"; assemble the 64-bit base from the 4 halves.
  private applySet(index: number, data: number) {
    this.setWords[index] = data & 0xffff;
    const lo = (this.setWords[0] | (this.setWords[1] << 16)) >>> 0;
    const hi = (this.setWords[2] | (this.setWords[3] << 16)) >>> 0;
    this.baseMs = hi * TWO32 + lo;
    if (this.running) this.runStartNanos = this.rp2040.clock.nanos;
  }
}
