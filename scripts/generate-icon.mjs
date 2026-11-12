/**
 * Generates assets/icon.png — a 256×256 black-and-white "M" tile icon.
 * No external dependencies — pure Node.js stdlib (zlib + fs).
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const W = 256,
  H = 256;
const SCALE = W / 64;

// CRC32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcSrc = Buffer.concat([t, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcSrc), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

// ── Icon design ─────────────────────────────────────────────────────────────
// Designed on a 64x64 grid and scaled up (same artwork as the website favicon):
//   • White tile (4..50, 4..50) with a black "M" cut into it
//   • Hatched hard shadow cast 10 units down-right from the tile
//   • Black background

const M = [
  [9, 44], [9, 10], [18, 10], [27, 25], [36, 10], [45, 10],
  [45, 44], [36, 44], [36, 26], [27, 41], [18, 26], [18, 44],
];
const SHADOW = [[50, 4], [60, 14], [60, 60], [14, 60], [4, 50]];

function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isWhite(nx, ny) {
  if (nx >= 4 && nx < 50 && ny >= 4 && ny < 50) return !inPolygon(M, nx, ny); // tile minus the M
  if (!inPolygon(SHADOW, nx, ny)) return false; // background = black
  // 45° stripes: 3 units wide (measured along x−y), repeating every 6
  const d = (((nx - ny) % 6) + 6) % 6;
  return d <= 1.5 || d >= 4.5;
}

// Supersample each pixel so the diagonals come out anti-aliased
const SS = 4;
function shade(x, y) {
  let hits = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      if (isWhite((x + (sx + 0.5) / SS) / SCALE, (y + (sy + 0.5) / SS) / SCALE)) hits++;
    }
  }
  return Math.round((hits / (SS * SS)) * 255);
}

// Build raw RGB scanlines with filter-byte 0 (None) prefix per row
const raw = [];
for (let y = 0; y < H; y++) {
  raw.push(0); // PNG filter byte
  for (let x = 0; x < W; x++) {
    const v = shade(x, y);
    raw.push(v, v, v);
  }
}

const compressed = deflateSync(Buffer.from(raw));

// IHDR: 256x256, 8-bit depth, RGB (colour type 2)
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", compressed),
  pngChunk("IEND", Buffer.alloc(0)),
]);

const outDir = join(__dirname, "..", "assets");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon.png"), png);
console.log("Generated assets/icon.png (256×256 M tile, black & white)");
