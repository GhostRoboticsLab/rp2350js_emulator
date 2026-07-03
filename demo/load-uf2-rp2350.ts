// Family-id-aware UF2 loader for the RP2350. Unlike demo/load-flash.ts (RP2040-only, ignores the
// family id and hard-codes the flash base), this reads each block's boardFamily + target address,
// routes the payload to flash or SRAM by address, and warns on a wrong-arch image — in particular an
// Arm (Cortex-M33) build, which this RISC-V-only fork cannot run.
import { closeSync, openSync, readSync } from 'fs';
import { decodeBlock, familyMap } from 'uf2';
import { RP2350 } from '../src/rp2350.js';

// RP2350 UF2 family IDs (see the pico-sdk / picotool).
export const RP2350_FAMILY = {
  RISCV: 0xe48bff5a,
  ARM_S: 0xe48bff59,
  ARM_NS: 0xe48bff5b,
  ABSOLUTE: 0xe48bff57,
  DATA: 0xe48bff58,
  RP2040: 0xe48bff56,
} as const;

const FLASH_BASE = 0x10000000;
const FLASH_END = 0x11000000;
const SRAM_BASE = 0x20000000;
const SRAM_END = 0x20082000; // 520 KB

export type Uf2Region = 'flash' | 'sram' | null;

/** Which backing store a UF2 target address belongs to (null = outside modelled memory). */
export function uf2Region(addr: number): Uf2Region {
  if (addr >= FLASH_BASE && addr < FLASH_END) return 'flash';
  if (addr >= SRAM_BASE && addr < SRAM_END) return 'sram';
  return null;
}

/** Families this RISC-V-only RP2350 can actually run (plus benign data/absolute; 0 = no family tag). */
export function isRunnableFamily(id: number): boolean {
  return (
    id === RP2350_FAMILY.RISCV ||
    id === RP2350_FAMILY.ABSOLUTE ||
    id === RP2350_FAMILY.DATA ||
    id === 0
  );
}

export interface Uf2LoadResult {
  familyID: number;
  familyName: string;
  minAddr: number;
  maxAddr: number;
  blocks: number;
}

export function loadUF2(
  filename: string,
  chip: RP2350,
  warn: (m: string) => void = console.warn,
): Uf2LoadResult {
  const file = openSync(filename, 'r');
  const buffer = new Uint8Array(512);
  let familyID = 0;
  let minAddr = Infinity;
  let maxAddr = 0;
  let blocks = 0;
  const warned = new Set<number>();
  try {
    while (readSync(file, buffer) === buffer.length) {
      const { flashAddress: addr, payload, boardFamily } = decodeBlock(buffer);
      if (boardFamily) familyID = boardFamily;
      if (boardFamily && !isRunnableFamily(boardFamily) && !warned.has(boardFamily)) {
        warned.add(boardFamily);
        const isArm = boardFamily === RP2350_FAMILY.ARM_S || boardFamily === RP2350_FAMILY.ARM_NS;
        warn(
          `UF2 family 0x${boardFamily.toString(16)} (${familyMap.get(boardFamily) ?? 'unknown'})` +
            (isArm
              ? ' — this fork emulates only the RP2350 RISC-V (Hazard3) cores; an Arm Cortex-M33 image will not run'
              : ' — not an RP2350 RISC-V image'),
        );
      }
      const region = uf2Region(addr);
      if (region === 'flash') chip.flash.set(payload, addr - FLASH_BASE);
      else if (region === 'sram') chip.sram.set(payload, addr - SRAM_BASE);
      else {
        warn(`UF2 block targets 0x${addr.toString(16)} outside modelled flash/SRAM — skipped`);
        continue;
      }
      minAddr = Math.min(minAddr, addr);
      maxAddr = Math.max(maxAddr, addr + payload.length);
      blocks++;
    }
  } finally {
    closeSync(file);
  }
  return {
    familyID,
    familyName: familyMap.get(familyID) ?? `0x${familyID.toString(16)}`,
    minAddr: minAddr === Infinity ? 0 : minAddr,
    maxAddr,
    blocks,
  };
}
