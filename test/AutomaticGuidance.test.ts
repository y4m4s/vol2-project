import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import { SingleFlightGate } from "../src/services/SingleFlightGate";
import type { AutoAdviceTriggerEvent } from "../src/services/AdviceScheduler";
import type { GuidanceRequestResult } from "../src/services/AdviceService";
import { RequestPlanner, type PreparedGuidanceRequest } from "../src/services/RequestPlanner";
import type { GuidanceRequestInput } from "../src/services/AdviceService";
import type { AssistanceDepth, GuidanceContext, NavigatorSessionState, NavigatorSettings } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
class Emitter<T> {
  private listeners: ((value: T) => void)[] = [];
  public event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((item) => item !== listener); } };
  };
  public fire(value: T): void { for (const listener of this.listeners) listener(value); }
  public dispose(): void { this.listeners = []; }
}
loader._load = (id, parent, isMain) => id === "vscode" ? {
  EventEmitter: Emitter,
  CancellationTokenSource: class {
    public token = { isCancellationRequested: false };
    public cancel(): void { this.token.isCancellationRequested = true; }
    public dispose(): void {}
  }
} : originalLoad(id, parent, isMain);
const { NavigatorController } = require("../src/application/NavigatorController") as typeof import("../src/application/NavigatorController");
const { AdviceScheduler } = require("../src/services/AdviceScheduler") as typeof import("../src/services/AdviceScheduler");
const { ConversationCoordinator } = require("../src/application/coordinators/ConversationCoordinator") as typeof import("../src/application/coordinators/ConversationCoordinator");
const { ConversationStore } = require("../src/services/ConversationStore") as typeof import("../src/services/ConversationStore");
loader._load = originalLoad;

interface Options { kind: "always"; prepared: PreparedGuidanceRequest; assistanceDepth: AssistanceDepth }
interface Driver {
  handleAutomaticGuidance(event?: AutoAdviceTriggerEvent): Promise<void>;
  runGuidanceRequest(options: Options, state: NavigatorSessionState): Promise<{ ok: boolean }>;
  setAdditionalContext(additionalContext: string): Promise<void>;
}

// Keep the real scheduler, request gate, controller execution and stream lifecycle.
// Only the editor/provider and filesystem persistence are replaced.
async function lifecycleHarness(respond: (input: GuidanceRequestInput) => Promise<GuidanceRequestResult>) {
  const sql = await require("sql.js")();
  const db = new sql.Database();
  const store = new ConversationStore({} as vscode.Uri);
  Object.assign(store, { db, persist: async () => {} });
  (store as unknown as { migrate(): void }).migrate();
  const state = { assistanceDepth: "low", mode: "always", screen: "main", requestState: "idle",
    connectionState: "connected", conversationHistory: [], contextPreview: { diagnosticsSummary: [] }
  } as unknown as NavigatorSessionState;
  const settings = { providerId: "copilot", dailyTokenLimit: 100000, protectedExcludedGlobs: [], excludedGlobs: [],
    idleDelayMs: 100, requestIntervalMs: 200 } as unknown as NavigatorSettings;
  const context: GuidanceContext = { activeFilePath: "/repo/app.ts", activeFileExcerpt: "const x = 1;",
    referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] };
  const scheduler = new AdviceScheduler();
  const driver = Object.create(NavigatorController.prototype) as Driver & {
    patchSession(patch: Partial<NavigatorSessionState>): void;
    createGuidanceCard(entry: NavigatorSessionState["conversationHistory"][number]): NonNullable<NavigatorSessionState["latestGuidance"]>;
    automaticFingerprints: Set<string>;
    automaticFocusByFile: Map<string, string>;
    automaticOverviewByFile: Map<string, string>;
  };
  let snapshot = "v1:cursor1";
  let connection = "connected";
  Object.assign(driver, {
    automaticFingerprints: new Set(), automaticFocusByFile: new Map(), automaticOverviewByFile: new Map(),
    nextGuidanceRequestId: 1, guidanceRequestGate: new SingleFlightGate(), adviceScheduler: scheduler,
    sessionStore: { getState: () => state, patch: (patch: Partial<NavigatorSessionState>) => Object.assign(state, patch) },
    settingsService: { getSettings: () => settings }, usageMeter: { isTokenLimitExceeded: () => false },
    connectionSettingsCoordinator: { getCurrentProviderId: () => "copilot", getCurrentModelLabel: () => "test" },
    connectionService: { getState: () => connection, getConnectedModel: () => ({ providerId: "copilot", modelId: "test" }) },
    contextCollector: { collectPreview: () => state.contextPreview, collectGuidanceContext: () => context,
      collectAutomaticObservation: (event: AutoAdviceTriggerEvent) => ({ triggerReasons: event.signals.map((x) => x.reason),
        idleDurationMs: event.idleDurationMs, selectionPresent: false, cursor: { line: 1, column: 1 }, cursorExcerpt: "<<<NAVICOM_CURSOR>>>" + context.activeFileExcerpt }),
      resetAutomaticDiagnosticsBaseline: () => {}, automaticEditorSnapshot: () => snapshot, automaticDocumentSnapshot: () => "v1" },
    requestPlanner: new RequestPlanner(), requestPlanCoordinator: { externalize: (prepared: PreparedGuidanceRequest) => prepared },
    knowledgeStore: { findReusable: () => [] }, adviceService: { requestGuidance: respond },
    rememberSelectionContext: (preview: unknown) => preview,
    getGuidanceAdditionalContext: (currentState: NavigatorSessionState) => currentState.screen === "main"
      ? currentState.pendingAdditionalContext ?? currentState.activeAdditionalContext
      : currentState.activeAdditionalContext,
    collectGuidanceContextForDepth: async () => context
  });
  const coordinator = new ConversationCoordinator(store, {} as never, {
    getState: () => state, patchSession: (patch) => driver.patchSession(patch), resolveHomeScreen: () => "main",
    resetAutomaticFingerprint: () => { driver.automaticFingerprints.clear(); driver.automaticFocusByFile.clear(); driver.automaticOverviewByFile.clear(); },
    createGuidanceCard: (entry) => driver.createGuidanceCard(entry),
    getGuidanceAdditionalContext: (currentState) => currentState.screen === "main"
      ? currentState.pendingAdditionalContext ?? currentState.activeAdditionalContext
      : currentState.activeAdditionalContext
  });
  Object.assign(driver, { conversationCoordinator: coordinator });
  driver.patchSession({});
  return { driver, state, scheduler, store, context,
    moveCursor: () => { snapshot = "v1:cursor2"; },
    changeEditor: () => { snapshot = "v2:cursor2"; context.activeFileExcerpt = "const x = 2;"; },
    restrict: () => { connection = "restricted"; },
    dispose: () => { scheduler.dispose(); store.dispose(); } };
}

for (const phase of ["preparing", "requesting"] as const) {
  test(`カーソルだけ移動した${phase}中の自動助言を再予約する`, async (t) => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const h = await lifecycleHarness(async () => {
      calls++;
      if (phase === "requesting" && calls === 1) { started(); await blocked; }
      return { ok: true, text: "現在のカーソルへの助言", focus: "continue" };
    });
    t.after(h.dispose);
    if (phase === "preparing") {
      let collections = 0;
      Object.assign(h.driver, { collectGuidanceContextForDepth: async () => {
        if (++collections === 1) { started(); await blocked; }
        return h.context;
      } });
    }
    t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
    const runs: Promise<void>[] = [];
    h.scheduler.onDidTriggerAdvice((event) => { runs.push(h.driver.handleAutomaticGuidance(event)); });
    h.scheduler.handleActivity("text_edit");
    t.mock.timers.tick(100);
    await firstStarted;
    h.moveCursor();
    h.scheduler.handleCursorActivity();
    assert.equal(h.scheduler.getTriggerSnapshot().signals.length, 0);
    t.mock.timers.tick(500);
    unblock();
    await runs[0];
    assert.equal(h.state.conversationHistory.length, 0);
    assert.deepEqual(h.scheduler.getTriggerSnapshot().signals.map((signal) => signal.reason), ["text_edit"]);
    t.mock.timers.tick(99);
    assert.equal(runs.length, 1);
    t.mock.timers.tick(1);
    await Promise.all(runs);
    assert.equal(runs.length, 2);
    assert.equal(calls, phase === "requesting" ? 2 : 1);
    assert.equal(h.state.conversationHistory.length, 1);
  });
}

test("生成中の編集を古い回答の破棄後に再実行する（実スケジューラと排他制御）", async (t) => {
  let finishFirst!: (result: GuidanceRequestResult) => void;
  const first = new Promise<GuidanceRequestResult>((resolve) => { finishFirst = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    if (++calls === 1) { started(); return first; }
    return { ok: true, text: "新しい編集への助言", focus: "continue" };
  });
  t.after(h.dispose);
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const runs: Promise<void>[] = [];
  h.scheduler.onDidTriggerAdvice((event) => { runs.push(h.driver.handleAutomaticGuidance(event)); });
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(100);
  await firstStarted;
  h.changeEditor();
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(500);
  finishFirst({ ok: true, text: "古い助言", focus: "continue" });
  await runs[0];
  await Promise.all(runs);
  assert.equal(calls, 2);
  assert.equal(h.state.requestState, "idle");
  assert.deepEqual(h.state.conversationHistory.map((entry) => entry.text), ["新しい編集への助言"]);
  assert.equal(h.scheduler.getTriggerSnapshot().signals.length, 0);
});

test("編集後の利用制限エラーも表示して接続状態を反映し自動モードを止める", async (t) => {
  const h = await lifecycleHarness(async () => {
    h.changeEditor(); h.restrict();
    return { ok: false, connectionState: "restricted", message: "利用制限" };
  });
  t.after(h.dispose);
  await h.driver.handleAutomaticGuidance();
  assert.equal(h.state.connectionState, "restricted");
  assert.equal(h.state.mode, "manual");
  assert.equal(h.state.requestState, "idle");
  assert.match(h.state.statusMessage!.text, /利用制限/);
  assert.equal(h.state.conversationHistory.length, 0);
});

test("初回概要の既出情報を実際の履歴作成後も保持し、次の判定へ渡す", async (t) => {
  const sent: GuidanceRequestInput[] = [];
  const h = await lifecycleHarness(async (input) => {
    sent.push(input);
    return sent.length === 1 ? { ok: true, text: "全体像", focus: "overview" }
      : { ok: true, text: "", outcome: "no_advice", focus: "none" };
  });
  t.after(h.dispose);
  await h.driver.handleAutomaticGuidance({ signals: [{ reason: "editor_change", occurredAt: 1 }], idleDurationMs: 100 });
  assert.equal(h.store.list().length, 1);
  assert.equal(h.driver.automaticOverviewByFile.get("/repo/app.ts"), "v1");
  await h.driver.handleAutomaticGuidance({ signals: [{ reason: "selection_change", occurredAt: 2 }], idleDurationMs: 100 });
  assert.equal(sent[1].automaticObservation?.previousFocus, "overview");
  assert.equal(sent[1].automaticObservation?.overviewAlreadyShown, true);
  assert.equal(h.driver.automaticFocusByFile.get("/repo/app.ts"), "none");
  assert.equal(h.store.list().length, 1);
  assert.equal(h.state.conversationHistory.length, 2);
  assert.equal(h.state.conversationHistory[1].focus, "none");
  assert.equal(h.store.get(h.state.activeConversationStreamId!)!.entries.length, 2);
});

test("初回の助言不要は追加コンテキストを保持し、会話を作らず通知する", async (t) => {
  const h = await lifecycleHarness(async () => ({ ok: true, text: "", outcome: "no_advice", focus: "none" }));
  t.after(h.dispose);
  h.state.pendingAdditionalContext = "問題文";
  await h.driver.handleAutomaticGuidance();
  assert.equal(h.state.screen, "main");
  assert.equal(h.state.pendingAdditionalContext, "問題文");
  assert.equal(h.state.conversationHistory.length, 0);
  assert.equal(h.store.list().length, 0);
  assert.match(h.state.statusMessage!.text, /追加すべき内容はありませんでした/);
  assert.equal(h.state.requestState, "idle");
});

test("会話途中の追加コンテキストを保存し、次の自動助言から使用する", async (t) => {
  const sent: GuidanceRequestInput[] = [];
  const h = await lifecycleHarness(async (input) => {
    sent.push(input);
    return { ok: true, text: "助言", focus: "continue" };
  });
  t.after(h.dispose);

  await h.driver.handleAutomaticGuidance();
  assert.equal(h.state.screen, "conversation");
  assert.equal(sent.length, 1);

  await h.driver.setAdditionalContext("  変更後の要件\r\n横一列で表示  ");
  assert.equal(sent.length, 1, "追加コンテキストの編集だけではAIを呼び出さない");
  assert.equal(h.state.activeAdditionalContext, "変更後の要件\n横一列で表示");
  assert.equal(
    h.store.get(h.state.activeConversationStreamId!)?.additionalContext,
    "変更後の要件\n横一列で表示"
  );

  await h.driver.handleAutomaticGuidance({
    signals: [{ reason: "text_edit", occurredAt: 1 }],
    idleDurationMs: 100
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].context.additionalContext, "変更後の要件\n横一列で表示");

  await h.driver.setAdditionalContext("   ");
  assert.equal(h.state.activeAdditionalContext, undefined);
  assert.equal(h.store.get(h.state.activeConversationStreamId!)?.additionalContext, undefined);
});

test("助言リクエスト中の追加コンテキスト更新を無視し、開始前の編集内容を保持する", async (t) => {
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  let secondRequestStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => { secondRequestStarted = resolve; });
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    calls++;
    if (calls === 2) {
      secondRequestStarted();
      await blocked;
    }
    return { ok: true, text: "助言", focus: "continue" };
  });
  t.after(h.dispose);

  await h.driver.handleAutomaticGuidance();
  await h.driver.setAdditionalContext("開始前の要件");
  const streamId = h.state.activeConversationStreamId!;
  assert.equal(h.store.get(streamId)?.additionalContext, "開始前の要件");

  const pending = h.driver.handleAutomaticGuidance({
    signals: [{ reason: "text_edit", occurredAt: 1 }],
    idleDurationMs: 100
  });
  await secondStarted;
  assert.equal(h.state.requestState, "requesting_guidance");

  await h.driver.setAdditionalContext("処理中の変更");
  assert.equal(h.state.activeAdditionalContext, "開始前の要件");
  assert.equal(h.store.get(streamId)?.additionalContext, "開始前の要件");

  unblock();
  await pending;
  assert.equal(h.state.activeAdditionalContext, "開始前の要件");
  assert.equal(h.store.get(streamId)?.additionalContext, "開始前の要件");
});

test("会話の助言不要は保存し、連続した助言不要は通知だけにする", async (t) => {
  let calls = 0;
  const h = await lifecycleHarness(async () => ++calls === 1
    ? { ok: true, text: "最初の助言", focus: "continue" }
    : { ok: true, text: "", outcome: "no_advice", focus: "none", usage: { inputTokens: 10, outputTokens: 12 } });
  t.after(h.dispose);
  await h.driver.handleAutomaticGuidance();
  h.state.screen = "advice_detail";
  const selected = h.state.selectedConversationId;
  h.context.activeFileExcerpt = "const x = 2;";
  await h.driver.handleAutomaticGuidance();
  assert.equal(h.state.screen, "advice_detail");
  assert.equal(h.state.selectedConversationId, selected);
  assert.equal(h.state.conversationHistory.length, 2);
  assert.equal(h.state.conversationHistory[1].tokenUsage?.outputTokens, 12);
  assert.match(h.store.get(h.state.activeConversationStreamId!)!.entries[1].text, /追加すべき内容はありませんでした/);
  h.context.activeFileExcerpt = "const x = 3;";
  await h.driver.handleAutomaticGuidance();
  assert.equal(calls, 3);
  assert.equal(h.state.conversationHistory.length, 2);
  assert.match(h.state.statusMessage!.text, /追加すべき内容はありませんでした/);
});

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
    let editorSnapshot = "app.ts:1:13";
    let editWhileResponding = false;
    const driver = Object.create(NavigatorController.prototype) as Driver;
    Object.assign(driver, {
      automaticFingerprints: new Set(),
      automaticFocusByFile: new Map(),
      automaticOverviewByFile: new Map(),
      nextGuidanceRequestId: 1,
      sessionStore: { getState: () => state },
      settingsService: { getSettings: () => settings },
      usageMeter: { isTokenLimitExceeded: () => false },
      connectionSettingsCoordinator: { getCurrentProviderId: () => providerId, getCurrentModelLabel: () => "test model" },
      connectionService: { getState: () => "connected", getConnectedModel: () => ({ providerId, modelId: "test" }) },
      contextCollector: {
        collectPreview: () => state.contextPreview,
        collectGuidanceContext: () => context,
        collectAutomaticObservation: () => ({ triggerReasons: ["text_edit"], idleDurationMs: 12000,
          cursor: { line: 1, column: 13 }, cursorExcerpt: "const x = <<<NAVICOM_CURSOR>>>;", selectionPresent: false }),
        resetAutomaticDiagnosticsBaseline: () => {},
        automaticEditorSnapshot: () => editorSnapshot,
        automaticDocumentSnapshot: () => "app.ts:v1"
      },
      requestPlanner: new RequestPlanner(),
      requestPlanCoordinator: { externalize: (prepared: PreparedGuidanceRequest) => prepared },
      knowledgeStore: { findReusable: () => [] },
      conversationCoordinator: { ensureStreamForAutomaticResult: async () => state, setGuidanceContext: () => {} },
      adviceService: { requestGuidance: async (input: GuidanceRequestInput) => {
        sent.push(input);
        if (editWhileResponding) editorSnapshot = "app.ts:v3:1:15";
        return { ok: true, text: "確認の観点です。", focus: "continue" };
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
    assert.deepEqual(sent[0].automaticObservation?.triggerReasons, ["text_edit"]);
    assert.equal(state.conversationHistory[0].focus, "continue");
    assert.equal(state.latestGuidance?.focus, "continue");
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
    context.activeFileExcerpt = "const x = 2;";
    editorSnapshot = "app.ts:v2:1:14";
    editWhileResponding = true;
    await driver.handleAutomaticGuidance();
    assert.equal(sent.length, 3);
    assert.equal(state.conversationHistory.length, 2, "an answer for an outdated editor snapshot must not be displayed or saved");
  }
});
