import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("out/webview");
const mainFile = path.join(outputDirectory, "main.js");
const MAX_MAIN_BYTES = 400 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

const files = await collectFiles(outputDirectory);
const sizes = await Promise.all(files.map(async (file) => (await stat(file)).size));
const totalBytes = sizes.reduce((total, size) => total + size, 0);
const mainBytes = (await stat(mainFile)).size;

if (mainBytes > MAX_MAIN_BYTES || totalBytes > MAX_TOTAL_BYTES) {
  throw new Error(
    `Webview bundle size limit exceeded: main=${formatBytes(mainBytes)}, total=${formatBytes(totalBytes)}`
  );
}

console.log(`Webview bundle size OK: main=${formatBytes(mainBytes)}, total=${formatBytes(totalBytes)}, files=${files.length}`);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
