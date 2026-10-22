import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const destinationDir = path.join(root, "dist", "renderer");

// Shared hover/pressed/selected variables (src/main/interaction-css.ts) replace the placeholder in each overlay's :root.
const { INTERACTION_VARS_MB_CSS } = await import(pathToFileURL(path.join(root, "dist", "main", "interaction-css.js")).href);

await mkdir(destinationDir, { recursive: true });
await Promise.all([
  "index.html",
  "find.html",
  "palette.html",
  "notes.html",
  "glance.html",
  "prompt.html",
  "download-progress.html",
  "split-frame.html",
].map(async (fileName) => {
  const html = await readFile(path.join(root, "src", "renderer", fileName), "utf8");
  await writeFile(path.join(destinationDir, fileName), html.replaceAll("/*@mb-interaction-vars*/", INTERACTION_VARS_MB_CSS));
}));
