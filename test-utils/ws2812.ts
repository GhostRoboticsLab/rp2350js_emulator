// ws2812.ts — reconstruct WS2812 pixel frames from a single GPIO data line.
//
// The emulator faithfully toggles the GPIO that firmware drives via PIO+DMA, so we
// recover pixels the way a logic analyzer would: measure each high-pulse width (a '1'
// bit is a long high, a '0' a short one), pack 24 bits per pixel, and flush a frame on
// the long reset/latch low between frames.
//
// Ported from the GhostLabs PGA2350 carrier digital-twin (ghostshow/sim/src/ws2812.ts),
// MIT, same lineage as this fork. Used as a firmware-integration test helper: it turns
// the GP28 waveform this engine emits into the 24-pixel ghost the carrier renders.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** WS2812 colour order on the wire. GRB is the WS2812B default (and ghostshow's). */
export type BitOrder = 'GRB' | 'RGB';

export interface Ws2812Opts {
  pixels?: number; // pixels per frame (default 24)
  oneNs?: number; // high-pulse threshold for a '1' bit, ns (default 560)
  resetNs?: number; // low gap that delimits a frame, ns (default 10000)
  order?: BitOrder; // colour order on the wire (default GRB)
  onFrame?: (frame: RGB[]) => void;
}

export class Ws2812Decoder {
  private readonly pixels: number;
  private readonly oneNs: number;
  private readonly resetNs: number;
  private readonly order: BitOrder;
  private readonly onFrame?: (frame: RGB[]) => void;

  private tRise = 0;
  private lastFall = 0;
  private word = 0;
  private nbits = 0;
  private pixbuf: RGB[] = [];
  edges = 0;
  frameCount = 0;
  latestFrame: RGB[] | null = null;

  constructor(opts: Ws2812Opts = {}) {
    this.pixels = opts.pixels ?? 24;
    this.oneNs = opts.oneNs ?? 560;
    this.resetNs = opts.resetNs ?? 10000;
    this.order = opts.order ?? 'GRB';
    this.onFrame = opts.onFrame;
  }

  /** Feed one GPIO transition. `high` = new pin level, `nowNs` = emulated time (ns). */
  edge(high: boolean, nowNs: number): void {
    this.edges++;
    if (high) {
      // A long low before this rising edge delimits the previous frame.
      if (nowNs - this.lastFall > this.resetNs && (this.pixbuf.length || this.nbits)) {
        this.flush();
      }
      this.tRise = nowNs;
    } else {
      this.pushBit(nowNs - this.tRise > this.oneNs ? 1 : 0);
      this.lastFall = nowNs;
    }
  }

  private pushBit(bit: number): void {
    this.word = ((this.word << 1) | bit) >>> 0;
    if (++this.nbits === 24) {
      // 24 = 3 colour bytes/pixel
      const w = this.word;
      const hi = (w >> 16) & 0xff,
        mid = (w >> 8) & 0xff,
        lo = w & 0xff; // wire bytes, MSB-first
      // GRB sends G,R,B (so r=mid, g=hi); RGB sends R,G,B. Blue is the last byte either way.
      this.pixbuf.push(this.order === 'RGB' ? { r: hi, g: mid, b: lo } : { r: mid, g: hi, b: lo });
      this.word = 0;
      this.nbits = 0;
    }
  }

  private flush(): void {
    if (this.pixbuf.length >= this.pixels) {
      const frame = this.pixbuf.slice(0, this.pixels);
      this.frameCount++;
      this.latestFrame = frame;
      this.onFrame?.(frame);
    }
    this.pixbuf = [];
    this.word = 0;
    this.nbits = 0;
  }
}
