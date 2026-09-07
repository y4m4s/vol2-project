import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { RequestPlanner } from "../src/services/RequestPlanner";
import type { GuidanceContext, NavigatorSessionState, NavigatorSettings } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? { workspace: { workspaceFolders: [] } } : originalLoad(id, parent, isMain);
const { RequestPlanCoordinator } = require("../src/application/coordinators/RequestPlanCoordinator") as typeof import("../src/application/coordinators/RequestPlanCoordinator");
loader._load = originalLoad;

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
