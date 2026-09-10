import assert from "node:assert/strict";
import test from "node:test";
import { RequestPlanner } from "../src/services/RequestPlanner";
import type { GuidanceContext, NavigatorSettings } from "../src/shared/types";

const settings: NavigatorSettings = {
  providerId: "copilot",
  defaultMode: "manual",
  defaultAssistanceDepth: "low",
  lmStudioBaseUrl: "http://127.0.0.1:1234",
  orcaRouterModelId: "orcarouter/free",
  requestIntervalMs: 60_000,
  idleDelayMs: 10_000,
  dailyTokenLimit: 100_000,
  protectedExcludedGlobs: ["**/.env"],
  excludedGlobs: []
};

test("Ollama低でも高と同じ文脈を保持し、送信計画の表示は低を維持する", () => {
  const planner = new RequestPlanner();
  const context = createContext();
  context.activeFileExcerpt = "x".repeat(4000);
  const preview = { diagnosticsSummary: [] };
  const low = planner.prepareGuidanceRequest(context, preview, { ...settings, providerId: "ollama" }, "always", "low");
  const high = planner.prepareGuidanceRequest(context, preview, { ...settings, providerId: "ollama" }, "always", "high");
  assert.deepEqual(low.context, high.context);
  assert.equal(low.context.activeFileExcerpt?.length, 4000);
  assert.equal(low.context.referencedFiles.length, 1);
  assert.equal(low.requestPlan.assistanceDepth, "low");
});

function createContext(): GuidanceContext {
  return {
    activeFilePath: "C:/workspace/src/app.ts",
    activeFileLanguage: "typescript",
    activeFileExcerpt: "const answer = 42;",
    referencedFiles: [{
      path: "C:/workspace/src/helper.ts",
      languageId: "typescript",
      reason: "sameDirectory",
      excerpt: "export const helper = true;",
      diagnosticsSummary: [],
      recentEditsSummary: [],
      score: 45
    }],
    workspaceTree: { rootPath: "C:/workspace", treeText: "src/\n  app.ts", truncated: false },
    diagnosticsSummary: [],
    recentEditsSummary: [],
    relatedSymbols: []
  };
}

test("推論強度が低なら関連ファイルを落とし、高なら保持する", () => {
  const planner = new RequestPlanner();
  const low = planner.prepareGuidanceRequest(createContext(), { diagnosticsSummary: [] }, settings, "manual", "low");
  const high = planner.prepareGuidanceRequest(createContext(), { diagnosticsSummary: [] }, settings, "manual", "high");

  assert.equal(low.context.workspaceTree, undefined);
  assert.deepEqual(low.context.referencedFiles, []);
  assert.equal(high.context.workspaceTree?.treeText, "src/\n  app.ts");
  assert.equal(high.context.referencedFiles.length, 1);
  const historyCategory = high.requestPlan.categories.find((category) => category.key === "conversationHistory");
  assert.deepEqual(historyCategory && {
    enabled: historyCategory.enabled,
    included: historyCategory.included,
    note: historyCategory.note
  }, {
    enabled: false,
    included: false,
    note: "コンテキスト増大を防ぐためAIへ自動送信しません"
  });
});

test("全接続先の常時モードでも強度に応じた文脈と保存用プランを作成する", () => {
  const planner = new RequestPlanner();
  for (const providerId of ["copilot", "orcaRouter", "lmStudio"] as const) {
    for (const depth of ["low", "high"] as const) {
      const prepared = planner.prepareGuidanceRequest(createContext(), { diagnosticsSummary: [] },
        { ...settings, providerId }, "always", depth);
      assert.equal(prepared.requestPlan.assistanceDepth, depth);
      assert.equal(prepared.context.referencedFiles.length, depth === "high" ? 1 : 0);
      assert.equal(Boolean(prepared.context.workspaceTree), depth === "high");
    }
  }
  const fallback = planner.prepareGuidanceRequest(createContext(), { diagnosticsSummary: [] }, settings, "always");
  assert.equal(fallback.requestPlan.assistanceDepth, "low");
});

test("保護済みglobに一致するファイル本文と選択範囲を送信しない", () => {
  const planner = new RequestPlanner();
  const context = createContext();
  context.activeFilePath = "C:/workspace/.env";
  context.activeFileExcerpt = "SECRET=value";
  context.selectedText = "SECRET=value";

  const prepared = planner.prepareGuidanceRequest(context, { diagnosticsSummary: [] }, settings, "context", "low");

  assert.equal(prepared.context.activeFileExcerpt, undefined);
  assert.equal(prepared.context.selectedText, undefined);
  assert.equal(prepared.requestPlan.targetFiles[0].included, false);
  assert.match(prepared.requestPlan.targetFiles[0].excludedReason ?? "", /除外 glob/);
});
