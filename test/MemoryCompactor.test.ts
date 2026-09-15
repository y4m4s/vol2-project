import assert from "node:assert/strict";
import test from "node:test";
import { compactMemory } from "../src/services/MemoryCompactor";
import type { ConversationEntry } from "../src/shared/types";
const entries: ConversationEntry[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", text: "試行と決定の記録".repeat(100), createdAt: "now", kind: "manual", transmissionClass: "cloudAllowed" }));
test("short history and unchanged source range do not call LLM", async () => {
  let calls = 0;
  const diagnostics: Array<Record<string, unknown>> = [];
  const run = async () => { calls++; return "[]"; };
  assert.equal(await compactMemory(entries.slice(0, 4), undefined, run, event => diagnostics.push(event)), undefined);
  assert.equal(await compactMemory(entries, { sourceIds: entries.slice(0, -8).map(e => e.id), items: [] }, run), undefined);
  assert.equal(calls, 0);
  assert.equal(diagnostics.at(-1)?.event, "memory_compaction_skipped");
  assert.equal(diagnostics.at(-1)?.reason, "notEnoughNewEntries");
});
test("malformed summary retains previous memory; valid summary references real sources", async () => {
  assert.equal(await compactMemory(entries, undefined, async () => '[{"text":"bad","sourceEntryIds":["unknown"]}]'), undefined);
  const result = await compactMemory(entries, undefined, async () => '[{"text":"決定","sourceEntryIds":["1"]}]');
  assert.ok(result?.sourceIds.includes("1"));
  assert.deepEqual(result?.items, [{ text: "決定", sourceEntryIds: ["1"] }]);
});
test("a single Markdown JSON fence and source id whitespace are normalized before validation", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const result = await compactMemory(entries, undefined,
    async () => '```json\n[{"text":"決定","sourceEntryIds":[" 1 "]}]\n```',
    event => diagnostics.push(event));
  assert.deepEqual(result?.items, [{ text: "決定", sourceEntryIds: ["1"] }]);
  assert.deepEqual(diagnostics.map(event => event.event), [
    "memory_compaction_started",
    "memory_compaction_response_accepted"
  ]);
  assert.equal(diagnostics[1].responseFormat, "markdownJsonFence");
  assert.equal(diagnostics[1].normalizedSourceIdCount, 1);
});
test("invalid compaction output reports a reason without logging its body", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  assert.equal(await compactMemory(entries, undefined,
    async () => '説明です。\n```json\n[]\n```', event => diagnostics.push(event)), undefined);
  assert.equal(diagnostics.at(-1)?.event, "memory_compaction_response_rejected");
  assert.equal(diagnostics.at(-1)?.reason, "extraTextAroundJsonFence");
  assert.equal("response" in (diagnostics.at(-1) ?? {}), false);

  diagnostics.length = 0;
  assert.equal(await compactMemory(entries, undefined,
    async () => '[{"text":"bad","sourceEntryIds":["unknown"]}]', event => diagnostics.push(event)), undefined);
  assert.equal(diagnostics.at(-1)?.reason, "unknownSourceEntryId");
});
test("LLM failure is recoverable and excluded entries never enter compression input", async () => {
  assert.equal(await compactMemory(entries, undefined, async () => { throw new Error("offline"); }), undefined);
  await compactMemory([{ ...entries[0], text: "excluded-secret", transmissionClass: "excluded" }, ...entries.slice(1)], undefined, async text => {
    assert.ok(!text.includes("excluded-secret")); return "[]";
  });
});

test("an oversized entry does not block later entries from being compacted", async () => {
  const input = [{ ...entries[0], text: "x".repeat(16001) }, ...entries.slice(1)];
  let request = "";
  const result = await compactMemory(input, undefined, async text => {
    request = text;
    return '[{"text":"後続の決定","sourceEntryIds":["1"]}]';
  });
  assert.ok(result);
  assert.ok(!request.includes("x".repeat(100)));
  assert.ok(request.includes('"id":"1"'));
  assert.ok(!result.sourceIds.includes("0"));
  assert.ok(result.sourceIds.includes("1"));
});
