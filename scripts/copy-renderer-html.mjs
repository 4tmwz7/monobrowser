import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src", "renderer", "index.html");
const destinationDir = path.join(root, "dist", "renderer");
const destination = path.join(destinationDir, "index.html");

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
