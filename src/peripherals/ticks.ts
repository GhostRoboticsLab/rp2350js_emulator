import { BasePeripheral, Peripheral } from './peripheral.js';

// TICKS — the RP2350 tick generators. A shared reference clock is divided down by each of six
// generators (PROC0, PROC1, TIMER0, TIMER1, WATCHDOG, RISCV) to produce the ~1 MHz "tick" that
// clocks the system timers, the watchdog, and the per-core RISC-V mtime/SysTick. Each generator has
// three registers: CTRL (ENABLE bit0, RUNNING bit1 read-only), CYCLES (the 9-bit divider) and COUNT
// (the live divider countdown, read-only).
//
// On silicon software must start these before the gated timers advance. This fork deliberately does
// NOT gate its timers/watchdog on TICKS: the hello_timer firmware gate never programs TICKS (it
// bypasses the cold-boot/runtime-init that would), so gating would freeze that 250M-step run — the
// same reason clk_sys is still a fixed rate. TICKS is therefore store-and-readback: RUNNING tracks
// ENABLE and COUNT reads back the programmed reload. This still fixes the real lie of the old
// UnimplementedPeripheral, which read 0xffffffff for every register — reporting every generator as
// already RUNNING with a garbage divider.

const GEN_COUNT = 6;
const GEN_STRIDE = 0x0c; // CTRL, CYCLES, COUNT per generator
const CTRL_ENABLE = 1 << 0;
const CTRL_RUNNING = 1 << 1;
const CYCLES_MASK = 0x1ff;

export class RPTicks extends BasePeripheral implements Peripheral {
  private readonly enabled = new Array<boolean>(GEN_COUNT).fill(false);
  private readonly cycles = new Array<number>(GEN_COUNT).fill(0);

  readUint32(offset: number) {
    if (offset < GEN_COUNT * GEN_STRIDE) {
      const gen = Math.floor(offset / GEN_STRIDE);
      switch (offset - gen * GEN_STRIDE) {
        case 0x0: // CTRL: RUNNING mirrors ENABLE
          return this.enabled[gen] ? CTRL_ENABLE | CTRL_RUNNING : 0;
        case 0x4: // CYCLES
          return this.cycles[gen];
        case 0x8: // COUNT (read-only): the live reload while running, 0 when stopped
          return this.enabled[gen] ? this.cycles[gen] : 0;
      }
    }
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    if (offset < GEN_COUNT * GEN_STRIDE) {
      const gen = Math.floor(offset / GEN_STRIDE);
      switch (offset - gen * GEN_STRIDE) {
        case 0x0: // CTRL: only ENABLE is writable; RUNNING/COUNT are hardware-driven
          this.enabled[gen] = !!(value & CTRL_ENABLE);
          return;
        case 0x4: // CYCLES
          this.cycles[gen] = value & CYCLES_MASK;
          return;
        case 0x8: // COUNT is read-only
          return;
      }
    }
    super.writeUint32(offset, value);
  }
}
