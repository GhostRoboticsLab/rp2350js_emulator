// RP2350 TRNG gate. TRNG_BASE was unmapped, so every TRNG register access threw. Real entropy isn't
// reproducible, so this models the interface with a seeded, deterministic PRNG: enabling the source
// fills the 192-bit EHR and raises EHR_VALID; reading the last EHR word consumes it and re-collects.
import { describe, expect, it } from 'vitest';
import { RP2350 } from '../rp2350.js';
import { RPTRNG } from './trng.js';

const TRNG_VALID = 0x110;
const EHR_DATA0 = 0x114;
const EHR_DATA5 = 0x128;
const RND_SOURCE_ENABLE = 0x12c;
const TRNG_BASE = 0x400f0000;

function enabled() {
  const t = new RPTRNG(new RP2350(), 'TRNG');
  t.writeUint32(RND_SOURCE_ENABLE, 1);
  return t;
}

describe('RP2350 TRNG (seeded, deterministic PRNG model)', () => {
  it('raises EHR_VALID once the source is enabled', () => {
    const t = new RPTRNG(new RP2350(), 'TRNG');
    expect(t.readUint32(TRNG_VALID) & 1).toBe(0); // idle before enable
    t.writeUint32(RND_SOURCE_ENABLE, 1);
    expect(t.readUint32(TRNG_VALID) & 1).toBe(1);
  });

  it('produces a non-zero, reproducible EHR from the fixed seed', () => {
    const a = enabled();
    const b = enabled();
    const wordA = a.readUint32(EHR_DATA0) >>> 0;
    expect(wordA).not.toBe(0);
    expect(b.readUint32(EHR_DATA0) >>> 0).toBe(wordA); // deterministic across instances
  });

  it('consumes the result on reading the last EHR word and collects a fresh one', () => {
    const t = enabled();
    const first = t.readUint32(EHR_DATA0) >>> 0;
    t.readUint32(EHR_DATA5); // read the final word -> consume + re-collect (still enabled)
    expect(t.readUint32(TRNG_VALID) & 1).toBe(1); // a fresh result is ready
    expect(t.readUint32(EHR_DATA0) >>> 0).not.toBe(first); // and it's a new value
  });

  it('is mapped on the chip bus (TRNG reads no longer throw)', () => {
    expect(() => new RP2350().readUint32(TRNG_BASE + TRNG_VALID)).not.toThrow();
  });
});
