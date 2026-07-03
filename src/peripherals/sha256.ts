import { BasePeripheral, Peripheral } from './peripheral.js';

// SHA-256 — the RP2350 hardware SHA-256 accelerator. This is a *real* implementation of the
// compression function, not a stub: software resets the engine (CSR.START), pushes complete 512-bit
// blocks one 32-bit word at a time through WDATA, and reads the 256-bit digest back from SUM0..SUM7.
// The hardware does NOT pad the message — software feeds already-padded blocks — so SUM0..7 hold the
// SHA-256 of exactly the blocks written, which makes this NIST-vector testable.
//
// BSWAP (CSR bit 12, reset 1) byte-swaps each WDATA word before it enters the message schedule (the
// engine is big-endian internally; software usually writes little-endian words and lets BSWAP fix
// them). WDATA_RDY is always reported ready — we run the compression synchronously on the 16th word.
// Before this the block was unmapped and every SHA read threw.

const CSR = 0x00;
const WDATA = 0x04;
const SUM0 = 0x08; // SUM0..SUM7 at 0x08..0x24

const CSR_START = 1 << 0;
const CSR_WDATA_RDY = 1 << 1;
const CSR_SUM_VLD = 1 << 2;
const CSR_BSWAP = 1 << 12;

// SHA-256 initial hash values (first 32 bits of the fractional parts of the sqrt of the first 8 primes).
const H0 = Uint32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// Round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes).
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function byteswap(w: number): number {
  return (
    (((w >>> 24) & 0xff) |
      ((w >>> 8) & 0xff00) |
      ((w << 8) & 0xff0000) |
      ((w << 24) & 0xff000000)) >>>
    0
  );
}

export class RPSHA256 extends BasePeripheral implements Peripheral {
  private readonly h = Uint32Array.from(H0);
  private readonly block = new Uint32Array(16);
  private idx = 0; // words pushed into the current block
  private bswap = true; // CSR reset has BSWAP=1
  private sumValid = true; // CSR reset value (0x1206) has SUM_VLD=1

  private start() {
    this.h.set(H0);
    this.idx = 0;
    this.sumValid = false;
  }

  // One SHA-256 block compression. Intermediate sums can be JS-"negative" (bit 31 set), but every
  // result is reduced mod 2^32 with >>>0, and no intermediate sum leaves exact-integer range, so the
  // signedness is harmless.
  private compress() {
    const w = new Uint32Array(64);
    w.set(this.block);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = this.h[0],
      b = this.h[1],
      c = this.h[2],
      d = this.h[3];
    let e = this.h[4],
      f = this.h[5],
      g = this.h[6],
      hh = this.h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + hh) >>> 0;
  }

  readUint32(offset: number) {
    if (offset === CSR) {
      return (
        CSR_WDATA_RDY |
        (this.sumValid ? CSR_SUM_VLD : 0) |
        (this.bswap ? CSR_BSWAP : 0) |
        (0b10 << 8) // DMA_SIZE reset default (0b10)
      );
    }
    if (offset >= SUM0 && offset < SUM0 + 32) return this.h[(offset - SUM0) >> 2];
    return super.readUint32(offset);
  }

  writeUint32(offset: number, value: number) {
    switch (offset) {
      case CSR:
        this.bswap = !!(value & CSR_BSWAP); // BSWAP is a config bit, latched on any CSR write
        if (value & CSR_START) this.start();
        return;
      case WDATA: {
        const w = this.bswap ? byteswap(value >>> 0) : value >>> 0;
        this.block[this.idx++] = w;
        if (this.idx === 16) {
          this.compress();
          this.idx = 0;
          this.sumValid = true;
        }
        return;
      }
      default:
        super.writeUint32(offset, value);
    }
  }
}
