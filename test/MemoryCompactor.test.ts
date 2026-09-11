import assert from "node:assert/strict";
import test from "node:test";
import { compactMemory } from "../src/services/MemoryCompactor";
import type { ConversationEntry } from "../src/shared/types";
const entries: ConversationEntry[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", text: "試行と決定の記録".repeat(100), createdAt: "now", kind: "manual", transmissionClass: "cloudAllowed" }));
test("short history and unchanged source range do not call LLM", async () => {
  let calls = 0;
  const run = async () => { calls++; return "[]"; };
  assert.equal(await compactMemory(entries.slice(0, 4), undefined, run), undefined);
  assert.equal(await compactMemory(entries, { sourceIds: entries.slice(0, -8).map(e => e.id), items: [] }, run), undefined);
  assert.equal(calls, 0);
});
test("malformed summary retains previous memory; valid summary references real sources", async () => {
  assert.equal(await compactMemory(entries, undefined, async () => '[{"text":"bad","sourceEntryIds":["unknown"]}]'), undefined);
  const result = await compactMemory(entries, undefined, async () => '[{"text":"決定","sourceEntryIds":["1"]}]');
  assert.ok(result?.sourceIds.includes("1"));
  assert.deepEqual(result?.items, [{ text: "決定", sourceEntryIds: ["1"] }]);
});
test("LLM failure is recoverable and excluded entries never enter compression input", async () => {
  assert.equal(await compactMemory(entries, undefined, async () => { throw new Error("offline"); }), undefined);
  await compactMemory([{ ...entries[0], text: "excluded-secret", transmissionClass: "excluded" }, ...entries.slice(1)], undefined, async text => {
    assert.ok(!text.includes("excluded-secret")); return "[]";
  });
});
