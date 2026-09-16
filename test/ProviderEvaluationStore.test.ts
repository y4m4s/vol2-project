import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {} : originalLoad(id, parent, isMain);
const { ProviderEvaluationStore } = require("../src/services/ProviderEvaluationStore") as typeof import("../src/services/ProviderEvaluationStore");
loader._load = originalLoad;

async function harness() {
  const sql = await require("sql.js")();
  const db = new sql.Database();
  const store = new ProviderEvaluationStore({} as never);
  Object.assign(store, { db, persist: async () => {} });
  (store as unknown as { migrate(): void }).migrate();
  return { store, db };
}

test("正常回答は学習回数とモデル用途別の実績へ1回だけ記録する", async t => {
  const h = await harness();
  t.after(() => h.store.dispose());
  const key = { providerId: "copilot" as const, modelId: "auto", taskPurpose: "implementation" as const };
  await h.store.recordSuccess(key, 1200, true);
  await h.store.recordSuccess({ ...key, modelId: "resolved/model" }, 1200, true, false);
  assert.equal(h.store.getSuccessfulResponseCount(), 1);
  assert.deepEqual(h.store.getStats(key), {
    successCount: 1, requestFailureCount: 0, formatFailureCount: 1, timeoutCount: 0,
    positiveFeedbackCount: 0, negativeFeedbackCount: 0, totalLatencyMs: 1200
  });
  assert.equal(h.store.getStats({ ...key, modelId: "resolved/model" })?.successCount, 1);
});

test("失敗種別とGood/Badの変更を本文なしで集計する", async t => {
  const h = await harness();
  t.after(() => h.store.dispose());
  const key = { providerId: "orcaRouter" as const, modelId: "orcarouter/free", taskPurpose: "review" as const };
  await h.store.recordFailure(key, true, true);
  await h.store.recordFeedback("entry-1", key, "bad");
  await h.store.recordFeedback("entry-1", key, "good");
  const stats = h.store.getStats(key)!;
  assert.equal(stats.requestFailureCount, 1);
  assert.equal(stats.timeoutCount, 1);
  assert.equal(stats.formatFailureCount, 1);
  assert.equal(stats.positiveFeedbackCount, 1);
  assert.equal(stats.negativeFeedbackCount, 0);
  const schema = h.db.exec("SELECT sql FROM sqlite_master WHERE name = 'routing_model_stats'")[0].values.join(" ");
  assert.equal(schema.includes("response_text"), false);
  assert.equal(schema.includes("question"), false);
});
