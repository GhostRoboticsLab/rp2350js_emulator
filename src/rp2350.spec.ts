import * as fs from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { BasePeripheral } from './peripherals/peripheral.js';
import { RP2350 } from './rp2350.js';
import { bootrom_rp2350_A2 } from '../demo/bootrom_rp2350.js';
import { loadHex } from '../demo/intelhex.js';
import { GPIOPinState } from '../src/gpio-pin.js';

describe('RP2350', () => {
  describe('IO Register Writes', () => {
    it('should replicate 8-bit values four times', () => {
      const rp2350 = new RP2350();
      const testPeripheral = new BasePeripheral(rp2350, 'TestPeripheral');
      const writeUint32 = vi.spyOn(testPeripheral, 'writeUint32');
      rp2350.peripherals[0x10] = testPeripheral;
      rp2350.writeUint8(0x10123, 0x534);
      expect(writeUint32).toHaveBeenCalledWith(0x120, 0x34343434);
    });

    it('should replicate 16-bit values twice', () => {
      const rp2350 = new RP2350();
      const testPeripheral = new BasePeripheral(rp2350, 'TestPeripheral');
      const writeUint32 = vi.spyOn(testPeripheral, 'writeUint32');
      rp2350.peripherals[0x10] = testPeripheral;
      rp2350.writeUint16(0x10123, 0x12345678);
      expect(writeUint32).toHaveBeenCalledWith(0x120, 0x56785678);
    });

    it('should support atomic I/O register write addresses', () => {
      const rp2350 = new RP2350();
      const testPeripheral = new BasePeripheral(rp2350, 'TestAtomic');
      vi.spyOn(testPeripheral, 'readUint32').mockReturnValue(0xff);
      const writeUint32 = vi.spyOn(testPeripheral, 'writeUint32');
      rp2350.peripherals[0x10] = testPeripheral;
      rp2350.writeUint32(0x11120, 0x0f);
      expect(writeUint32).toHaveBeenCalledWith(0x120, 0xf0);
    });
  });

  // NOTE (GhostLabs fork): blink_simple and hello_timer now PASS on the latest-upstream base. Two
  // genuine RISC-V core bugs (found by lockstepping this engine against c1570's) were fixed:
  //   * MEINEXT reset value — it must reset to NOIRQ, else the !NOIRQ interrupt gate took a phantom
  //     IRQ 0 the instant the firmware enabled interrupts (this is what stalled hello_timer).
  //   * MTVEC mode bits — trap targets must mask mtvec[1:0]; a vectored mtvec (RP2350 uses
  //     0x20000001) sent an exception to the odd address 0x20000001 and crashed (the pio_blink fault).
  // pio_blink is still skipped: its crash is fixed, but driving GPIO from PIO on RP2350 needs the
  // RP2350-specific PIO feature set ported from c1570 (GPIOBASE register for GPIO32, the 32-bit
  // pin mask, IN_COUNT, and the RP2350 IRQ-index mode). See ROADMAP.md.
  describe('rp2350js regression tests', () => {
    it('should run blink_simple', () => {
      const rp2350 = new RP2350();
      rp2350.loadBootrom(bootrom_rp2350_A2);
      const hex = fs.readFileSync("./demo/riscv_blink/blink_simple.hex", 'utf-8');
      loadHex(hex, rp2350.sram, 0x20000000);
      rp2350.core0.pc = rp2350.core1.pc = 0x20000220;
      let gpio2toggle = 0;
      let gpio25toggle = 0;
      rp2350.gpio[2].addListener( (state: GPIOPinState, oldState: GPIOPinState) => { if(state == 1 && oldState == 0) gpio2toggle++ } );
      rp2350.gpio[25].addListener( (state: GPIOPinState, oldState: GPIOPinState) => { if(state == 1 && oldState == 0) gpio25toggle++ } );
      for(let i = 0; i < 500000; i++) rp2350.step();
      expect(gpio2toggle).equals(5);
      expect(gpio25toggle).equals(2);
    });

    it('should run hello_timer', () => {
      const rp2350 = new RP2350();
      rp2350.loadBootrom(bootrom_rp2350_A2);
      const hex = fs.readFileSync("./demo/riscv_timer/hello_timer.hex", 'utf-8');
      loadHex(hex, rp2350.flash, 0x10000000);
      rp2350.core0.pc = rp2350.core1.pc = 0x10000036;
      let output = "";
      rp2350.uart[0].onByte = (value: number) => {
        output = output + String.fromCharCode(value);
      };
      for(let i = 0; i < 250000000; i++) rp2350.step();
      expect(output.startsWith("Hello Timer!")).toBeTruthy();
      expect((output.match(/Repeat at/g) || []).length).equals(19);
    }, 60000);
  });

  it.skip('should run pio_blink', () => {
    const rp2350 = new RP2350();
    rp2350.loadBootrom(bootrom_rp2350_A2);
    const hex = fs.readFileSync("./demo/riscv_pio_blink/pio_blink.hex", 'utf-8');
    loadHex(hex, rp2350.sram, 0x20000000);

    rp2350.core0.pc = rp2350.core1.pc = 0x20000220;
    let output = "";
    rp2350.uart[0].onByte = (value: number) => {
      output = output + String.fromCharCode(value);
    };
    let gpio3toggle = 0;
    let gpio32toggle = 0;
    rp2350.gpio[3].addListener( (state: GPIOPinState, oldState: GPIOPinState) => { rp2350.gpio[3].setInputValue(state == 1); if(state == 1 && oldState == 0) gpio3toggle++ } );
    rp2350.gpio[32].addListener( (state: GPIOPinState, oldState: GPIOPinState) => { rp2350.gpio[32].setInputValue(state == 1); if(state == 1 && oldState == 0) gpio32toggle++ } );
    for(let i = 0; i < 2000000; i++) rp2350.step();
    expect(gpio3toggle).equals(2);
    expect(gpio32toggle).equals(2);
  }, 20000);
});
