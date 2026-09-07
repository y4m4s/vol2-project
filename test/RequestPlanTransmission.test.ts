import assert from "node:assert/strict";
import test from "node:test";
import { RequestPlanner } from "../src/services/RequestPlanner";
import { reconcileRequestPlan } from "../src/services/RequestPlanTransmission";
import { buildGuidancePrompt } from "../src/services/PromptBuilder";
import type { GuidanceContext, NavigatorSettings } from "../src/shared/types";

const settings = { excludedGlobs: [], protectedExcludedGlobs: [] } as unknown as NavigatorSettings;
function context(): GuidanceContext {
  return {
    activeFilePath: "app.ts", activeFileExcerpt: "UNSELECTED_FILE_BODY", selectedText: "SELECTED_CODE",
    referencedFiles: [{ path: "other.ts", reason: "sameDirectory", excerpt: "RELATED_BODY", diagnosticsSummary: [], recentEditsSummary: [], score: 1 }],
    diagnosticsSummary: [{ severity: "Error", line: 1, message: "DIAGNOSTIC_MARKER" }],
    recentEditsSummary: [], relatedSymbols: []
  };
}

test("選択範囲優先時は送られないファイル本文のチェックを外す", () => {
  const prepared = new RequestPlanner().prepareGuidanceRequest(context(), { diagnosticsSummary: [] }, settings, "context", "high");
  const input = { ...prepared.requestPlan, context: prepared.context };
  const plan = reconcileRequestPlan(prepared.requestPlan, input);
  const prompt = buildGuidancePrompt(input);
  assert.ok(prompt.includes("SELECTED_CODE"));
  assert.ok(!prompt.includes("UNSELECTED_FILE_BODY"));
  assert.equal(plan.categories.find((x) => x.key === "activeFile")?.included, false);
  assert.equal(plan.categories.find((x) => x.key === "selection")?.included, true);
  assert.equal(plan.targetFiles.find((x) => x.path === "app.ts")?.included, true);
});

test("入力予算で落ちた診断・関連ファイルを送信済みと記録しない", () => {
  const raw = context();
  raw.selectedText = "x".repeat(20000);
  const prepared = new RequestPlanner().prepareGuidanceRequest(raw, { diagnosticsSummary: [] }, settings, "context", "high");
  const input = { ...prepared.requestPlan, context: prepared.context, modelProfile: { delimiter: "xml" as const, contextBudget: 1500, terse: true } };
  const plan = reconcileRequestPlan(prepared.requestPlan, input);
  const prompt = buildGuidancePrompt(input);
  assert.ok(!prompt.includes("DIAGNOSTIC_MARKER"));
  assert.ok(!prompt.includes("RELATED_BODY"));
  assert.equal(plan.categories.find((x) => x.key === "diagnostics")?.included, false);
  assert.equal(plan.targetFiles.find((x) => x.path === "other.ts")?.included, false);
  const blocked = reconcileRequestPlan(prepared.requestPlan, { ...input, userPrompt: "q".repeat(20000) });
  assert.ok(blocked.categories.every((x) => !x.included));
  assert.ok(blocked.targetFiles.every((x) => !x.included));
});

test("再利用ナレッジと評価傾向も実際に送る場合だけチェックする", () => {
  const prepared = new RequestPlanner().prepareGuidanceRequest(context(), { diagnosticsSummary: [] }, settings, "manual", "high");
  const input = { ...prepared.requestPlan, context: prepared.context,
    knowledgeItems: [{ title: "lesson", summary: "summary" }],
    feedbackTendency: { goodPatterns: ["specific"], badAvoidPatterns: [] } };
  const plan = reconcileRequestPlan(prepared.requestPlan, input);
  assert.equal(plan.categories.find((x) => x.key === "knowledge")?.included, true);
  assert.equal(plan.categories.find((x) => x.key === "feedback")?.included, true);
  const auto = reconcileRequestPlan(prepared.requestPlan, { ...input, kind: "always" });
  assert.equal(auto.categories.find((x) => x.key === "feedback")?.included, false);
});
