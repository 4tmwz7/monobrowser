/**
 * Generates assets/icon.png — a 256×256 black-and-white two-squares icon.
 * No external dependencies — pure Node.js stdlib (zlib + fs).
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const W = 256,
  H = 256;
const SCALE = W / 32;

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
// Two squares, diagonally offset, designed on a 32x32 grid and scaled up:
//   • White filled square — top-left  (2..18, 2..18)
//   • Black filled square — bottom-right (14..30, 14..30)
//     with a 1-px white outline so it reads against the black background
// The black square sits "on top" — the overlap region goes black.

function isWhite(x, y) {
  const nx = (x + 0.5) / SCALE;
  const ny = (y + 0.5) / SCALE;

  const inWhiteSq = nx >= 2 && nx <= 18 && ny >= 2 && ny <= 18;
  const inBlackSq = nx >= 14 && nx <= 30 && ny >= 14 && ny <= 30;
  const onBlackSqBorder =
    inBlackSq &&
    (Math.abs(nx - 14) <= 0.6 ||
      Math.abs(nx - 30) <= 0.6 ||
      Math.abs(ny - 14) <= 0.6 ||
      Math.abs(ny - 30) <= 0.6);

  if (onBlackSqBorder) return true; // white outline of black square
  if (inBlackSq) return false; // black square on top
  if (inWhiteSq) return true; // white square (where not covered)
  return false; // background = black
}

// Build raw RGB scanlines with filter-byte 0 (None) prefix per row
const raw = [];
for (let y = 0; y < H; y++) {
  raw.push(0); // PNG filter byte
  for (let x = 0; x < W; x++) {
    const v = isWhite(x, y) ? 255 : 0;
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
console.log("Generated assets/icon.png (256×256 two-squares, black & white)");
