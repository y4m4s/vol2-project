import type { ConversationEntry } from "../shared/types";
import { validateMemorySummary, type MemorySummaryItem } from "./ConversationMemory";

export interface StoredMemory { sourceIds: string[]; items: MemorySummaryItem[] }
export async function compactMemory(
  entries: ConversationEntry[], previous: StoredMemory | undefined, request: (input: string) => Promise<string>
): Promise<StoredMemory | undefined> {
  const older = entries.slice(0, -8).filter(e => e.transmissionClass !== "excluded");
  const newEntries = older.filter(e => !previous?.sourceIds.includes(e.id));
  if (newEntries.length < 8) return undefined;
  const selected: ConversationEntry[] = [];
  let chars = 0;
  for (const entry of newEntries) {
    if (chars + entry.text.length > 16000) break;
    selected.push(entry); chars += entry.text.length;
  }
  if (!selected.length) return undefined;
  try {
    const value: unknown = JSON.parse(await request(JSON.stringify({ previous: previous?.items ?? [],
      entries: selected.map(e => ({ id: e.id, role: e.role, text: e.text })) })));
    const items = validateMemorySummary(value, entries.filter(e => selected.some(s => s.id === e.id) || previous?.sourceIds.includes(e.id)));
    return items ? { sourceIds: [...new Set([...(previous?.sourceIds ?? []), ...selected.map(e => e.id)])], items } : undefined;
  } catch { return undefined; }
}
