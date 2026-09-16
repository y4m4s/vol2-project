import assert from "node:assert/strict";
import test from "node:test";
import {
  compactMemory,
  MemoryCompactionOutputLimitError,
  MemoryCompactionTimeoutError
} from "../src/services/MemoryCompactor";
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
test("an explicit compaction can lower the automatic eight-entry threshold without removing the recent eight", async () => {
  const short = entries.slice(0, 9);
  let calls = 0;
  const result = await compactMemory(short, undefined, async input => {
    calls++;
    assert.ok(input.includes('"id":"0"'));
    assert.ok(!input.includes('"id":"1"'));
    return '[{"text":"最初の要件","sourceEntryIds":["0"]}]';
  }, () => {}, { minimumNewEntries: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(result?.sourceIds, ["0"]);
});
test("an explicit verification can recompact a previously covered range", async () => {
  const short = entries.slice(0, 9);
  let calls = 0;
  const result = await compactMemory(short, {
    sourceIds: ["0"],
    items: [{ text: "以前の要約", sourceEntryIds: ["0"] }]
  }, async () => {
    calls++;
    return '[{"text":"再検証した要約","sourceEntryIds":["0"]}]';
  }, () => {}, { minimumNewEntries: 1, recompactExisting: true });
  assert.equal(calls, 1);
  assert.deepEqual(result?.items, [{ text: "再検証した要約", sourceEntryIds: ["0"] }]);
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

test("a compaction timeout is distinguished from an ordinary request failure", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  assert.equal(await compactMemory(entries, undefined, async () => {
    throw new MemoryCompactionTimeoutError(120000);
  }, event => diagnostics.push(event)), undefined);
  assert.equal(diagnostics.at(-1)?.reason, "timeout");
  assert.equal(diagnostics.at(-1)?.timeoutMs, 120000);
  assert.equal(typeof diagnostics.at(-1)?.elapsedMs, "number");
});

test("an exhausted output limit is reported without accepting partial JSON", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  assert.equal(await compactMemory(entries, undefined, async () => {
    throw new MemoryCompactionOutputLimitError();
  }, event => diagnostics.push(event)), undefined);
  assert.equal(diagnostics.at(-1)?.reason, "outputLimit");
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
