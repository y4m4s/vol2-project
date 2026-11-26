import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Module from "node:module";
import type { GuidanceContext } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {} : originalLoad(id, parent, isMain);
const { KnowledgeStore } = require("../src/services/KnowledgeStore") as typeof import("../src/services/KnowledgeStore");
loader._load = originalLoad;

const context: GuidanceContext = { activeFileLanguage: "typescript", referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] };
async function setup(t: TestContext) {
  const SQL = await require("sql.js")();
  const db = new SQL.Database();
  db.run(`CREATE TABLE knowledge (id TEXT PRIMARY KEY, title TEXT, summary TEXT, body TEXT, status TEXT,
    source_advice_id TEXT, provider_id TEXT, model_id TEXT, model_label TEXT, created_at TEXT, updated_at TEXT);`);
  const store = new KnowledgeStore({} as never);
  Object.assign(store, { db, persist: async () => {} });
  (store as unknown as { migrate(): void }).migrate();
  t.after(() => store.dispose());
  return { store, db };
}

test("knowledge retains reference provenance through storage, editing and approval", async t => {
  const { store } = await setup(t);
  const record = await store.create({ title: "TypeScript", summary: "lesson", body: "body", requiresReview: true, referenceSourceIds: ["source", "source"] });
  assert.deepEqual(store.get(record.id)?.referenceSourceIds, ["source"]);
  await store.update(record.id, { title: "TypeScript revised", summary: "lesson", body: "edited" });
  await store.approve(record.id);
  assert.deepEqual(store.get(record.id)?.referenceSourceIds, ["source"]);
  assert.deepEqual(store.findReusable(context), [], "reference-backed knowledge requires an explicit current policy");
  let permitted = true;
  assert.equal(store.findReusable(context, 3, record => !record.referenceSourceIds?.length || permitted).length, 1);
  permitted = false;
  assert.equal(store.findReusable(context, 3, record => !record.referenceSourceIds?.length || permitted).length, 0);
});

test("legacy knowledge adopts provenance from its saved source answer", async t => {
  const { store } = await setup(t);
  const record = await store.create({ title: "TypeScript", summary: "lesson", body: "body", sourceAdviceId: "answer" });
  assert.equal(store.findReusable(context).length, 1);
  await store.backfillReferenceSources(id => id === "answer" ? ["source"] : []);
  assert.deepEqual(store.get(record.id)?.referenceSourceIds, ["source"]);
  assert.equal(store.findReusable(context).length, 0);
});

test("malformed provenance is never treated as unrestricted legacy knowledge", async t => {
  const { store, db } = await setup(t);
  const record = await store.create({ title: "TypeScript", summary: "lesson", body: "body" });
  db.run("UPDATE knowledge SET reference_sources_json = ? WHERE id = ?", ["{broken", record.id]);
  assert.ok(store.get(record.id)?.referenceSourceIds?.length);
  assert.equal(store.findReusable(context).length, 0);
  await assert.rejects(store.create({ title: "bad", summary: "bad", body: "bad", referenceSourceIds: [""] }));
});
