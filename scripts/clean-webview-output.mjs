import { rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(repositoryRoot, "out", "webview");
const expectedPrefix = `${resolve(repositoryRoot, "out")}${sep}`;

if (!target.startsWith(expectedPrefix) || !target.endsWith(`${sep}webview`)) {
  throw new Error(`Refusing to clean unexpected output path: ${target}`);
}

await rm(target, { recursive: true, force: true });
