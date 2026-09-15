import type { ConversationEntry } from "../shared/types";
import { validateMemorySummaryDetailed, type MemorySummaryItem, type MemorySummaryValidationReason } from "./ConversationMemory";

export interface StoredMemory { sourceIds: string[]; items: MemorySummaryItem[] }
type MemoryCompactionResponseFailureReason =
  | "emptyResponse"
  | "extraTextAroundJsonFence"
  | "invalidMarkdownJsonFence"
  | "malformedJson";
export type MemoryCompactionDiagnostic =
  | { event: "memory_compaction_skipped"; reason: "notEnoughNewEntries" | "noEligibleEntries";
    newEntryCount: number; requiredEntryCount: number }
  | { event: "memory_compaction_started"; sourceEntryCount: number; previousSourceCount: number }
  | { event: "memory_compaction_response_rejected"; reason: "requestFailed" | MemoryCompactionResponseFailureReason | MemorySummaryValidationReason;
    responseChars?: number; responseFormat?: "plainJson" | "markdownJsonFence"; errorName?: string }
  | { event: "memory_compaction_response_accepted"; responseChars: number; responseFormat: "plainJson" | "markdownJsonFence";
    summaryItemCount: number; normalizedSourceIdCount: number };

export async function compactMemory(
  entries: ConversationEntry[], previous: StoredMemory | undefined, request: (input: string) => Promise<string>,
  diagnostic: (event: MemoryCompactionDiagnostic) => void = () => {}
): Promise<StoredMemory | undefined> {
  const older = entries.slice(0, -8).filter(e => e.transmissionClass !== "excluded");
  const newEntries = older.filter(e => !previous?.sourceIds.includes(e.id));
  if (newEntries.length < 8) {
    emitDiagnostic(diagnostic, { event: "memory_compaction_skipped", reason: "notEnoughNewEntries",
      newEntryCount: newEntries.length, requiredEntryCount: 8 });
    return undefined;
  }
  const selected: ConversationEntry[] = [];
  let chars = 0;
  for (const entry of newEntries) {
    // 単独で上限を超える発言があっても、後続の短い発言の圧縮を妨げない。
    if (entry.text.length > 16000) continue;
    if (chars + entry.text.length > 16000) break;
    selected.push(entry); chars += entry.text.length;
  }
  if (!selected.length) {
    emitDiagnostic(diagnostic, { event: "memory_compaction_skipped", reason: "noEligibleEntries",
      newEntryCount: newEntries.length, requiredEntryCount: 8 });
    return undefined;
  }
  emitDiagnostic(diagnostic, { event: "memory_compaction_started", sourceEntryCount: selected.length,
    previousSourceCount: previous?.sourceIds.length ?? 0 });
  let response: string;
  try {
    response = await request(JSON.stringify({ previous: previous?.items ?? [],
      entries: selected.map(e => ({ id: e.id, role: e.role, text: e.text })) }));
  } catch (error) {
    emitDiagnostic(diagnostic, { event: "memory_compaction_response_rejected", reason: "requestFailed",
      errorName: error instanceof Error ? error.name : "unknown" });
    return undefined;
  }

  const normalized = normalizeMemorySummaryResponse(response);
  if (!normalized.ok) {
    emitDiagnostic(diagnostic, { event: "memory_compaction_response_rejected", reason: normalized.reason,
      responseChars: response.length });
    return undefined;
  }
  const validation = validateMemorySummaryDetailed(normalized.value,
    entries.filter(e => selected.some(s => s.id === e.id) || previous?.sourceIds.includes(e.id)));
  if (!validation.ok) {
    emitDiagnostic(diagnostic, { event: "memory_compaction_response_rejected", reason: validation.reason,
      responseChars: response.length, responseFormat: normalized.format });
    return undefined;
  }
  emitDiagnostic(diagnostic, { event: "memory_compaction_response_accepted", responseChars: response.length,
    responseFormat: normalized.format, summaryItemCount: validation.items.length,
    normalizedSourceIdCount: validation.normalizedSourceIdCount });
  return { sourceIds: [...new Set([...(previous?.sourceIds ?? []), ...selected.map(e => e.id)])], items: validation.items };
}

function normalizeMemorySummaryResponse(response: string):
  | { ok: true; value: unknown; format: "plainJson" | "markdownJsonFence" }
  | { ok: false; reason: MemoryCompactionResponseFailureReason } {
  const trimmed = response.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return { ok: false, reason: "emptyResponse" };
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const json = fenced ? fenced[1].trim() : trimmed;
  if (!fenced && trimmed.includes("```")) {
    return { ok: false, reason: trimmed.startsWith("```") ? "invalidMarkdownJsonFence" : "extraTextAroundJsonFence" };
  }
  try {
    return { ok: true, value: JSON.parse(json), format: fenced ? "markdownJsonFence" : "plainJson" };
  } catch {
    return { ok: false, reason: "malformedJson" };
  }
}

function emitDiagnostic(
  diagnostic: (event: MemoryCompactionDiagnostic) => void,
  event: MemoryCompactionDiagnostic
): void {
  try { diagnostic(event); } catch { /* Diagnostics must never affect compaction. */ }
}
