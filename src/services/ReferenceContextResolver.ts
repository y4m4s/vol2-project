import type { ContextSource, ReferenceDocument, ReferenceExcerpt } from "../shared/referenceContext";
import type { GuidanceContext } from "../shared/types";
import { isPathExcluded } from "./globMatch";
import { normalizeKnowledgeSearchText } from "./KnowledgeSearch";

/** Separate list commas from brace alternation commas, e.g. src/**.{ts,tsx}. */
export function parseReferencePatterns(text: string): string[] {
  const patterns: string[] = [];
  let start = 0, braces = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") braces++;
    if (text[i] === "}" && --braces < 0) throw new Error("globの波括弧が対応していません。");
    if (text[i] === "," && braces === 0) { patterns.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (braces !== 0) throw new Error("globの波括弧が対応していません。");
  patterns.push(text.slice(start).trim());
  const values = patterns.filter(Boolean);
  if (values.length > 30 || values.some(value => value.length > 200)) throw new Error("対象条件は30個以内・各200文字以内で指定してください。");
  return values;
}

export function referenceQueryTerms(value: string): string[] {
  const normalized = normalizeKnowledgeSearchText(value.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const terms = new Set(normalized.match(/[a-z][a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) ?? []);
  for (const word of [...terms]) {
    if (/\p{Script=Han}/u.test(word)) for (let i = 0; i < word.length - 1; i++) terms.add(word.slice(i, i + 2));
  }
  return [...terms].slice(0, 80);
}

export function resolveReferenceContext(sources: readonly ContextSource[], documents: readonly ReferenceDocument[], context: GuidanceContext,
  question: string, activeRelativePath: string, activeRoot?: string): ReferenceExcerpt[] {
  const primary = referenceQueryTerms(`${question}\n${context.additionalContext ?? ""}`);
  const secondary = referenceQueryTerms(`${context.activeFileLanguage ?? ""}\n${context.selectedText ?? context.activeFileExcerpt?.slice(0, 2000) ?? ""}\n${context.diagnosticsSummary.map(d => d.message).join("\n")}`);
  const ranked: { excerpt: ReferenceExcerpt; score: number; priority: number }[] = [];
  for (const source of sources.filter(source => source.enabled)) {
    if (source.workspaceRoot && source.workspaceRoot !== activeRoot) continue;
    if (source.languages.length && !source.languages.includes(context.activeFileLanguage ?? "")) continue;
    if (source.appliesTo.length && (!activeRelativePath || !isPathExcluded(activeRelativePath, source.appliesTo))) continue;
    for (const doc of documents.filter(doc => doc.sourceId === source.id)) {
      const pinned = source.selectedPaths.includes(doc.relativePath);
      if (source.kind === "skill" && (!doc.skill || !pinned)) continue;
      const obsolete = /superseded|deprecated|rejected|廃止|置換|却下/i.test(doc.status ?? "");
      if (source.kind === "adr" && obsolete && !pinned && !/過去|経緯|旧|廃止|履歴|history|superseded|deprecated/i.test(question)) continue;
      const chunks = doc.skill ? [{ text: doc.text, start: 1, end: doc.text.split("\n").length }] : chunkReferenceText(doc.text);
      for (const chunk of chunks) {
        const meta = normalizeKnowledgeSearchText(doc.relativePath, doc.title, doc.skill?.description ?? "");
        const haystack = normalizeKnowledgeSearchText(chunk.text);
        const score = primary.reduce((n, term) => n + (meta.includes(term) ? 6 : 0) + (haystack.includes(term) ? 3 : 0), 0) +
          secondary.reduce((n, term) => n + (meta.includes(term) ? 2 : 0) + (haystack.includes(term) ? 1 : 0), 0);
        if (!pinned && source.kind !== "rules" && score === 0) continue;
        ranked.push({ score, priority: pinned ? 2 : source.kind === "rules" ? 1 : 0, excerpt: {
          id: `${doc.id}:${chunk.start}`, sourceId: source.id, path: `${source.label}/${doc.relativePath}`, title: doc.title,
          kind: source.kind, hash: doc.hash, text: chunk.text, startLine: chunk.start, endLine: chunk.end,
          reason: pinned ? "明示選択" : source.kind === "rules" ? "言語・パスの適用範囲に一致" : `関連語の一致${doc.status ? ` / 状態: ${doc.status}` : ""}`,
          localOnly: source.localOnly, mode: doc.skill ? source.skillMode : "reference"
        } });
      }
    }
  }
  ranked.sort((a, b) => b.priority - a.priority || b.score - a.score || a.excerpt.path.localeCompare(b.excerpt.path) || a.excerpt.startLine - b.excerpt.startLine);
  // Skills remain complete. PromptBuilder may omit a whole skill but never clip its procedure.
  // Take one fragment per document first, so a long pinned file cannot crowd out a selected Skill.
  const selected: ReferenceExcerpt[] = [];
  const represented = new Set<string>();
  for (const { excerpt } of ranked) {
    const key = `${excerpt.sourceId}\0${excerpt.path}`;
    if (represented.has(key)) continue;
    selected.push(excerpt); represented.add(key);
    if (selected.length === 5) break;
  }
  for (const { excerpt } of ranked) {
    if (selected.length >= 5) break;
    if (!selected.some(item => item.id === excerpt.id)) selected.push(excerpt);
  }
  for (const skill of [...selected].filter(item => item.kind === "skill")) {
    const doc = documents.find(doc => `${doc.id}:1` === skill.id);
    const base = doc?.relativePath.replace(/[^/]+$/, "");
    for (const resource of doc?.skill?.resources ?? []) {
      const linked = documents.find(item => item.sourceId === skill.sourceId && item.relativePath === base + resource);
      const resourcePath = skill.path.replace(/[^/]+$/, "") + resource;
      if (!linked || selected.length >= 8 || selected.some(item => item.sourceId === linked.sourceId && item.path === resourcePath)) continue;
      const chunk = chunkReferenceText(linked.text).map(chunk => {
        const haystack = normalizeKnowledgeSearchText(chunk.text);
        return { chunk, score: [...primary, ...secondary].reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) };
      }).sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start)[0]?.chunk;
      if (chunk) selected.push({ ...skill, id: `${linked.id}:${chunk.start}`, kind: "document", mode: "reference", path: resourcePath,
        title: linked.title, hash: linked.hash, text: chunk.text, startLine: chunk.start, endLine: chunk.end, reason: "選択Skillの関連資料" });
    }
  }
  return selected;
}

export function chunkReferenceText(text: string): { text: string; start: number; end: number }[] {
  const lines = text.split("\n");
  const chunks: { text: string; start: number; end: number }[] = [];
  let current: string[] = [], start = 1, chars = 0;
  let fence: { marker: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (current.length && !fence && ((/^#{1,6}\s/.test(line) && chars > 500) || chars + line.length > 2400)) {
      chunks.push({ text: current.join("\n"), start, end: i }); current = []; chars = 0; start = i + 1;
    }
    current.push(line); chars += line.length + 1;
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
    }
  }
  if (current.join("\n").trim()) chunks.push({ text: current.join("\n"), start, end: lines.length });
  return chunks;
}
