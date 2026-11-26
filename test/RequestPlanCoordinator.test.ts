import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { RequestPlanner } from "../src/services/RequestPlanner";
import { reconcileRequestPlan } from "../src/services/RequestPlanTransmission";
import type { GuidanceContext, NavigatorSessionState, NavigatorSettings } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? { workspace: { workspaceFolders: [] } } : originalLoad(id, parent, isMain);
const { RequestPlanCoordinator } = require("../src/application/coordinators/RequestPlanCoordinator") as typeof import("../src/application/coordinators/RequestPlanCoordinator");

test("Ollama previews use the actual provider content depth at an atomic reference budget boundary", () => {
  const profile = { delimiter: "xml" as const, contextBudget: 4000, terse: true };
  const context: GuidanceContext = { referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [], referenceDocuments: [{
    id: "skill:1", sourceId: "source", path: "docs/SKILL.md", title: "Skill", kind: "skill", hash: "v1", text: "", startLine: 1, endLine: 1, reason: "selected", localOnly: false, mode: "procedure"
  }] };
  const plan = { kind: "manual" as const, assistanceDepth: "low" as const, categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "" };
  let found = false;
  for (let length = 50; length < 6000; length += 10) {
    context.referenceDocuments![0].text = "x".repeat(length);
    const low = reconcileRequestPlan(plan, { ...plan, context, modelProfile: profile });
    const high = reconcileRequestPlan(plan, { ...plan, assistanceDepth: "high", context, modelProfile: profile });
    if (low.referenceDocuments?.[0].included !== high.referenceDocuments?.[0].included) { found = true; break; }
  }
  assert.ok(found, "the fixture must exercise a real low/high budget difference");
  const coordinator = new RequestPlanCoordinator({} as never, new RequestPlanner(), { getSettings: () => ({ providerId: "copilot" }) } as never, {
    getState: () => ({} as NavigatorSessionState), patchSession: () => {}, rememberSelectionContext: value => value,
    getVisibleAdditionalContext: () => undefined, collectGuidanceContextForDepth: async () => context,
    getProviderId: () => "ollama", getModelProfile: () => profile
  });
  const preview = coordinator.externalize({ context, requestPlan: plan }).requestPlan;
  const actual = reconcileRequestPlan(plan, { ...plan, assistanceDepth: "high", context, modelProfile: profile });
  assert.deepEqual(preview.referenceDocuments, actual.referenceDocuments);
});

test("reference previews search the same current question and hand-entered task used for generation", async () => {
  const state = { requestState: "idle", mode: "manual", assistanceDepth: "low", contextPreview: { diagnosticsSummary: [] } } as unknown as NavigatorSessionState;
  const context: GuidanceContext = { referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] };
  const settings = { excludedGlobs: [], protectedExcludedGlobs: [] } as unknown as NavigatorSettings;
  const coordinator = new RequestPlanCoordinator({ collectPreview: () => state.contextPreview, collectGuidanceContext: () => context } as never,
    new RequestPlanner(), { getSettings: () => settings } as never, {
      getState: () => state, patchSession: () => {}, rememberSelectionContext: value => value,
      collectGuidanceContextForDepth: async () => context, getVisibleAdditionalContext: () => undefined,
      resolveReferenceContext: async (context, question) => {
        assert.equal(question, "現在の質問"); assert.equal(context.additionalContext, "課題文");
        return { ...context, referenceDocuments: [{ id: "doc:1", sourceId: "source", path: "docs/rule.md", title: "Rule", kind: "rules", hash: "v1",
          text: "RULE", startLine: 1, endLine: 1, reason: "適用範囲", localOnly: true, mode: "reference" }] };
      }
    });
  await coordinator.refresh("現在の質問", "課題文");
  const plan = coordinator.getCurrentPlan(state);
  assert.equal(plan.previewInput, "現在の質問");
  assert.equal(plan.referenceDocuments?.[0].included, true);
});
loader._load = originalLoad;

test("provider changes invalidate capture policy even when model profile is unchanged", () => {
  const state = { requestState:"idle",mode:"manual",assistanceDepth:"low",contextPreview:{diagnosticsSummary:[]} } as unknown as NavigatorSessionState;
  const settings = {providerId:"lmStudio",excludedGlobs:[],protectedExcludedGlobs:[]} as unknown as NavigatorSettings;
  const providers: unknown[]=[];
  const context: GuidanceContext={activeFilePath:"app.ts",activeFileExcerpt:"const value = 1;",referencedFiles:[],diagnosticsSummary:[],recentEditsSummary:[],relatedSymbols:[]};
  const coordinator=new RequestPlanCoordinator({collectGuidanceContext:(provider: unknown)=>{providers.push(provider);return context;}} as never,
    new RequestPlanner(),{getSettings:()=>settings} as never,{
      getState:()=>state,patchSession:()=>{},rememberSelectionContext:p=>p,
      getVisibleAdditionalContext:()=>undefined,collectGuidanceContextForDepth:async()=>context
    });
  coordinator.getCurrentPlan(state);
  coordinator.getCurrentPlan(state);
  settings.providerId="copilot";
  coordinator.getCurrentPlan(state);
  settings.providerId="orcaRouter";
  coordinator.getCurrentPlan(state);
  settings.providerId="ollama";
  coordinator.getCurrentPlan(state);
  assert.deepEqual(providers,["lmStudio","copilot","orcaRouter","ollama"]);
});

test("入力中のflow・hint・next deepと追加文脈を送信予定へ反映する", async () => {
  const state = { requestState: "idle", assistanceDepth: "low", contextPreview: { diagnosticsSummary: [] } } as unknown as NavigatorSessionState;
  const settings = { excludedGlobs: [], protectedExcludedGlobs: [] } as unknown as NavigatorSettings;
  const context: GuidanceContext = {
    activeFilePath: "app.ts", activeFileExcerpt: "code", referencedFiles: [],
    workspaceTree: { rootPath: "", treeText: "app.ts", truncated: false },
    diagnosticsSummary: [{ severity: "Error", line: 1, message: "error" }], recentEditsSummary: [], relatedSymbols: []
  };
  let projectScope: unknown;
  let collectedDepth: unknown;
  let delay: Promise<void> | undefined;
  const coordinator = new RequestPlanCoordinator({
    collectPreview: () => state.contextPreview,
    collectGuidanceContext: () => context,
    collectNextActionContext: async (_settings: unknown, scope: unknown) => {
      projectScope = scope;
      return { ...context, projectSummary: { scope: "deep", openFiles: ["app.ts"], diagnosticsSummary: [], recentEditsSummary: [], todoSummary: [], manifestSummary: [], docsSummary: [] } };
    }
  } as never, new RequestPlanner(), { getSettings: () => settings } as never, {
    getState: () => state, patchSession: (patch) => Object.assign(state, patch),
    rememberSelectionContext: (preview) => preview, getVisibleAdditionalContext: () => undefined,
    collectGuidanceContextForDepth: async (_settings, depth) => { collectedDepth = depth; await delay; return context; }
  });
  await coordinator.refresh("/flow", "draft context");
  let plan = coordinator.getCurrentPlan(state);
  assert.equal(collectedDepth, "high");
  assert.equal(plan.assistanceDepth, "high");
  assert.equal(plan.categories.find((x) => x.key === "diagnostics")?.included, false);
  assert.equal(plan.categories.find((x) => x.key === "additionalContext")?.included, true);
  assert.equal(plan.previewInput, "/flow");
  await coordinator.refresh("/hint", "");
  plan = coordinator.getCurrentPlan(state);
  assert.equal(plan.categories.find((x) => x.key === "workspaceTree")?.included, false);
  assert.equal(plan.categories.find((x) => x.key === "additionalContext")?.included, false);
  await coordinator.refresh("/next deep", "");
  plan = coordinator.getCurrentPlan(state);
  assert.equal(projectScope, "deep");
  assert.equal(plan.categories.find((x) => x.key === "projectSummary")?.included, true);
  coordinator.invalidate();
  assert.equal(coordinator.getCurrentPlan(state).previewInput, undefined, "incomplete fallback must not appear current");
  let release!: () => void;
  delay = new Promise<void>((resolve) => { release = resolve; });
  const stale = coordinator.refresh("/flow", "old");
  delay = undefined;
  await coordinator.refresh("/hint", "new");
  release();
  await stale;
  assert.equal(coordinator.getCurrentPlan(state).previewInput, "/hint", "late preview must not overwrite newer input");
  assert.equal(coordinator.getCurrentPlan(state).previewAdditionalContext, "new");
});
