import assert from "node:assert/strict";
import test from "node:test";
import { boundReferenceCatalog, parseReferenceSearchRequest } from "../src/services/ReferenceRetrieval";

const catalog = [{ id: "allowed", path: "docs/guide.md", title: "Guide" }];

test("retrieval accepts only bounded queries and catalog IDs, never arbitrary file paths", () => {
  assert.deepEqual(parseReferenceSearchRequest('```json\n{"queries":["retry","retry"],"documentIds":["allowed"]}\n```', catalog),
    { queries: ["retry"], documentIds: ["allowed"] });
  for (const value of [
    { queries: [], documentIds: ["../../secret"] },
    { queries: ["a", "b", "c", "d"], documentIds: [] },
    { queries: ["x".repeat(201)], documentIds: [] },
    { queries: [1], documentIds: [] }, { queries: [], documentIds: null }
  ]) assert.equal(parseReferenceSearchRequest(JSON.stringify(value), catalog), undefined);
  assert.equal(parseReferenceSearchRequest("not JSON", catalog), undefined);
});

test("catalog budgets include JSON overhead and skip entries that do not fit", () => {
  const result = boundReferenceCatalog([{ id: "huge", path: "x".repeat(2000), title: "Huge" }, ...catalog], 150);
  assert.deepEqual(result.map(item => item.id), ["allowed"]);
  assert.ok(JSON.stringify(result).length <= 150);
});
