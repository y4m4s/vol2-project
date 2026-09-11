import assert from "node:assert/strict";
import test from "node:test";
import { assembleConversationMemory, validateMemorySummary, filterConversationSources } from "../src/services/ConversationMemory";
import type { ConversationEntry } from "../src/shared/types";

const entries: ConversationEntry[] = Array.from({ length: 40 }, (_, i) => ({
  id: String(i), role: i % 2 ? "assistant" : "user", text: i % 2 ? "提案です。".repeat(100) : `条件${i}: 削除しない`,
  createdAt: "2026-09-11", kind: "manual", providerId: "copilot"
}));
test("preserves original user requirements and recent conversation within budget", () => {
  const memory = assembleConversationMemory(entries, "orcaRouter", 6000);
  for (const entry of entries.filter(e => e.role === "user")) assert.ok(memory.text.includes(entry.text));
  assert.ok(memory.text.includes('"id":"39"'));
  assert.ok(memory.text.length <= 6000);
});
test("does not silently truncate mandatory user requirements", () => {
  assert.throws(() => assembleConversationMemory(entries, "orcaRouter", 20));
});
test("local-only and excluded entries do not leak to clouds or summaries", () => {
  const privateEntries: ConversationEntry[] = [
    { ...entries[0], transmissionClass: "localOnly", text: "private-value" },
    { ...entries[1], transmissionClass: "excluded", text: "excluded-value" }
  ];
  assert.throws(() => assembleConversationMemory(privateEntries, "orcaRouter", 5000));
  const local = assembleConversationMemory(privateEntries, "ollama", 5000);
  assert.ok(local.text.includes("private-value"));
  assert.ok(!local.text.includes("excluded-value"));
});
test("summary validation rejects invented ids and preserves source text", () => {
  assert.equal(validateMemorySummary([{ text: "new", sourceEntryIds: ["missing"] }], entries), undefined);
  assert.deepEqual(validateMemorySummary([{ text: "提案", sourceEntryIds: ["1"] }], entries), [{ text: "提案", sourceEntryIds: ["1"] }]);
  assert.equal(entries[0].text, "条件0: 削除しない");
});

test("newly excluded files invalidate historical messages and derived summaries", () => {
  const sources = [{ ...entries[0], basedOn: { activeFilePath: "config/secret.env", diagnosticsSummary: [] }, text: "secret-value" }, entries[1]];
  const filtered = filterConversationSources(sources, ["**/*.env"]);
  assert.equal(filtered[0].transmissionClass, "excluded");
  assert.equal(validateMemorySummary([{ text: "secret-value", sourceEntryIds: ["0"] }], filtered), undefined);
  assert.ok(!assembleConversationMemory(filtered, "copilot", 6000).text.includes("secret-value"));
});
