import assert from "node:assert/strict";
import test from "node:test";
import { boundReferenceCatalog, buildReferenceSearchEvidence, parseReferenceSearchRequest } from "../src/services/ReferenceRetrieval";
import type { GuidanceContext } from "../src/shared/types";

const catalog = [{ id: "allowed", path: "docs/guide.md", title: "Guide" }];

test("search evidence prioritizes selected code and omits paths, attachment bodies and unrelated metadata", () => {
  const context: GuidanceContext = { activeFilePath: "C:/private/work/app.ts", activeFileLanguage: "typescript", activeFileExcerpt: "UNSELECTED_CODE",
    selectedText: "SELECTED_CODE", referencedFiles: [], recentEditsSummary: [], relatedSymbols: [],
    diagnosticsSummary: [{ severity: "Error", line: 12, message: "RetryPolicy is missing" }],
    additionalContext: "TASK_TEXT" };
  const evidence = buildReferenceSearchEvidence(context, 2000)!;
  assert.equal(evidence.codeSource, "selection");
  assert.equal(evidence.code, "SELECTED_CODE");
  assert.equal(evidence.language, "typescript");
  assert.equal(evidence.diagnostics[0].message, "RetryPolicy is missing");
  assert.doesNotMatch(JSON.stringify(evidence), /private|UNSELECTED_CODE|TASK_TEXT/);
});

test("search evidence stays within its serialized budget even with heavily escaped code", () => {
  const context: GuidanceContext = { activeFileExcerpt: '\\"\n'.repeat(5000), referencedFiles: [], recentEditsSummary: [], relatedSymbols: [], diagnosticsSummary: [] };
  const evidence = buildReferenceSearchEvidence(context, 700)!;
  assert.ok(JSON.stringify(evidence).length <= 700);
  assert.ok(evidence.code.length > 100);
  assert.equal(evidence.codeTruncated, true);
  assert.equal(buildReferenceSearchEvidence(context, 10), undefined);
});

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
