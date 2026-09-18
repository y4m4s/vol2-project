import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import { SingleFlightGate } from "../src/services/SingleFlightGate";
import type { AutoAdviceTriggerEvent } from "../src/services/AdviceScheduler";
import type { GuidanceRequestResult } from "../src/services/AdviceService";
import { RequestPlanner, type PreparedGuidanceRequest } from "../src/services/RequestPlanner";
import type { GuidanceRequestInput } from "../src/services/AdviceService";
import type { AiProviderId, AssistanceDepth, GuidanceContext, NavigatorSessionState, NavigatorSettings } from "../src/shared/types";
import { classifyRoutingTask } from "../src/shared/adaptiveProviderRouting";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
let workspaceTrusted = true;
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
  workspace: { get isTrusted() { return workspaceTrusted; } },
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
const { ProviderRoutingCoordinator } = require("../src/application/coordinators/ProviderRoutingCoordinator") as typeof import("../src/application/coordinators/ProviderRoutingCoordinator");
const { ConversationMemoryCoordinator } = require("../src/application/coordinators/ConversationMemoryCoordinator") as typeof import("../src/application/coordinators/ConversationMemoryCoordinator");
const { LmStudioCoordinator } = require("../src/application/coordinators/LmStudioCoordinator") as typeof import("../src/application/coordinators/LmStudioCoordinator");
const { ConnectionSettingsCoordinator } = require("../src/application/coordinators/ConnectionSettingsCoordinator") as typeof import("../src/application/coordinators/ConnectionSettingsCoordinator");
const { LmStudioServerService } = require("../src/services/LmStudioServerService") as typeof import("../src/services/LmStudioServerService");
loader._load = originalLoad;

interface Options { kind: "always"; prepared: PreparedGuidanceRequest; assistanceDepth: AssistanceDepth }
interface Driver {
  connectCopilot(providerId?: AiProviderId): Promise<void>;
  handleAutomaticGuidance(event?: AutoAdviceTriggerEvent): Promise<void>;
  runGuidanceRequest(options: Options, state: NavigatorSessionState): Promise<{ ok: boolean }>;
  setAdditionalContext(additionalContext: string): Promise<void>;
}

test("オンボーディングで選んだ接続先を基本プロバイダーにして自動候補を再確認する", async () => {
  const connected: AiProviderId[] = [];
  let settings = {
    providerId: "copilot" as AiProviderId,
    routing: { mode: "automatic" as const, allowedProviderIds: ["orcaRouter", "ollama"] as AiProviderId[], preferredProviderId: "copilot" as AiProviderId }
  };
  let synchronized = 0;
  const driver = Object.create(NavigatorController.prototype) as Driver;
  Object.assign(driver, {
    connectionSettingsCoordinator: { connect: async (providerId?: AiProviderId) => {
      if (providerId) connected.push(providerId);
    }, saveSettingsWithRevision: async (next: typeof settings) => { settings = next; return settings; } },
    settingsService: { getSettings: () => settings },
    sessionStore: { getState: () => ({ screen: "onboarding", screenHistory: [] }) },
    connectionService: { getState: () => "connected", getProviderId: () => connected.at(-1) },
    synchronizeRoutingProviders: async () => { synchronized++; }
  });

  await driver.connectCopilot("ollama");

  assert.deepEqual(connected, ["ollama"]);
  assert.equal(settings.routing.preferredProviderId, "ollama");
  assert.deepEqual(settings.routing.allowedProviderIds, ["orcaRouter", "ollama"]);
  assert.equal(synchronized, 1);

  Object.assign(driver, { sessionStore: { getState: () => ({ screen: "main", screenHistory: [] }) } });
  await driver.connectCopilot("orcaRouter");
  assert.deepEqual(connected, ["ollama", "orcaRouter"]);
  assert.equal(settings.routing.preferredProviderId, "ollama");
  assert.equal(synchronized, 1);
});

test("オンボーディングからOrcaRouter設定を経由しても明示選択を基本プロバイダーにする", async () => {
  let settings = {
    providerId: "orcaRouter" as AiProviderId,
    routing: { mode: "automatic" as const, allowedProviderIds: ["copilot"] as AiProviderId[], preferredProviderId: "copilot" as AiProviderId }
  };
  let synchronized = 0;
  const driver = Object.create(NavigatorController.prototype) as Driver;
  Object.assign(driver, {
    connectionSettingsCoordinator: {
      connect: async () => {},
      saveSettingsWithRevision: async (next: typeof settings) => { settings = next; return settings; }
    },
    settingsService: { getSettings: () => settings },
    sessionStore: { getState: () => ({ screen: "settings", screenHistory: ["onboarding"] }) },
    connectionService: { getState: () => "connected", getProviderId: () => "orcaRouter" },
    synchronizeRoutingProviders: async () => { synchronized++; }
  });

  await driver.connectCopilot("orcaRouter");

  assert.equal(settings.routing.preferredProviderId, "orcaRouter");
  assert.deepEqual(settings.routing.allowedProviderIds, ["copilot", "orcaRouter"]);
  assert.equal(synchronized, 1);
});

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
  // 実機の document.version は編集のたびに進み、カーソル移動では変わらない。
  let documentVersion = 1;
  let cursorRevision = 1;
  let connection = "connected";
  Object.assign(driver, {
    automaticFingerprints: new Set(), automaticFocusByFile: new Map(), automaticOverviewByFile: new Map(),
    nextGuidanceRequestId: 1, guidanceRequestGate: new SingleFlightGate(), adviceScheduler: scheduler,
    sessionStore: { getState: () => state, patch: (patch: Partial<NavigatorSessionState>) => Object.assign(state, patch) },
    settingsService: { getSettings: () => settings }, usageMeter: { isTokenLimitExceeded: () => false },
    connectionSettingsCoordinator: { getCurrentProviderId: () => "copilot", getCurrentModelLabel: () => "test" },
    connectionService: { getProviderId: () => "copilot", getState: () => connection, getConnectedModel: () => ({ providerId: "copilot", modelId: "test" }) },
    contextCollector: { collectPreview: () => state.contextPreview, collectGuidanceContext: () => context,
      collectAutomaticObservation: (event: AutoAdviceTriggerEvent) => ({ triggerReasons: event.signals.map((x) => x.reason),
        idleDurationMs: event.idleDurationMs, selectionPresent: false, cursor: { line: 1, column: 1 }, cursorExcerpt: "<<<NAVICOM_CURSOR>>>" + context.activeFileExcerpt }),
      resetAutomaticDiagnosticsBaseline: () => {},
      automaticEditorSnapshot: () => `v${documentVersion}:cursor${cursorRevision}`,
      automaticDocumentSnapshot: () => `v${documentVersion}` },
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
  const internals = driver as unknown as { connectionService: ConstructorParameters<typeof ProviderRoutingCoordinator>[0]; usageMeter: ConstructorParameters<typeof ProviderRoutingCoordinator>[1] };
  Object.assign(driver, {
    providerRoutingCoordinator: new ProviderRoutingCoordinator(internals.connectionService, internals.usageMeter),
    conversationMemoryCoordinator: new ConversationMemoryCoordinator(internals.connectionService, store, internals.usageMeter)
  });
  driver.patchSession({});
  return { driver, state, scheduler, store, context,
    memoryRowCount: (streamId: string) => {
      const stmt = db.prepare("SELECT COUNT(*) AS count FROM conversation_memories WHERE stream_id = ?");
      try {
        stmt.bind([streamId]);
        return stmt.step() ? Number(stmt.getAsObject().count ?? 0) : 0;
      } finally { stmt.free(); }
    },
    // カーソルが動くと relatedSymbols（カーソル位置の単語とその行）も入れ替わる。
    moveCursor: () => { cursorRevision += 1; context.relatedSymbols = [`symbol${cursorRevision}`]; },
    scrollOnly: () => { context.activeFileExcerpt += "\n// 表示範囲が下にずれただけ"; },
    editCode: (excerpt: string) => { documentVersion += 1; context.activeFileExcerpt = excerpt; },
    changeEditor: () => { documentVersion += 1; cursorRevision += 1; context.activeFileExcerpt = "const x = 2;"; },
    restrict: () => { connection = "restricted"; },
    dispose: () => { scheduler.dispose(); store.dispose(); } };
}

for (const [initial, target] of [["lmStudio", "copilot"], ["ollama", "orcaRouter"], ["copilot", "lmStudio"], ["orcaRouter", "ollama"]] as const) {
  test(`routing ${initial} → ${target} uses the destination's active-file context`, async (t) => {
    const received: GuidanceRequestInput[] = [];
    const h = await lifecycleHarness(async input => { received.push(input); return { ok: true, text: "確認", focus: "review" }; });
    t.after(h.dispose);
    const internals = h.driver as unknown as {
      settingsService: { getSettings(): NavigatorSettings };
      connectionService: { getProviderId(): AiProviderId };
      contextCollector: { collectGuidanceContext(provider?: AiProviderId): GuidanceContext };
    };
    internals.settingsService.getSettings().providerId = initial;
    const whole = "function helper() { return 1; }\nconst x = helper();";
    const viewport = "const x = helper();";
    const excerpt = (provider?: AiProviderId) => provider === "lmStudio" || provider === "ollama" ? whole : viewport;
    h.context.activeFileExcerpt = excerpt(initial);
    const collections: AiProviderId[] = [];
    internals.contextCollector.collectGuidanceContext = provider => {
      if (provider) collections.push(provider);
      return { ...h.context, activeFileExcerpt: excerpt(provider) };
    };
    let active: AiProviderId = initial;
    internals.connectionService.getProviderId = () => active;
    Object.assign(h.driver, { providerRoutingCoordinator: { prepare: async () => { active = target; return { ok: true, taskProfile: classifyRoutingTask({ question: "" }) }; } } });
    await h.driver.handleAutomaticGuidance({ signals: [{ reason: "text_edit", occurredAt: 1 }], idleDurationMs: 1000 });
    assert.equal(received.length, 1);
    assert.equal(received[0].context.activeFileExcerpt, excerpt(target));
    assert.deepEqual(collections, [initial, target]);
  });
}

test("routing does not replace an explicit selection or restore excluded active-file content", async (t) => {
  for (const selected of [true, false]) {
    const received: GuidanceRequestInput[] = [];
    const h = await lifecycleHarness(async input => { received.push(input); return { ok: true, text: "確認", focus: "review" }; });
    t.after(h.dispose);
    const internals = h.driver as unknown as {
      settingsService: { getSettings(): NavigatorSettings };
      connectionService: { getProviderId(): AiProviderId };
      contextCollector: { collectGuidanceContext(): GuidanceContext };
    };
    const settings = internals.settingsService.getSettings();
    settings.providerId = "lmStudio";
    if (selected) h.context.selectedText = "chosen()";
    else { settings.excludedGlobs = ["**/app.ts"]; h.state.pendingAdditionalContext = "課題の説明"; }
    let active: AiProviderId = "lmStudio";
    internals.connectionService.getProviderId = () => active;
    let collections = 0;
    internals.contextCollector.collectGuidanceContext = () => { collections++; return h.context; };
    Object.assign(h.driver, { providerRoutingCoordinator: { prepare: async () => { active = "copilot"; return { ok: true, taskProfile: classifyRoutingTask({ question: "" }) }; } } });
    await h.driver.handleAutomaticGuidance();
    assert.equal(received.length, 1);
    assert.equal(received[0].context.selectedText, selected ? "chosen()" : undefined);
    assert.equal(received[0].context.activeFileExcerpt, selected ? h.context.activeFileExcerpt : undefined);
    assert.equal(collections, 1);
  }
});

test("an editor change during provider routing cancels instead of mixing file versions", async (t) => {
  let requests = 0;
  const h = await lifecycleHarness(async () => { requests++; return { ok: true, text: "確認" }; });
  t.after(h.dispose);
  const internals = h.driver as unknown as { connectionService: { getProviderId(): AiProviderId } };
  let active: AiProviderId = "copilot";
  internals.connectionService.getProviderId = () => active;
  Object.assign(h.driver, { providerRoutingCoordinator: { prepare: async () => { active = "lmStudio"; h.changeEditor(); return { ok: true }; } } });
  await h.driver.handleAutomaticGuidance();
  assert.equal(requests, 0);
  assert.equal(h.state.requestState, "idle");
  assert.match(h.state.statusMessage?.text ?? "", /編集対象が変わった/);
});

test("送信前にカーソルだけ移動したら、送らずに再予約してインターバル後にやり直す", async (t) => {
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    calls++;
    return { ok: true, text: "現在のカーソルへの助言", focus: "continue" };
  });
  t.after(h.dispose);
  let collections = 0;
  Object.assign(h.driver, { collectGuidanceContextForDepth: async () => {
    if (++collections === 1) { started(); await blocked; }
    return h.context;
  } });
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
  assert.equal(calls, 0, "送信前の中止なのでAIへは送らない");
  assert.deepEqual(h.scheduler.getTriggerSnapshot().signals.map((signal) => signal.reason), ["text_edit"]);
  // 再送はアイドル待ちだけでなく、完了時刻を起点にしたインターバルも満たす必要がある。
  t.mock.timers.tick(199);
  assert.equal(runs.length, 1);
  t.mock.timers.tick(1);
  await Promise.all(runs);
  assert.equal(runs.length, 2);
  assert.equal(calls, 1);
  assert.equal(h.state.conversationHistory.length, 1);
});

test("生成中にカーソルだけ移動しても、できあがった回答は捨てず再生成もしない", async (t) => {
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    if (++calls === 1) { started(); await blocked; }
    return { ok: true, text: "現在のカーソルへの助言", focus: "continue" };
  });
  t.after(h.dispose);
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const runs: Promise<void>[] = [];
  h.scheduler.onDidTriggerAdvice((event) => { runs.push(h.driver.handleAutomaticGuidance(event)); });
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(100);
  await firstStarted;
  // 回答を読むためのカーソル移動。コードは変わっていない。
  h.moveCursor();
  h.scheduler.handleCursorActivity();
  t.mock.timers.tick(500);
  unblock();
  await runs[0];
  assert.equal(h.state.conversationHistory.length, 1, "カーソル移動では回答を破棄しない");
  assert.equal(h.scheduler.getTriggerSnapshot().signals.length, 0, "再予約もしない");
  t.mock.timers.tick(1000);
  await Promise.all(runs);
  assert.equal(runs.length, 1);
  assert.equal(calls, 1);
});

test("SQLite memory rejects stale revisions, round-trips policy and removes memory with the conversation", async t => {
  const h = await lifecycleHarness(async () => ({ ok: true, text: "決定事項", focus: "continue" }));
  t.after(h.dispose);
  await h.driver.handleAutomaticGuidance();
  const id = h.state.activeConversationStreamId!;
  const record = h.store.get(id)!;
  record.entries[0].transmissionClass = "localOnly";
  record.entries[0].routeReason = "設定上限で切り替え";
  record.entries[0].routingTaskPurpose = "review";
  const saved = await h.store.saveStream(record);
  const items = [{ text: "決定事項", sourceEntryIds: [record.entries[0].id] }];
  assert.equal(await h.store.saveMemory(id, record.revision, items[0].sourceEntryIds, items), false);
  assert.equal(await h.store.saveMemory(id, saved.revision, items[0].sourceEntryIds, items), true);
  assert.deepEqual(h.store.getMemory(id)?.items, items);
  assert.equal(h.memoryRowCount(id), 1);
  assert.equal(h.store.get(id)?.entries[0].transmissionClass, "localOnly");
  assert.equal(h.store.get(id)?.entries[0].routeReason, "設定上限で切り替え");
  assert.equal(h.store.get(id)?.entries[0].routingTaskPurpose, "review");
  await h.store.deleteStream(id);
  assert.equal(h.store.getMemory(id), undefined);
  assert.equal(h.memoryRowCount(id), 0);
});

test("removing a source entry physically deletes its stored conversation memory", async t => {
  const h = await lifecycleHarness(async () => ({ ok: true, text: "決定事項", focus: "continue" }));
  t.after(h.dispose);
  await h.driver.handleAutomaticGuidance();
  const id = h.state.activeConversationStreamId!;
  const record = h.store.get(id)!;
  const sourceId = record.entries[0].id;
  assert.equal(await h.store.saveMemory(id, record.revision, [sourceId], [{ text: "決定事項", sourceEntryIds: [sourceId] }]), true);
  assert.equal(h.memoryRowCount(id), 1);
  await h.store.saveStream({ ...record, entries: record.entries.slice(1) });
  assert.equal(h.memoryRowCount(id), 0);
});

test("untrusted workspaces cannot check LM Studio during routing synchronization", async () => {
  workspaceTrusted = false;
  let statusChecks = 0;
  let starts = 0;
  const coordinator = new LmStudioCoordinator(
    {} as never,
    { getStatus: async () => { statusChecks++; return { state: "stopped", canStart: true, canStop: false }; },
      start: async () => { starts++; return { state: "running", canStart: false, canStop: true }; } } as never,
    { getSettings: () => ({ lmStudioBaseUrl: "http://127.0.0.1:1234" }) } as never,
    {} as never
  );
  try {
    assert.equal(await coordinator.checkServerForRoutingConnection(), false);
    assert.equal(statusChecks, 0);
    assert.equal(starts, 0);
  } finally {
    workspaceTrusted = true;
  }
});

test("routing synchronization does not start a stopped LM Studio server", async () => {
  let starts = 0;
  const coordinator = new LmStudioCoordinator(
    { getProviderId: () => "copilot" } as never,
    {
      getStatus: async () => ({ state: "stopped", canStart: true, canStop: false }),
      start: async () => { starts++; return { state: "running", canStart: false, canStop: true }; }
    } as never,
    { getSettings: () => ({ lmStudioBaseUrl: "http://127.0.0.1:1234" }) } as never,
    {} as never
  );

  assert.equal(await coordinator.checkServerForRoutingConnection(), false);
  assert.equal(starts, 0);
});

test("LM Studio 停止時は許可済みで接続確認済みの Copilot だけへ切り替える", async () => {
  let provider: AiProviderId = "lmStudio";
  let savedProvider: AiProviderId | undefined;
  let connectionState = "connected";
  let statusAction: string | undefined;
  const settings = {
    providerId: "lmStudio",
    lmStudioBaseUrl: "http://127.0.0.1:1234",
    routing: { mode: "automatic", allowedProviderIds: ["lmStudio", "copilot"] }
  } as NavigatorSettings;
  const coordinator = new LmStudioCoordinator(
    {
      getProviderId: () => provider,
      markUnavailable: () => { connectionState = "unavailable"; },
      getTestedModels: () => [{ providerId: "copilot" }],
      activateTestedProvider: (id: AiProviderId) => { provider = id; connectionState = "connected"; return true; },
      clearLmStudioModelOptions: () => {}
    } as never,
    { stop: async () => ({ state: "stopped", canStart: true, canStop: false }) } as never,
    { getSettings: () => settings } as never,
    {
      getState: () => ({ requestState: "idle", conversationHistory: [] }),
      patchSession: (partial: { connectionState?: string; statusMessage?: { action?: string } }) => {
        if (partial.connectionState) connectionState = partial.connectionState;
        statusAction = partial.statusMessage?.action ?? statusAction;
      },
      notifyStateChanged: () => {},
      saveSettings: async (next: NavigatorSettings) => { savedProvider = next.providerId; return next; }
    } as never
  );

  await coordinator.stopServer();
  assert.equal(provider, "copilot");
  assert.equal(savedProvider, "copilot");
  assert.equal(connectionState, "connected");
  assert.equal(statusAction, undefined);
});

test("ローカル限定の会話では LM Studio 停止後も Copilot に送らず設定リンクを出す", async () => {
  let activated = false;
  let saved = false;
  let connectionState = "connected";
  let statusAction: string | undefined;
  const settings = {
    providerId: "lmStudio",
    lmStudioBaseUrl: "http://127.0.0.1:1234",
    routing: { mode: "automatic", allowedProviderIds: ["lmStudio", "copilot"] }
  } as NavigatorSettings;
  const coordinator = new LmStudioCoordinator(
    {
      getProviderId: () => "lmStudio",
      markUnavailable: () => { connectionState = "unavailable"; },
      getTestedModels: () => [{ providerId: "copilot" }],
      activateTestedProvider: () => { activated = true; return true; },
      clearLmStudioModelOptions: () => {}
    } as never,
    { stop: async () => ({ state: "stopped", canStart: true, canStop: false }) } as never,
    { getSettings: () => settings } as never,
    {
      getState: () => ({ requestState: "idle", conversationHistory: [{ transmissionClass: "localOnly" }] }),
      patchSession: (partial: { connectionState?: string; statusMessage?: { action?: string } }) => {
        if (partial.connectionState) connectionState = partial.connectionState;
        statusAction = partial.statusMessage?.action ?? statusAction;
      },
      notifyStateChanged: () => {},
      saveSettings: async () => { saved = true; return settings; }
    } as never
  );

  await coordinator.stopServer();
  assert.equal(activated, false);
  assert.equal(saved, false);
  assert.equal(connectionState, "unavailable");
  assert.equal(statusAction, "openConnectionSettings");
});

test("LM Studio 接続失敗時もローカル限定の相談画面を維持する", async () => {
  let activated = false;
  let saved = false;
  let serviceConnectionState = "connected";
  const settings = {
    providerId: "lmStudio",
    defaultMode: "manual",
    defaultAssistanceDepth: "low",
    routing: { mode: "automatic", allowedProviderIds: ["lmStudio", "copilot"] }
  } as NavigatorSettings;
  let state = {
    requestState: "idle",
    screen: "main",
    screenHistory: [],
    connectionState: "connected",
    conversationHistory: [{ transmissionClass: "localOnly" }],
    mode: "manual"
  } as unknown as NavigatorSessionState;
  const coordinator = new ConnectionSettingsCoordinator(
    {
      connectAndActivate: async () => ({ activated: false, connectionState: "connected", failureState: "unavailable", previousProviderId: "lmStudio" }),
      getProviderId: () => "lmStudio",
      getState: () => serviceConnectionState,
      markUnavailable: () => { serviceConnectionState = "unavailable"; },
      getLastLmStudioIssue: () => "unreachable",
      getTestedModels: () => [{ providerId: "copilot" }],
      activateTestedProvider: () => { activated = true; return true; }
    } as never,
    { getSettings: () => settings, saveSettings: async () => { saved = true; return settings; } } as never,
    {} as never,
    {
      getState: () => state,
      patchSession: (partial: Partial<NavigatorSessionState>) => { state = { ...state, ...partial }; },
      collectContextPreview: () => ({}),
      notifyStateChanged: () => {}
    } as never
  );

  await coordinator.connect();
  assert.equal(state.screen, "main");
  assert.equal(state.connectionState, "unavailable");
  assert.equal(state.statusMessage?.action, "openConnectionSettings");
  assert.equal(activated, false);
  assert.equal(saved, false);
});

test("LM Studio API応答とCLI停止報告の不一致を起動中と区別する", async () => {
  const service = Object.create(LmStudioServerService.prototype) as {
    output: { appendLine(value: string): void };
    readCliStatus(): Promise<{ available: true; status: { running: false; port: number } }>;
    probeHttp(origin: string): Promise<"lmStudio">;
    getStatus(baseUrl: string): Promise<{ state: string; port?: number; canStart: boolean; canStop: boolean; message?: string }>;
  };
  service.output = { appendLine: () => {} };
  service.readCliStatus = async () => ({ available: true, status: { running: false, port: 1234 } });
  service.probeHttp = async () => "lmStudio";

  const status = await service.getStatus("http://127.0.0.1:1234");

  assert.equal(status.state, "statusMismatch");
  assert.equal(status.canStart, false);
  assert.equal(status.canStop, true);
  assert.match(status.message ?? "", /CLI は停止中/);
});

test("LM Studio停止中の状態更新はCLIを起動しない", async () => {
  let cliStatusChecks = 0;
  const service = Object.create(LmStudioServerService.prototype) as {
    output: { appendLine(value: string): void };
    readCliStatus(): Promise<{ available: true; status: { running: boolean } }>;
    probeHttp(origin: string): Promise<"unreachable">;
    getStatus(baseUrl: string): Promise<{ state: string; canStart: boolean; canStop: boolean }>;
  };
  service.output = { appendLine: () => {} };
  service.readCliStatus = async () => {
    cliStatusChecks++;
    return { available: true, status: { running: false } };
  };
  service.probeHttp = async () => "unreachable";

  const status = await service.getStatus("http://127.0.0.1:1234");

  assert.equal(status.state, "stopped");
  assert.equal(status.canStart, true);
  assert.equal(status.canStop, false);
  assert.equal(cliStatusChecks, 0);
});

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
  assert.equal(calls, 1, "古い回答は破棄し、この時点ではまだ送り直していない");
  // 再送は、生成の完了時刻を起点にしたインターバルを満たしてから。
  t.mock.timers.tick(200);
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

test("長い初回生成中の同一診断通知は画面遷移後に再送せず、新しいコード変更は送信する", async (t) => {
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    calls++;
    if (calls === 1) {
      h.scheduler.handleActivity("diagnostics_change");
      t.mock.timers.tick(500); // Both the idle wait and request interval expire.
    }
    return { ok: true, text: "助言", focus: "continue" };
  });
  t.after(h.dispose);
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const pending: Promise<void>[] = [];
  const fingerprintCounts: number[] = [];
  h.scheduler.onDidTriggerAdvice(event => {
    fingerprintCounts.push(h.driver.automaticFingerprints.size);
    pending.push(h.driver.handleAutomaticGuidance(event));
  });
  h.scheduler.handleActivity("editor_change");
  t.mock.timers.tick(100);
  await pending[0];
  assert.equal(pending.length, 1, "生成中に消費されたインターバルは完了時点で数え直す");
  t.mock.timers.tick(200);
  await pending[1];
  assert.equal(pending.length, 2, "インターバル経過後に発火し、重複判定を通る");
  assert.equal(fingerprintCounts[1], 1, "待機状態に戻す前に成功した入力を記録する");
  assert.equal(calls, 1);
  assert.equal(h.state.screen, "conversation");
  assert.equal(h.state.conversationHistory.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(pending.length, 2, "インターバルだけでは再生成しない");

  h.editCode("const x = 2;");
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(100);
  await pending[2];
  assert.equal(calls, 2);
  assert.equal(h.state.conversationHistory.length, 2);
});

test("コードを変えずにカーソル移動やスクロールをしただけなら、次のトリガーでも生成しない", async (t) => {
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    calls++;
    return { ok: true, text: `助言${calls}`, focus: "continue" };
  });
  t.after(h.dispose);
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const runs: Promise<void>[] = [];
  h.scheduler.onDidTriggerAdvice((event) => { runs.push(h.driver.handleAutomaticGuidance(event)); });
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(100);
  await runs[0];
  assert.equal(calls, 1);

  // 回答を読むための操作だけ。コードは変えていない。
  h.moveCursor();
  h.scrollOnly();
  h.scheduler.handleActivity("diagnostics_change");
  t.mock.timers.tick(300);
  await Promise.all(runs);
  assert.equal(runs.length, 2, "トリガー自体は発火する");
  assert.equal(calls, 1, "同じ状況なのでAIへは送らない");
  assert.equal(h.state.conversationHistory.length, 1);
  assert.match(h.state.statusMessage?.text ?? "", /類似した文脈/);

  // 実際にコードを変えたら送る。
  h.editCode("const x = 2;");
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(300);
  await Promise.all(runs);
  assert.equal(calls, 2);
  assert.equal(h.state.conversationHistory.length, 2);
});

test("生成がインターバルより長引いても、完了と同時に次の自動助言を始めない", async (t) => {
  let finish!: (result: GuidanceRequestResult) => void;
  const first = new Promise<GuidanceRequestResult>((resolve) => { finish = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const h = await lifecycleHarness(async () => {
    if (++calls === 1) { started(); return first; }
    return { ok: true, text: "2件目の助言", focus: "continue" };
  });
  t.after(h.dispose);
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const runs: Promise<void>[] = [];
  h.scheduler.onDidTriggerAdvice((event) => { runs.push(h.driver.handleAutomaticGuidance(event)); });
  h.scheduler.handleActivity("text_edit");
  t.mock.timers.tick(100);
  await firstStarted;

  // 生成がインターバル(200ms)より長引き、その間に言語サーバーの診断通知だけが届く。
  t.mock.timers.tick(500);
  h.scheduler.handleActivity("diagnostics_change");
  t.mock.timers.tick(500);
  assert.equal(h.scheduler.getState().cooldownRemainingMs, 0, "発火時刻を起点にすると生成中にインターバルを使い切る");

  finish({ ok: true, text: "1件目の助言", focus: "continue" });
  await runs[0];
  assert.equal(runs.length, 1, "完了と同時に次を始めない");
  assert.equal(h.state.conversationHistory.length, 1);

  t.mock.timers.tick(199);
  assert.equal(runs.length, 1, "完了時刻からインターバルを数え直す");
  t.mock.timers.tick(1);
  await Promise.all(runs);
  assert.equal(runs.length, 2);
  assert.equal(calls, 1, "コードが変わっていないので重複判定で送信しない");
  assert.equal(h.state.conversationHistory.length, 1);
});

test("追加コンテキストの削除・変更後の自動生成は会話メモリを組み立てず、現在の要件だけを送る", async (t) => {
  const sent: GuidanceRequestInput[] = [];
  const h = await lifecycleHarness(async input => {
    sent.push(input);
    return { ok: true, text: "OLD_TASK_REQUIREMENT", focus: "continue" };
  });
  t.after(h.dispose);
  h.state.pendingAdditionalContext = "OLD_TASK_REQUIREMENT";
  await h.driver.handleAutomaticGuidance();
  assert.equal(h.state.conversationHistory.length, 1);
  Object.assign(h.driver, { conversationMemoryCoordinator: {
    assemble: async () => { assert.fail("自動生成で履歴や要約を組み立てない"); }
  } });
  await h.driver.setAdditionalContext("");
  h.editCode("const x = 2;");
  await h.driver.handleAutomaticGuidance();
  assert.equal(sent[1].conversationMemory, "");
  assert.equal(sent[1].context.additionalContext, undefined);
  await h.driver.setAdditionalContext("NEW_TASK_REQUIREMENT");
  await h.driver.handleAutomaticGuidance();
  assert.equal(sent[2].conversationMemory, "");
  assert.equal(sent[2].context.additionalContext, "NEW_TASK_REQUIREMENT");
  assert.equal(h.state.conversationHistory.length, 3, "表示・保存する履歴は削除しない");
});

test("s02で開始した生成は別画面で完了しても新しい履歴に保存し、完了先のs04を開ける", async (t) => {
  for (const withExisting of [false, true]) {
    let destination: "settings" | "history" | undefined;
    const h = await lifecycleHarness(async () => {
      if (destination) h.state.screen = destination;
      return { ok: true, text: "保存される回答", focus: "continue" };
    });
    t.after(h.dispose);
    if (withExisting) await h.driver.handleAutomaticGuidance();
    const previousId = h.state.activeConversationStreamId;
    h.state.screen = "main";
    h.editCode("const x = 42;");
    destination = withExisting ? "history" : "settings";
    await h.driver.handleAutomaticGuidance();
    assert.equal(h.state.screen, destination, "完了だけでは表示中の画面を奪わない");
    const target = h.state.guidanceCompletedStreamId!;
    assert.ok(target);
    assert.notEqual(target, previousId);
    assert.equal(h.store.list().length, withExisting ? 2 : 1);
    assert.equal(h.store.get(target)?.entries.length, 1);
    assert.equal(h.store.get(target)?.entries[0].text, "保存される回答");
    await (h.driver as unknown as { selectConversationStream(id: string): Promise<void> }).selectConversationStream(target);
    assert.equal(h.state.screen, "conversation");
    assert.equal(h.state.activeConversationStreamId, target);
    assert.equal(h.state.conversationHistory[0].text, "保存される回答");
  }
});

test("別画面の生成成功を通知し、次の失敗・停止では完了表示を再利用しない", async (t) => {
  for (const cancelled of [false, true]) {
    let calls = 0;
    const h = await lifecycleHarness(async () => ++calls === 1
      ? { ok: true, text: "助言", focus: "continue" }
      : { ok: false, cancelled, connectionState: "connected", message: "回答を表示できませんでした。" });
    t.after(h.dispose);
    h.state.screen = "settings";
    await h.driver.handleAutomaticGuidance();
    assert.equal(h.state.screen, "settings");
    assert.equal(h.state.guidanceCompleted, true);
    assert.equal(h.state.guidanceCompletionRevision, 1);
    h.editCode("const x = 2;");
    await h.driver.handleAutomaticGuidance();
    assert.equal(h.state.guidanceCompleted, false);
    assert.equal(h.state.guidanceCompletionRevision, 1);
    assert.equal(h.state.statusMessage?.scope, "guidance");
    assert.match(h.state.statusMessage?.text ?? "", cancelled ? /中断/ : /表示できません/);
  }
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
  h.context.selectedText = "const x = 1;";
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
  h.editCode("const x = 2;");
  await h.driver.handleAutomaticGuidance();
  assert.equal(h.state.screen, "advice_detail");
  assert.equal(h.state.selectedConversationId, selected);
  assert.equal(h.state.conversationHistory.length, 2);
  assert.equal(h.state.conversationHistory[1].tokenUsage?.outputTokens, 12);
  assert.match(h.store.get(h.state.activeConversationStreamId!)!.entries[1].text, /追加すべき内容はありませんでした/);
  h.editCode("const x = 3;");
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
    let documentSnapshot = "app.ts:v1";
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
      connectionService: { getProviderId: () => providerId, getState: () => "connected", getConnectedModel: () => ({ providerId, modelId: "test" }) },
      contextCollector: {
        collectPreview: () => state.contextPreview,
        collectGuidanceContext: () => context,
        collectAutomaticObservation: () => ({ triggerReasons: ["text_edit"], idleDurationMs: 12000,
          cursor: { line: 1, column: 13 }, cursorExcerpt: "const x = <<<NAVICOM_CURSOR>>>;", selectionPresent: false }),
        resetAutomaticDiagnosticsBaseline: () => {},
        automaticEditorSnapshot: () => editorSnapshot,
        automaticDocumentSnapshot: () => documentSnapshot
      },
      requestPlanner: new RequestPlanner(),
      requestPlanCoordinator: { externalize: (prepared: PreparedGuidanceRequest) => prepared },
      knowledgeStore: { findReusable: () => [] },
      conversationCoordinator: { ensureStreamForAutomaticResult: async () => state, setGuidanceContext: () => {} },
      providerRoutingCoordinator: new ProviderRoutingCoordinator({ getState: () => "connected" } as never, {} as never),
      conversationMemoryCoordinator: new ConversationMemoryCoordinator({ getConnectedModel: () => ({ providerId, profileSource: {} }) } as never, {} as never, {} as never),
      adviceService: { requestGuidance: async (input: GuidanceRequestInput) => {
        sent.push(input);
        if (editWhileResponding) { editorSnapshot = "app.ts:v3:1:15"; documentSnapshot = "app.ts:v3"; }
        return { ok: true, text: "確認の観点です。", focus: "continue" };
      } },
      patchSession: (patch: Partial<NavigatorSessionState>) => Object.assign(state, patch),
      rememberSelectionContext: (preview: unknown) => preview,
      getGuidanceAdditionalContext: () => undefined,
      collectGuidanceContextForDepth: async (_settings: NavigatorSettings, depth: AssistanceDepth) => {
        collected.push(depth);
        return context;
      },
      executeGuidanceRequest: async (factory: () => Promise<Options | undefined>, _automatic: boolean, onSuccess?: () => void) => {
        const options = await factory();
        const result = options ? await driver.runGuidanceRequest(options, state) : { ok: false };
        if (result.ok) onSuccess?.();
        return result;
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
    documentSnapshot = "app.ts:v2";
    editWhileResponding = true;
    await driver.handleAutomaticGuidance();
    assert.equal(sent.length, 3);
    assert.equal(state.conversationHistory.length, 2, "an answer for code edited during the response must not be displayed or saved");
  }
});
