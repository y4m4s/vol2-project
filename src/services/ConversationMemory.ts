import type { AiProviderId, ConversationEntry } from "../shared/types";
import { AiInputLimitError } from "./AiRequestPolicy";
import { isPathExcluded } from "./globMatch";

export function filterConversationSources(entries: ConversationEntry[], excludedGlobs: readonly string[]): ConversationEntry[] {
  return entries.map(entry => {
    const paths = [entry.basedOn?.activeFilePath, ...(entry.requestPlan?.targetFiles.map(f => f.path) ?? [])].filter((p): p is string => Boolean(p));
    return paths.some(path => isPathExcluded(path, excludedGlobs)) ? { ...entry, transmissionClass: "excluded" } : entry;
  });
}

export interface MemorySummaryItem { text: string; sourceEntryIds: string[] }
export interface AssembledConversationMemory { text: string; sourceEntryIds: string[]; compressed: boolean }

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
  if (!Array.isArray(value) || value.length > 32) return undefined;
  const ids = new Set(sources.filter(e => e.transmissionClass !== "excluded").map(e => e.id));
  const result: MemorySummaryItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text.trim() || item.text.length > 2000 ||
      !Array.isArray(item.sourceEntryIds) || !item.sourceEntryIds.length || !item.sourceEntryIds.every((id: unknown) => typeof id === "string" && ids.has(id))) return undefined;
    result.push({ text: item.text, sourceEntryIds: [...new Set<string>(item.sourceEntryIds)] });
  }
  return result;
}
