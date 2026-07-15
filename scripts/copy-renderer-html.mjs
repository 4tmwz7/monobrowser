import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const destinationDir = path.join(root, "dist", "renderer");

await mkdir(destinationDir, { recursive: true });
await Promise.all([
  "index.html",
  "download-progress.html",
].map((fileName) => copyFile(
  path.join(root, "src", "renderer", fileName),
  path.join(destinationDir, fileName),
)));
