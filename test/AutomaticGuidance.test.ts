import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { RequestPlanner, type PreparedGuidanceRequest } from "../src/services/RequestPlanner";
import type { GuidanceRequestInput } from "../src/services/AdviceService";
import type { AssistanceDepth, GuidanceContext, NavigatorSessionState, NavigatorSettings } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {
  CancellationTokenSource: class {
    public token = { isCancellationRequested: false };
    public cancel(): void { this.token.isCancellationRequested = true; }
    public dispose(): void {}
  }
} : originalLoad(id, parent, isMain);
const { NavigatorController } = require("../src/application/NavigatorController") as typeof import("../src/application/NavigatorController");
loader._load = originalLoad;

interface Options { kind: "always"; prepared: PreparedGuidanceRequest; assistanceDepth: AssistanceDepth }
interface Driver {
  handleAutomaticGuidance(): Promise<void>;
  runGuidanceRequest(options: Options, state: NavigatorSessionState): Promise<{ ok: boolean }>;
}

test("自動助言の収集・送信・保存ラベルが高→低の切替に追従する（全接続先）", async () => {
  for (const providerId of ["copilot", "orcaRouter", "lmStudio", "ollama"] as const) {
    const state = {
      assistanceDepth: "high", mode: "always", screen: "main", requestState: "idle",
      conversationHistory: [], contextPreview: { diagnosticsSummary: [] }
    } as unknown as NavigatorSessionState;
    const settings = { providerId, dailyTokenLimit: 100000, protectedExcludedGlobs: [], excludedGlobs: [] } as unknown as NavigatorSettings;
    const context: GuidanceContext = {
      activeFilePath: "src/app.ts", activeFileExcerpt: "const x = 1;",
      referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: []
    };
    const collected: AssistanceDepth[] = [];
    const sent: GuidanceRequestInput[] = [];
    const driver = Object.create(NavigatorController.prototype) as Driver;
    Object.assign(driver, {
      nextGuidanceRequestId: 1,
      sessionStore: { getState: () => state },
      settingsService: { getSettings: () => settings },
      usageMeter: { isTokenLimitExceeded: () => false },
      connectionSettingsCoordinator: { getCurrentProviderId: () => providerId, getCurrentModelLabel: () => "test model" },
      connectionService: { getState: () => "connected", getConnectedModel: () => ({ providerId, modelId: "test" }) },
      contextCollector: { collectPreview: () => state.contextPreview },
      requestPlanner: new RequestPlanner(),
      requestPlanCoordinator: { externalize: (prepared: PreparedGuidanceRequest) => prepared },
      knowledgeStore: { findReusable: () => [] },
      conversationCoordinator: { ensureStreamForAutomaticResult: async () => state, setGuidanceContext: () => {} },
      adviceService: { requestGuidance: async (input: GuidanceRequestInput) => {
        sent.push(input);
        return { ok: true, text: "確認の観点です。" };
      } },
      patchSession: (patch: Partial<NavigatorSessionState>) => Object.assign(state, patch),
      rememberSelectionContext: (preview: unknown) => preview,
      getGuidanceAdditionalContext: () => undefined,
      collectGuidanceContextForDepth: async (_settings: NavigatorSettings, depth: AssistanceDepth) => {
        collected.push(depth);
        return context;
      },
      executeGuidanceRequest: async (factory: () => Promise<Options | undefined>) => {
        const options = await factory();
        return options ? driver.runGuidanceRequest(options, state) : { ok: false };
      },
      prepareConversationForGuidance: async () => state,
      persistActiveConversationState: async () => {}
    });
    await driver.handleAutomaticGuidance();
    assert.equal(sent[0].assistanceDepth, "high");
    assert.equal(state.conversationHistory[0].assistanceDepth, "high");
    assert.equal(state.conversationHistory[0].requestPlan?.assistanceDepth, "high");
    assert.equal(state.latestGuidance?.assistanceDepth, "high");
    await driver.handleAutomaticGuidance();
    assert.equal(sent.length, 1, "same context and depth should be suppressed");
    state.assistanceDepth = "low";
    await driver.handleAutomaticGuidance();
    assert.equal(sent.length, 2, "a depth change must allow a new answer");
    assert.equal(sent[1].assistanceDepth, "low");
    assert.equal(state.conversationHistory[1].assistanceDepth, "low");
    assert.equal(state.latestGuidance?.assistanceDepth, "low");
    assert.equal(state.conversationHistory[0].assistanceDepth, "high", "historical labels remain accurate");
    assert.deepEqual(collected, ["high", "high", "low"]);
  }
});
