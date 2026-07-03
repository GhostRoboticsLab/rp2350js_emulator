import { BasePeripheral, Peripheral } from './peripheral.js';

// TRNG — the RP2350 true-random-number generator (an ARM/Synopsys CryptoCell TRNG). Real entropy is
// obviously not reproducible, so this models the *interface* with a seeded, deterministic PRNG
// (xorshift32) instead: enabling the source (RND_SOURCE_ENABLE) fills the 192-bit EHR (EHR_DATA0..5)
// and raises EHR_VALID; reading the last EHR word consumes the result and, while enabled, collects
// the next one. Deterministic from a fixed seed so tests are reproducible. Before this the block was
// unmapped and every TRNG read threw.

const RNG_ISR = 0x104; // interrupt status (bit0 = EHR_VALID)
const RNG_ICR = 0x108; // interrupt clear
const TRNG_VALID = 0x110; // bit0 = EHR_VALID
const EHR_DATA0 = 0x114; // EHR_DATA0..5 at 0x114..0x128
const EHR_DATA5 = 0x128;
const RND_SOURCE_ENABLE = 0x12c;
const TRNG_SW_RESET = 0x140;

const SEED = 0x2350c0de;

export class RPTRNG extends BasePeripheral implements Peripheral {
  private state = SEED >>> 0;
  private readonly ehr = new Uint32Array(6);
  private valid = false;
  private enabled = false;

  private nextWord(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x >>> 0;
    return this.state;
  }

  private collect() {
    for (let i = 0; i < 6; i++) this.ehr[i] = this.nextWord();
    this.valid = true;
  }

  readUint32(offset: number) {
    switch (offset) {
      case RNG_ISR:
      case TRNG_VALID:
        return this.valid ? 1 : 0;
      case RND_SOURCE_ENABLE:
        return this.enabled ? 1 : 0;
    }
    if (offset >= EHR_DATA0 && offset <= EHR_DATA5) {
      const value = this.ehr[(offset - EHR_DATA0) >> 2];
      if (offset === EHR_DATA5) {
        // Reading the final EHR word consumes the 192-bit result; collect the next one if still on.
        this.valid = false;
        if (this.enabled) this.collect();
      }
      return value;
    }
    return 0; // benign default for the unmodelled config/status registers (was: unmapped throw)
  }

  writeUint32(offset: number, value: number) {
    switch (offset) {
      case RND_SOURCE_ENABLE:
        this.enabled = !!(value & 1);
        if (this.enabled && !this.valid) this.collect();
        return;
      case TRNG_SW_RESET:
        if (value & 1) {
          this.state = SEED >>> 0;
          this.ehr.fill(0);
          this.valid = false;
          this.enabled = false;
        }
        return;
      case RNG_ICR:
        return; // interrupt clear — no-op (deterministic model keeps EHR ready)
    }
  }
}
