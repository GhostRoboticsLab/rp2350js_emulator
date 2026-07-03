// RP2350 SHA-256 gate. SHA256_BASE was unmapped, so every SHA register access threw. This is a real
// compression engine (not a stub): reset via CSR.START, push padded 512-bit blocks through WDATA,
// read the digest from SUM0..SUM7. The hardware doesn't pad, so the digest is exactly SHA-256 of the
// blocks written — checked against the FIPS 180-4 vectors for "abc" and the empty message.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPSHA256 } from './sha256.js';

const CSR = 0x00;
const WDATA = 0x04;
const SUM0 = 0x08;
const START = 1 << 0; // with BSWAP clear, words feed straight into the message schedule
const BSWAP = 1 << 12;
const SHA256_BASE = 0x400f8000;

function byteswap(w: number): number {
  return (
    (((w >>> 24) & 0xff) |
      ((w >>> 8) & 0xff00) |
      ((w << 8) & 0xff0000) |
      ((w << 24) & 0xff000000)) >>>
    0
  );
}

// The single padded 512-bit block for the 3-byte message "abc" (0x616263): 0x61626380 then zeros,
// with the 64-bit bit-length (24 = 0x18) in the final word.
function padBlockAbc(): number[] {
  const w = new Array(16).fill(0);
  w[0] = 0x61626380;
  w[15] = 0x18;
  return w;
}

// The single padded block for the empty message: just the 0x80 padding bit, length 0.
function padBlockEmpty(): number[] {
  const w = new Array(16).fill(0);
  w[0] = 0x80000000;
  return w;
}

function digest(sha: RPSHA256, words: number[]): number[] {
  sha.writeUint32(CSR, START); // BSWAP=0
  for (const w of words) sha.writeUint32(WDATA, w >>> 0);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(sha.readUint32(SUM0 + i * 4) >>> 0);
  return out;
}

describe('RP2350 SHA-256 (real engine, FIPS 180-4 vectors)', () => {
  it('hashes "abc"', () => {
    expect(digest(new RPSHA256(new RP2350(), 'SHA256'), padBlockAbc())).toEqual([
      0xba7816bf, 0x8f01cfea, 0x414140de, 0x5dae2223, 0xb00361a3, 0x96177a9c, 0xb410ff61,
      0xf20015ad,
    ]);
  });

  it('hashes the empty message', () => {
    expect(digest(new RPSHA256(new RP2350(), 'SHA256'), padBlockEmpty())).toEqual([
      0xe3b0c442, 0x98fc1c14, 0x9afbf4c8, 0x996fb924, 0x27ae41e4, 0x649b934c, 0xa495991b,
      0x7852b855,
    ]);
  });

  it('BSWAP byte-swaps WDATA so little-endian words hash identically', () => {
    const sha = new RPSHA256(new RP2350(), 'SHA256');
    sha.writeUint32(CSR, START | BSWAP);
    for (const w of padBlockAbc()) sha.writeUint32(WDATA, byteswap(w)); // fed little-endian; BSWAP flips
    expect(sha.readUint32(SUM0) >>> 0).toBe(0xba7816bf);
  });

  it('is mapped on the chip bus (SHA reads no longer throw)', () => {
    expect(() => new RP2350().readUint32(SHA256_BASE + CSR)).not.toThrow();
  });
});
