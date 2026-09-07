import { readFile, stat } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * media/material-symbols-outlined.woff2 は使用アイコンだけのサブセットなので、
 * ソースに新しいアイコン名を書いてもフォント側に字形がなく、UI にはアイコン名の
 * 文字列がそのまま出てしまう。ビルド時にそれを検出する。
 *
 * 抽出はベストエフォート。名前を実行時に組み立てている箇所は拾えないため、
 * 動的にアイコン名を作らないこと。
 */

const manifestPath = path.resolve("media/icon-subset.json");
const fontPath = path.resolve("media/material-symbols-outlined.woff2");
const sourceRoot = path.resolve("src");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const known = new Set(manifest.icons);

const fontContents = await readFile(fontPath);
const fontBytes = (await stat(fontPath)).size;
if (fontBytes > manifest.maxBytes) {
  throw new Error(
    `Icon font is larger than expected: ${fontBytes} bytes > ${manifest.maxBytes}. ` +
      "サブセットではなくフル版を置いていないか確認してください。"
  );
}

const fontSha256 = createHash("sha256").update(fontContents).digest("hex");
if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || fontSha256 !== manifest.sha256) {
  throw new Error(
    "Icon font does not match media/icon-subset.json. " +
      "scripts/subset-icon-font.py でフォントとマニフェストを一緒に作り直してください。"
  );
}

const used = new Set();
for (const file of await collectSourceFiles(sourceRoot)) {
  const source = await readFile(file, "utf8");
  for (const name of extractIconNames(source)) {
    used.add(name);
  }
}

const missing = [...used].filter((name) => !known.has(name)).sort();
if (missing.length > 0) {
  throw new Error(
    `These icons are used in src/ but are not in the font subset: ${missing.join(", ")}\n` +
      "scripts/subset-icon-font.py でフォントを作り直し、media/icon-subset.json を更新してください。"
  );
}

const unused = [...known].filter((name) => !used.has(name)).sort();
console.log(
  `Icon subset OK: ${used.size} used / ${known.size} bundled, font=${(fontBytes / 1024).toFixed(1)} KB` +
    (unused.length > 0 ? ` (unused: ${unused.length})` : "")
);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }
      return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
    })
  );
  return nested.flat();
}

function extractIconNames(source) {
  const names = new Set();

  // <span className="... material-symbols-outlined ...">icon_name</span>
  for (const [, body] of source.matchAll(/material-symbols-outlined[^>]*>([\s\S]*?)</g)) {
    const literal = body.trim();
    if (/^[a-z0-9_]+$/.test(literal)) {
      names.add(literal);
      continue;
    }
    // 三項演算子などで切り替えている場合は、中の文字列リテラルをすべて候補にする。
    for (const [, , value] of literal.matchAll(/(["'])([a-z0-9_]+)\1/g)) {
      names.add(value);
    }
  }

  // icon="name" / icon='name' / icon: "name"（SettingTitle や navIcons の props）
  for (const [, , value] of source.matchAll(/\bicon\s*[:=]\s*(["'])([a-z0-9_]+)\1/g)) {
    names.add(value);
  }

  return names;
}
