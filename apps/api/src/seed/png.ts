import zlib from "node:zlib";

/**
 * A tiny PNG encoder for the demo evidence. It draws flat rectangles onto an RGB canvas, which is enough for a
 * recognisable "screenshot" without shipping binary fixtures in the repository.
 */
export type Rgb = [number, number, number];

export class Canvas {
  readonly pixels: Buffer;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb = [255, 255, 255],
  ) {
    this.pixels = Buffer.alloc(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  rect(x: number, y: number, w: number, h: number, [r, g, b]: Rgb): this {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) {
        const i = (yy * this.width + xx) * 3;
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
      }
    }
    return this;
  }

  toPng(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0; // filter: none
      this.pixels.copy(raw, y * (this.width * 3 + 1) + 1, y * this.width * 3, (y + 1) * this.width * 3);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

const GREY: Rgb = [226, 230, 235];
const TEXT: Rgb = [190, 196, 204];

/** A browser-like page with an optional red error banner and a highlighted element. */
export function fakeScreenshot(options: { error?: boolean; mobile?: boolean; accent?: Rgb } = {}): Buffer {
  const mobile = options.mobile ?? false;
  const w = mobile ? 240 : 480;
  const h = mobile ? 420 : 300;
  const accent = options.accent ?? [37, 99, 235];
  const c = new Canvas(w, h);
  c.rect(0, 0, w, mobile ? 24 : 28, [32, 37, 45]); // title or status bar
  c.rect(0, mobile ? 24 : 28, w, 36, [247, 248, 250]);
  c.rect(12, mobile ? 34 : 38, mobile ? 80 : 120, 16, accent); // logo
  // product grid / form
  const cols = mobile ? 1 : 3;
  const cardW = Math.floor((w - 24 - (cols - 1) * 12) / cols);
  for (let i = 0; i < cols; i++) {
    const x = 12 + i * (cardW + 12);
    c.rect(x, 78, cardW, mobile ? 120 : 110, GREY);
    c.rect(x, mobile ? 206 : 196, cardW * 0.8, 8, TEXT);
    c.rect(x, mobile ? 220 : 210, cardW * 0.5, 8, TEXT);
  }
  if (options.error) {
    c.rect(12, h - 70, w - 24, 34, [254, 226, 226]);
    c.rect(12, h - 70, 4, 34, [220, 38, 38]);
    c.rect(26, h - 58, (w - 24) * 0.6, 8, [220, 38, 38]);
  }
  c.rect(w - (mobile ? 112 : 132), h - 30, mobile ? 100 : 120, 22, accent); // button
  return c.toPng();
}
