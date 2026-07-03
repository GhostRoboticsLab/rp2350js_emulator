// RP2350 (Hazard3 RISC-V) CLI runner. `npm start` drives the RP2040 via Simulator; the RP2350 has
// its own step() model and, until now, no runner at all — firmware could only be run by editing a
// spec. This loads a .uf2 (family-id routed) or .hex, boots the A2 bootrom, streams the UART console,
// and optionally counts edges on a GPIO (e.g. a WS2812 data pin).
//
//   npm run start:rp2350 -- --image demo/riscv_ghostshow/ghostshow.hex --pin 28 --steps 4000000
//   npm run start:rp2350 -- --image build/riscv/app.uf2 --entry 0x20000220
import * as fs from 'fs';
import minimist from 'minimist';
import { RP2350 } from '../src/rp2350.js';
import { GPIOPinState } from '../src/gpio-pin.js';
import { loadHex } from './intelhex.js';
import { loadUF2 } from './load-uf2-rp2350.js';
import { bootrom_rp2350_A2 } from './bootrom_rp2350.js';

const args = minimist(process.argv.slice(2), {
  string: ['image', 'entry', 'pin', 'steps'],
  boolean: ['flash'],
});

const image = args.image as string | undefined;
if (!image) {
  console.error(
    'usage: npm run start:rp2350 -- --image <file.uf2|.hex> [--entry 0x20000220] [--flash] [--pin 28] [--steps N]',
  );
  process.exit(1);
}

const mcu = new RP2350();
mcu.loadBootrom(bootrom_rp2350_A2);

let entry = args.entry ? parseInt(args.entry, 16) : undefined;
const ext = image.split('.').pop()?.toLowerCase();

if (ext === 'uf2') {
  const r = loadUF2(image, mcu);
  console.log(
    `Loaded UF2: family ${r.familyName}, ${r.blocks} blocks, 0x${r.minAddr.toString(16)}..0x${r.maxAddr.toString(16)}`,
  );
  if (entry === undefined) entry = r.minAddr >= 0x20000000 ? 0x20000220 : 0x10000000;
} else if (ext === 'hex') {
  const hex = fs.readFileSync(image, 'utf-8');
  loadHex(hex, args.flash ? mcu.flash : mcu.sram, args.flash ? 0x10000000 : 0x20000000);
  if (entry === undefined) entry = args.flash ? 0x10000000 : 0x20000220;
} else {
  console.error(`unsupported image type: .${ext} (expected .uf2 or .hex)`);
  process.exit(1);
}

mcu.core0.pc = mcu.core1.pc = entry as number;
mcu.core1.waiting = true; // single-core by default; firmware launches core1 itself when it needs it

mcu.uart[0].onByte = (v: number) => process.stdout.write(Buffer.from([v & 0xff]));

const pin = args.pin !== undefined ? Number(args.pin) : -1;
let edges = 0;
if (pin >= 0) {
  mcu.gpio[pin].addListener((s: GPIOPinState, o: GPIOPinState) => {
    if (s !== o) edges++;
  });
}

const steps = parseInt(args.steps ?? '20000000', 10);
console.error(
  `RP2350 (Hazard3 RISC-V) — entry 0x${(entry as number).toString(16)}, running ${steps} steps...\n`,
);
for (let i = 0; i < steps; i++) mcu.step();

console.error(
  `\n\n[done: ${mcu.cycles} cycles${pin >= 0 ? `, GP${pin} edges: ${edges}` : ''}]`,
);
