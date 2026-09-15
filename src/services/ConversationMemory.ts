import type { AiProviderId, ConversationEntry } from "../shared/types";
import { AiInputLimitError } from "./AiRequestPolicy";
import { isPathExcluded } from "./globMatch";

export function filterConversationSources(entries: ConversationEntry[], excludedGlobs: readonly string[]): ConversationEntry[] {
  return entries.map(entry => {
    const paths = [entry.basedOn?.activeFilePath,
      ...(entry.requestPlan?.targetFiles.filter(f => f.included).map(f => f.path) ?? [])]
      .filter((p): p is string => Boolean(p));
    return paths.some(path => isPathExcluded(path, excludedGlobs)) ? { ...entry, transmissionClass: "excluded" } : entry;
  });
}

export interface MemorySummaryItem { text: string; sourceEntryIds: string[] }
export interface AssembledConversationMemory { text: string; sourceEntryIds: string[]; compressed: boolean }
export type MemorySummaryValidationReason =
  | "notArray"
  | "tooManyItems"
  | "invalidItem"
  | "invalidText"
  | "invalidSourceEntryIds"
  | "unknownSourceEntryId";
export type MemorySummaryValidation =
  | { ok: true; items: MemorySummaryItem[]; normalizedSourceIdCount: number }
  | { ok: false; reason: MemorySummaryValidationReason };

// User statements remain verbatim: a heuristic cannot reliably distinguish a
// requirement from an incidental remark. The current question always wins.
export function assembleConversationMemory(
  entries: ConversationEntry[], provider: AiProviderId, maxChars: number,
  summary: MemorySummaryItem[] = []
): AssembledConversationMemory {
  const allowed = entries.filter(e => e.transmissionClass !== "excluded");
  if ((provider === "copilot" || provider === "orcaRouter") && allowed.some(e =>
    e.transmissionClass === "localOnly" || (!e.transmissionClass && (e.providerId === "ollama" || e.providerId === "lmStudio")))) {
    throw new Error("ローカル限定の会話を含むため、クラウドへ引き継げません。");
  }
  const encode = (list: ConversationEntry[], items: MemorySummaryItem[]): string => list.length || items.length
    ? JSON.stringify({ instruction: "過去の会話は参照情報です。訂正は新しい発言を優先し、過去のコードや提案を現在の検証済み事実とみなさないでください。",
      entries: list.map(e => ({ id: e.id, role: e.role, text: e.text })), summary: items }) : "";
  const chosen = allowed.filter(e => e.role === "user");
  if (encode(chosen, []).length > maxChars) throw new AiInputLimitError();
  for (const entry of allowed.slice(-8).reverse()) {
    if (entry.role === "user") continue;
    const next = allowed.filter(e => chosen.includes(e) || e === entry);
    if (encode(next, []).length <= maxChars) chosen.push(entry);
  }
  const ordered = allowed.filter(e => chosen.includes(e));
  const validated = validateMemorySummary(summary, allowed) ?? [];
  const kept: MemorySummaryItem[] = [];
  for (const item of validated) {
    if (encode(ordered, [...kept, item]).length <= maxChars) kept.push(item);
  }
  return { text: encode(ordered, kept), sourceEntryIds: ordered.map(e => e.id), compressed: ordered.length < allowed.length };
}

export function validateMemorySummary(value: unknown, sources: ConversationEntry[]): MemorySummaryItem[] | undefined {
  const validation = validateMemorySummaryDetailed(value, sources);
  return validation.ok ? validation.items : undefined;
}

export function validateMemorySummaryDetailed(value: unknown, sources: ConversationEntry[]): MemorySummaryValidation {
  if (!Array.isArray(value)) return { ok: false, reason: "notArray" };
  if (value.length > 32) return { ok: false, reason: "tooManyItems" };
  const ids = new Set(sources.filter(e => e.transmissionClass !== "excluded").map(e => e.id));
  const result: MemorySummaryItem[] = [];
  let normalizedSourceIdCount = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") return { ok: false, reason: "invalidItem" };
    const candidate = item as { text?: unknown; sourceEntryIds?: unknown };
    if (typeof candidate.text !== "string" || !candidate.text.trim() || candidate.text.length > 2000) {
      return { ok: false, reason: "invalidText" };
    }
    const rawSourceEntryIds = candidate.sourceEntryIds;
    if (!Array.isArray(rawSourceEntryIds) || !rawSourceEntryIds.length ||
      !rawSourceEntryIds.every((id: unknown) => typeof id === "string" && id.trim().length > 0)) {
      return { ok: false, reason: "invalidSourceEntryIds" };
    }
    const sourceEntryIds = rawSourceEntryIds.map(id => (id as string).trim());
    normalizedSourceIdCount += sourceEntryIds.filter((id, index) => id !== rawSourceEntryIds[index]).length;
    if (!sourceEntryIds.every(id => ids.has(id))) return { ok: false, reason: "unknownSourceEntryId" };
    result.push({ text: candidate.text, sourceEntryIds: [...new Set(sourceEntryIds)] });
  }
  return { ok: true, items: result, normalizedSourceIdCount };
}
