// ghostshow.spec.ts — firmware-integration gate for the GhostLabs PGA2350 carriers.
//
// Boots the REAL `ghostshow` RISC-V image (the light show in the README GIFs) on this
// fork's RP2350, decodes the GP28 WS2812 data line into 24-pixel ghost frames, and
// asserts the firmware boots, animates, honours its power cap, and takes console input.
// Both carriers (full `x` + `mini`) run this same GHOSTSHOW_SIM build and the same
// 24-px/GP28/GRB WS2812 profile — they differ only in physical LED geometry (rendered by
// the browser twin), so this one gate covers both boards' firmware path.
//
// Mirrors the carrier repo's own headless gate (ghostshow/sim/test/boot.test.ts), which
// ran against the vendored c1570 engine; here it runs against this fork.
import * as fs from 'fs';
import { describe, expect, it, beforeAll } from 'vitest';
import { RP2350 } from './rp2350.js';
import { GPIOPinState } from './gpio-pin.js';
import { bootrom_rp2350_A2 } from '../demo/bootrom_rp2350.js';
import { loadHex } from '../demo/intelhex.js';
import { Ws2812Decoder, RGB } from '../test-utils/ws2812.js';

const HEX = './demo/riscv_ghostshow/ghostshow.hex';
const ENTRY = 0x20000220; // pico no_flash crt0 entry (GHOSTSHOW_SIM build)

describe('ghostshow — GhostLabs PGA2350 carrier (full + mini) digital twin', () => {
  let mcu: RP2350;
  let serial = '';
  let decoder: Ws2812Decoder;

  const step = (n: number) => {
    for (let i = 0; i < n; i++) mcu.step();
  };
  const runUntil = (cond: () => boolean, maxSteps: number) => {
    for (let i = 0; i < maxSteps; i++) {
      mcu.step();
      if (cond()) return true;
    }
    return false;
  };

  beforeAll(() => {
    mcu = new RP2350();
    mcu.loadBootrom(bootrom_rp2350_A2);
    loadHex(fs.readFileSync(HEX, 'utf-8'), mcu.sram, 0x20000000);
    mcu.core0.pc = ENTRY;
    mcu.core1.waiting = true; // GHOSTSHOW_SIM is single-core (field computed on core0)

    const utf8 = new TextDecoder();
    mcu.uart[0].onByte = (v: number) => {
      serial += utf8.decode(new Uint8Array([v]), { stream: true });
    };

    decoder = new Ws2812Decoder({ pixels: 24, order: 'GRB' });
    mcu.gpio[28].addListener((state: GPIOPinState) => {
      decoder.edge(state === GPIOPinState.High, (mcu.clock as { nanos: number }).nanos);
    });

    // Boot far enough to print the console and render several frames.
    const ok = runUntil(() => decoder.frameCount >= 3, 12_000_000);
    expect(ok, `only ${decoder.frameCount} frames after 12M steps`).toBe(true);
  }, 60_000);

  it('boots and prints the banner + full effect list over the console', () => {
    expect(serial).toContain('GhostLabs PGA2350');
    expect(serial).toContain('effects:');
    for (const name of ['rainbow', 'plasma', 'fire', 'marquee']) {
      expect(serial).toContain(name);
    }
  });

  it('drives the WS2812 line and decodes 24-pixel frames with in-range bytes', () => {
    expect(decoder.frameCount).toBeGreaterThanOrEqual(3);
    const f = decoder.latestFrame as RGB[];
    expect(f).toHaveLength(24);
    for (const p of f) {
      for (const c of [p.r, p.g, p.b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  // Tier 3.1 negative control: before the PIO fractional-divider + delay-slot fix, the SM ran at
  // full clk_sys, so GP28 '1'-bit high-pulses were ~8-32 ns instead of the ~1050 ns / ~300 ns
  // ('1'/'0') the divider now produces (measured) — every bit read '0' and the ghost decoded
  // all-black. Honouring CLKDIV restores real WS2812 timing and lights the ghost: red before, green after.
  it('renders a non-black ghost (PIO CLKDIV / delay slots honoured)', () => {
    const f = decoder.latestFrame as RGB[];
    expect(f.filter((p) => p.r || p.g || p.b).length).toBeGreaterThan(0);
    const total = f.reduce((s, p) => s + p.r + p.g + p.b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(16000); // matrix.c POWER_LIMIT, well under 24*3*255 = 18360
  });

  it('responds to a console keystroke (pause toggle echoes back)', () => {
    const mark = serial.length;
    mcu.uart[0].feedByte(' '.charCodeAt(0));
    runUntil(() => /paused|auto/.test(serial.slice(mark)), 3_000_000);
    expect(serial.slice(mark)).toMatch(/paused|auto/);
  });
});

// Dual-core variant (ghostshow_mc): core0 renders while core1 runs the FPU plasma field, launched
// via multicore_launch_core1. This exercises the emulator's PSM/FIFO core1-launch path end-to-end —
// core1 is held in the bootrom wait-loop until core0 completes the {0,0,1,vtor,sp,entry} handshake,
// then jumps to the trampoline and runs field_core1_entry. Without that path core1 never leaves the
// wait-loop, so core0 blocks in matrix_present and the ghost never renders (the negative control).
describe('ghostshow dual-core — core1 launch (PSM/FIFO handshake) drives the field', () => {
  const HEX = './demo/riscv_ghostshow/ghostshow_mc.hex';
  let mcu: RP2350;
  let decoder: Ws2812Decoder;

  beforeAll(() => {
    mcu = new RP2350();
    mcu.loadBootrom(bootrom_rp2350_A2);
    loadHex(fs.readFileSync(HEX, 'utf-8'), mcu.sram, 0x20000000);
    mcu.core0.pc = ENTRY;
    mcu.holdCore1ForLaunch(); // core1 held until core0 runs multicore_launch_core1
    decoder = new Ws2812Decoder({ pixels: 24, order: 'GRB' });
    mcu.gpio[28].addListener((state: GPIOPinState) => {
      decoder.edge(state === GPIOPinState.High, (mcu.clock as { nanos: number }).nanos);
    });
    for (let i = 0; i < 15_000_000 && decoder.frameCount < 4; i++) mcu.step();
  }, 60_000);

  it('launches core1, which runs the plasma field on its own core', () => {
    // core1 only advances cycles once launched and executing field_core1_entry.
    expect(mcu.core1.cycles).toBeGreaterThan(1_000_000);
    expect(mcu.core1.pc).toBeGreaterThan(0x20000000); // running firmware, not held at reset
  });

  it('renders the ghost dual-core (core0 present + core1 field): non-black 24-pixel frames', () => {
    expect(decoder.frameCount).toBeGreaterThanOrEqual(3);
    const f = decoder.latestFrame as RGB[];
    expect(f).toHaveLength(24);
    expect(f.filter((p) => p.r || p.g || p.b).length).toBeGreaterThan(0);
    const total = f.reduce((s, p) => s + p.r + p.g + p.b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(16000); // POWER_LIMIT
  });
});
