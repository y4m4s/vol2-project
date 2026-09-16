import type { ConversationEntry } from "../shared/types";
import { validateMemorySummaryDetailed, type MemorySummaryItem, type MemorySummaryValidationReason } from "./ConversationMemory";

export interface StoredMemory { sourceIds: string[]; items: MemorySummaryItem[] }
export interface MemoryCompactionOptions {
  minimumNewEntries?: number;
  recompactExisting?: boolean;
}
export class MemoryCompactionTimeoutError extends Error {
  public readonly name = "MemoryCompactionTimeoutError";

  public constructor(public readonly timeoutMs: number) {
    super("Memory compaction timed out");
  }
}
export class MemoryCompactionOutputLimitError extends Error {
  public readonly name = "MemoryCompactionOutputLimitError";

  public constructor() {
    super("Memory compaction reached the output limit");
  }
}
type MemoryCompactionResponseFailureReason =
  | "emptyResponse"
  | "extraTextAroundJsonFence"
  | "invalidMarkdownJsonFence"
  | "malformedJson";
export type MemoryCompactionDiagnostic =
  | { event: "memory_compaction_skipped"; reason: "notEnoughNewEntries" | "noEligibleEntries";
    newEntryCount: number; requiredEntryCount: number }
  | { event: "memory_compaction_started"; sourceEntryCount: number; previousSourceCount: number }
  | { event: "memory_compaction_response_rejected"; reason: "requestFailed" | "timeout" | "outputLimit" | MemoryCompactionResponseFailureReason | MemorySummaryValidationReason;
    responseChars?: number; responseFormat?: "plainJson" | "markdownJsonFence"; errorName?: string;
    timeoutMs?: number; elapsedMs?: number }
  | { event: "memory_compaction_response_accepted"; responseChars: number; responseFormat: "plainJson" | "markdownJsonFence";
    summaryItemCount: number; normalizedSourceIdCount: number };

export async function compactMemory(
  entries: ConversationEntry[], previous: StoredMemory | undefined, request: (input: string) => Promise<string>,
  diagnostic: (event: MemoryCompactionDiagnostic) => void = () => {},
  options: MemoryCompactionOptions = {}
): Promise<StoredMemory | undefined> {
  const requestedMinimum = options.minimumNewEntries;
  const minimumNewEntries = typeof requestedMinimum === "number" && Number.isFinite(requestedMinimum)
    ? Math.max(1, Math.floor(requestedMinimum))
    : 8;
  const older = entries.slice(0, -8).filter(e => e.transmissionClass !== "excluded");
  const newEntries = options.recompactExisting
    ? older
    : older.filter(e => !previous?.sourceIds.includes(e.id));
  if (newEntries.length < minimumNewEntries) {
    emitDiagnostic(diagnostic, { event: "memory_compaction_skipped", reason: "notEnoughNewEntries",
      newEntryCount: newEntries.length, requiredEntryCount: minimumNewEntries });
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
      newEntryCount: newEntries.length, requiredEntryCount: minimumNewEntries });
    return undefined;
  }
  emitDiagnostic(diagnostic, { event: "memory_compaction_started", sourceEntryCount: selected.length,
    previousSourceCount: previous?.sourceIds.length ?? 0 });
  let response: string;
  const requestStartedAt = Date.now();
  try {
    response = await request(JSON.stringify({ previous: previous?.items ?? [],
      entries: selected.map(e => ({ id: e.id, role: e.role, text: e.text })) }));
  } catch (error) {
    const timeout = error instanceof MemoryCompactionTimeoutError;
    const outputLimit = error instanceof MemoryCompactionOutputLimitError;
    emitDiagnostic(diagnostic, { event: "memory_compaction_response_rejected",
      reason: timeout ? "timeout" : outputLimit ? "outputLimit" : "requestFailed",
      errorName: error instanceof Error ? error.name : "unknown", elapsedMs: Date.now() - requestStartedAt,
      ...(timeout ? { timeoutMs: error.timeoutMs } : {}) });
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
