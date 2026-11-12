import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ContextSource, ReferenceDocument } from "../shared/referenceContext";
import { isPathExcluded } from "./globMatch";
import { PROTECTED_EXCLUDED_GLOBS } from "./protectedGlobs";
import { loadAgentSkill, parseReferenceFrontmatter } from "./AgentSkillLoader";
import { isReferenceTextPath } from "../shared/referenceFiles";

export const REFERENCE_LIMITS = { files: 1000, directories: 2000, entries: 10000, bytes: 20 * 1024 * 1024, fileBytes: 256 * 1024, depth: 12 } as const;
export interface ReferenceScanResult { documents: ReferenceDocument[]; errors: Map<string, string[]> }

export function isInsideReferenceRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Explicit Skill links can bypass directory traversal; inspect every path component. */
async function rejectLinkedReferencePath(candidate: string, root: string): Promise<void> {
  if (!isInsideReferenceRoot(candidate, root)) throw new Error("範囲外の参照です。");
  let current = root;
  for (const part of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("リンク経由の参照は読み込みません。");
  }
}


function isBlockedReferencePath(candidate: string, root: string, blocked: (value: string) => boolean, workspaceRoots: readonly string[]): boolean {
  return [candidate, path.relative(root, candidate),
    ...workspaceRoots.filter(folder => isInsideReferenceRoot(candidate, folder)).map(folder => path.relative(folder, candidate))]
    .some(value => blocked(value) || blocked(`${value}/__reference__`));
}

/** Read through one handle with a hard cap and confirm the file did not move or change meanwhile. */
async function readBoundedReferenceFile(candidate: string, real: string, root: string, stat: import("node:fs").Stats): Promise<Buffer> {
  const handle = await fs.open(real, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > REFERENCE_LIMITS.fileBytes || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error("読み込み中にファイルが変わりました。");
    // Recheck real path after opening; never follow a changed child link outside the root.
    if (!isInsideReferenceRoot(await fs.realpath(candidate), root)) throw new Error("実体パスが変わりました。");
    const buffer = Buffer.alloc(REFERENCE_LIMITS.fileBytes + 1);
    let read = 0;
    while (read < buffer.length) {
      const result = await handle.read(buffer, read, buffer.length - read, read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    const after = await handle.stat();
    if (read > REFERENCE_LIMITS.fileBytes || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("読み込み中にファイルが変更されたか、サイズ上限を超えました。");
    return buffer.subarray(0, read);
  } finally { await handle.close(); }
}

async function referenceRoot(source: ContextSource): Promise<{ input: string; root: string }> {
  const url = new URL(source.uri);
  if (url.protocol !== "file:") throw new Error("ローカルファイルのみ対応しています。");
  const input = fileURLToPath(url);
  return { input, root: await fs.realpath(source.directory ? input : path.dirname(input)) };
}

/** Local Node Host only. Bounded handle reads avoid allocating arbitrarily growing files. */
export class ReferenceDocumentService {
  /**
   * Re-read only the given scanned documents with the same boundary checks as scan().
   * Returns the current content hash, or undefined when the file is gone, blocked or unreadable.
   */
  public async verify(source: ContextSource, relativePaths: readonly string[], excluded: readonly string[] = [],
    workspaceRoots: readonly string[] = []): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    const blocked = (name: string) => isPathExcluded(name, [...PROTECTED_EXCLUDED_GLOBS, ...excluded]);
    let root: string;
    try { ({ root } = await referenceRoot(source)); }
    catch { for (const relativePath of relativePaths) result.set(relativePath, undefined); return result; }
    for (const relativePath of new Set(relativePaths)) {
      try {
        if (!relativePath || path.isAbsolute(relativePath) || relativePath.split("/").some(part => part === ".." || part === ".")) throw new Error("範囲外");
        const candidate = path.resolve(root, ...relativePath.split("/"));
        await rejectLinkedReferencePath(candidate, root);
        if (isBlockedReferencePath(candidate, root, blocked, workspaceRoots) || !isReferenceTextPath(candidate)) throw new Error("保護対象");
        const stat = await fs.lstat(candidate);
        const real = await fs.realpath(candidate);
        if (!stat.isFile() || stat.size > REFERENCE_LIMITS.fileBytes || !isInsideReferenceRoot(real, root)) throw new Error("範囲外");
        const data = await readBoundedReferenceFile(candidate, real, root, stat);
        result.set(relativePath, createHash("sha256").update(data).digest("hex"));
      } catch { result.set(relativePath, undefined); }
    }
    return result;
  }

  public async scan(sources: readonly ContextSource[], excluded: readonly string[] = [], workspaceRoots: readonly string[] = []): Promise<ReferenceScanResult> {
    const documents: ReferenceDocument[] = [], errors = new Map<string, string[]>();
    let count = 0, bytes = 0, directories = 0, entries = 0;
    const blocked = (name: string) => isPathExcluded(name, [...PROTECTED_EXCLUDED_GLOBS, ...excluded]);
    for (const source of sources.filter(source => source.enabled)) {
      const issues: string[] = [];
      const visited = new Set<string>();
      errors.set(source.id, issues);
      const issue = (message: string) => { if (issues.length < 20 && !issues.includes(message)) issues.push(message); };
      try {
        const { input, root } = await referenceRoot(source);
        const blockedPath = (candidate: string) => isBlockedReferencePath(candidate, root, blocked, workspaceRoots);
        const walk = async (candidate: string, depth: number, skillResource = false): Promise<void> => {
          entries++;
          if (blockedPath(candidate)) return;
          if (depth > REFERENCE_LIMITS.depth) { issue("再帰深度の上限に達しました。"); return; }
          if (count >= REFERENCE_LIMITS.files || bytes >= REFERENCE_LIMITS.bytes || directories >= REFERENCE_LIMITS.directories || entries > REFERENCE_LIMITS.entries) {
            issue("走査上限に達しました。登録範囲を狭めてください。"); return;
          }
          const stat = await fs.lstat(candidate);
          if (stat.isSymbolicLink()) { issue("シンボリックリンク・ジャンクションは読み込みません。"); return; }
          const real = await fs.realpath(candidate);
          if (!isInsideReferenceRoot(real, root) || blockedPath(real)) {
            issue("登録範囲外または保護対象の実体パスを除外しました。"); return;
          }
          if (visited.has(real)) return;
          visited.add(real);
          if (stat.isDirectory()) {
            directories++;
            const skillDirectory = await fs.lstat(path.join(real, "SKILL.md")).then(info => info.isFile(), () => false);
            for await (const entry of await fs.opendir(real)) {
              const name = entry.name;
              if ((skillDirectory || skillResource || source.kind === "skill") && ["scripts", "assets"].includes(name.toLowerCase())) continue;
              // Skip bundled references during Skill discovery, not grouping directories with the same name.
              if (skillDirectory && source.kind === "skill" && !skillResource && name === "references") continue;
              try { await walk(path.join(real, name), depth + 1, skillResource); }
              catch { issue(`${name}: 読み込みできません。`); }
              if (count >= REFERENCE_LIMITS.files || bytes >= REFERENCE_LIMITS.bytes || directories >= REFERENCE_LIMITS.directories || entries > REFERENCE_LIMITS.entries) {
                issue("走査上限に達しました。登録範囲を狭めてください。"); break;
              }
            }
            return;
          }
          if (!stat.isFile() || !isReferenceTextPath(real)) return;
          count++;
          const relativePath = path.relative(root, real).replaceAll("\\", "/");
          if (stat.size > REFERENCE_LIMITS.fileBytes) { issue(`${relativePath}: 256KiBを超えるため除外しました。`); return; }
          if (bytes + stat.size > REFERENCE_LIMITS.bytes) { issue("本文合計20MiBの上限に達しました。"); bytes = REFERENCE_LIMITS.bytes; return; }
          const data = await readBoundedReferenceFile(candidate, real, root, stat);
          bytes += data.length;
          if (bytes > REFERENCE_LIMITS.bytes || data.includes(0)) { issue(`${relativePath}: バイナリまたは合計サイズ上限のため除外しました。`); return; }
          let text: string;
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/\r\n/g, "\n"); }
          catch { issue(`${relativePath}: UTF-8テキストではありません。`); return; }
          const skillFile = path.basename(real) === "SKILL.md";
          try {
            const skill = skillFile ? loadAgentSkill(text, path.basename(path.dirname(real))) : undefined;
            let parsed: ReturnType<typeof parseReferenceFrontmatter> | undefined;
            if (!skill && /\.(md|markdown)$/i.test(real)) {
              try { parsed = parseReferenceFrontmatter(text); }
              catch { issue(`${relativePath}: メタデータを認識できないため本文のみ参照します。`); }
            }
            const status = parsed?.metadata.status ?? /^\s*(?:status|状態)\s*:\s*(.+)$/im.exec(text)?.[1];
            documents.push({ id: createHash("sha256").update(`${source.id}\0${relativePath}`).digest("hex").slice(0, 24), sourceId: source.id,
              relativePath, title: skill?.name ?? /^#\s+(.+)$/m.exec(text)?.[1]?.slice(0, 160) ?? path.basename(real),
              text, hash: createHash("sha256").update(data).digest("hex"), kind: skill ? "skill" : source.kind,
              status: typeof status === "string" ? status.slice(0, 100) : undefined,
              skill: skill ? { name: skill.name, description: skill.description, compatibility: skill.compatibility, resources: skill.resources } : undefined });
            if (skill && source.selectedPaths.includes(relativePath)) {
              for (const resource of skill.resources) {
                if (resource.split("/").some(part => ["..", ".", "scripts", "assets"].includes(part.toLowerCase())) || resource.includes("\\")) {
                  issue(`${relativePath}: 範囲外を指すSkill参照を除外しました。`); continue;
                }
                try {
                  const target = path.resolve(path.dirname(real), resource);
                  await rejectLinkedReferencePath(target, path.dirname(real));
                  if (!isInsideReferenceRoot(await fs.realpath(target), path.dirname(real))) throw new Error("範囲外");
                  // Count actual path segments so a deep explicit link cannot bypass the depth cap.
                  await walk(target, path.relative(root, target).split(path.sep).filter(Boolean).length, true);
                } catch { issue(`${resource}: Skillの関連資料を読み込めません。`); }
              }
            }
          } catch (error) { issue(`${relativePath}: ${error instanceof Error ? error.message : "解析できません。"}`); }
        };
        await walk(input, 0);
      } catch { issue("参照先が見つからないか、読み取り権限がありません。"); }
    }
    documents.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.relativePath.localeCompare(b.relativePath));
    return { documents, errors };
  }
}
