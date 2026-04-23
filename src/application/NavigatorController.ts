import * as vscode from "vscode";
import { SessionStore } from "./SessionStore";
import { ContextCollector } from "../services/ContextCollector";
import { AdviceService } from "../services/AdviceService";
import { AdviceScheduler } from "../services/AdviceScheduler";
import { ConnectionService } from "../services/ConnectionService";
import { KnowledgeStore } from "../services/KnowledgeStore";
import { RequestPlanner, PreparedGuidanceRequest } from "../services/RequestPlanner";
import { SettingsService } from "../services/SettingsService";
import {
  AdviceDetailViewData,
  AdviceMode,
  AdviceTriggerReason,
  ConnectionState,
  ContextCategoryKey,
  ConversationEntry,
  GuidanceCard,
  GuidanceKind,
  GuidanceContext,
  KnowledgeDetailViewData,
  KnowledgeListItem,
  KnowledgeStatus,
  KnowledgeStatusFilter,
  NavigatorScreen,
  NavigatorSessionState,
  NavigatorSettings,
  NavigatorStatusMessage,
  NavigatorViewModel
} from "../shared/types";

const HOME_SCREENS: NavigatorScreen[] = ["onboarding", "main", "error"];
const SUPPRESS_DUPLICATE_AUTO_ADVICE = true;

interface GuidanceExecutionOptions {
  kind: GuidanceKind;
  userPrompt?: string;
  previousAssistantText?: string;
  prepared?: PreparedGuidanceRequest;
  preview?: NavigatorSessionState["contextPreview"];
  triggerReason?: AdviceTriggerReason;
}

export class NavigatorController implements vscode.Disposable {
  private readonly sessionStore: SessionStore;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();
  private readonly guidanceContextByConversationId = new Map<string, GuidanceContext>();
  private pendingSelectionContext?: GuidanceContext;
  private pendingSelectionPreview?: NavigatorSessionState["contextPreview"];
  private lastAutomaticContextFingerprint?: string;

  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly connectionService: ConnectionService,
    private readonly adviceService: AdviceService,
    private readonly adviceScheduler: AdviceScheduler,
    private readonly requestPlanner: RequestPlanner,
    private readonly settingsService: SettingsService,
    private readonly knowledgeStore: KnowledgeStore
  ) {
    this.sessionStore = new SessionStore(this.createInitialState());

    this.disposables.push(
      this.sessionStore,
      this.adviceScheduler,
      this.knowledgeStore,
      this.didChangeStateEmitter,
      this.sessionStore.onDidChangeState(() => {
        this.didChangeStateEmitter.fire();
      }),
      this.adviceScheduler.onDidChangeState(() => {
        this.didChangeStateEmitter.fire();
      }),
      this.adviceScheduler.onDidTriggerAdvice((event) => {
        void this.handleAutomaticGuidance(event.reason);
      })
    );
  }

  public async initialize(): Promise<void> {
    await this.knowledgeStore.initialize();

    const settings = this.settingsService.getSettings();
    this.contextCollector.primeDocuments(vscode.workspace.textDocuments);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.contextCollector.primeDocument(editor.document);
        }
        this.refreshContextPreview();
        if (editor) {
          this.adviceScheduler.handleActivity("editor_change");
        }
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.contextCollector.primeDocument(document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.contextCollector.releaseDocument(document.uri);
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.refreshContextPreview();
        if (event.selections.some((selection) => !selection.isEmpty)) {
          this.adviceScheduler.handleActivity("selection_change");
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.contextCollector.captureDocumentChange(event);

        if (this.isActiveDocument(event.document.uri)) {
          this.refreshContextPreview();
          this.adviceScheduler.handleActivity("text_edit");
        }
      }),
      vscode.languages.onDidChangeDiagnostics((event) => {
        if (this.hasActiveDocumentDiagnosticChange(event.uris)) {
          this.refreshContextPreview();
          this.adviceScheduler.handleActivity("diagnostics_change");
        }
      })
    );

    this.patchSession({
      mode: settings.defaultMode
    });
    this.refreshContextPreview();
  }

  public getViewModel(): NavigatorViewModel {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    const currentRequestPlan = this.requestPlanner.prepareGuidanceRequest(
      this.contextCollector.collectGuidanceContext(),
      state.contextPreview,
      settings,
      state.mode === "always" ? "always" : "context"
    ).requestPlan;

    return {
      screen: state.screen,
      connectionState: state.connectionState,
      mode: state.mode,
      canConnect: state.requestState === "idle",
      canAskForGuidance: state.connectionState === "connected" && state.requestState === "idle",
      canSwitchMode: state.connectionState === "connected" && state.requestState === "idle",
      isBusy: state.requestState !== "idle",
      autoAdvice: this.adviceScheduler.getState(),
      statusMessage: state.statusMessage,
      contextPreview: state.contextPreview,
      latestGuidance: state.latestGuidance,
      conversationHistory: state.conversationHistory,
      selectedAdvice: this.buildSelectedAdvice(state),
      currentRequestPlan,
      settings,
      knowledgeItems: this.buildKnowledgeItems(state),
      selectedKnowledge: this.buildSelectedKnowledge(state),
      knowledgeQuery: state.knowledgeQuery,
      knowledgeStatusFilter: state.knowledgeStatusFilter
    };
  }

  public async connectCopilot(): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    this.patchSession({
      requestState: "connecting",
      connectionState: "connecting",
      statusMessage: {
        kind: "info",
        text: "Copilot への接続を確認しています..."
      }
    });

    const connectionState = await this.connectionService.connect();
    const settings = this.settingsService.getSettings();
    const nextMode = settings.defaultMode;

    if (connectionState === "connected") {
      this.patchSession({
        connectionState,
        requestState: "idle",
        screen: "main",
        mode: nextMode,
        statusMessage: {
          kind: "info",
          text:
            nextMode === "always"
              ? "Copilot に接続しました。常時モードで編集中の内容を見ながら自動助言します。"
              : "Copilot に接続しました。現在の文脈で手動ガイダンスを利用できます。"
        },
        contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview())
      });
      return;
    }

    this.patchSession({
      connectionState,
      requestState: "idle",
      screen: this.resolveHomeScreen(connectionState),
      statusMessage: this.buildConnectionStatusMessage(connectionState)
    });
  }

  public async askForGuidance(userPrompt?: string, kind?: GuidanceKind): Promise<void> {
    const guidanceKind = kind ?? (userPrompt?.trim() ? "manual" : "context");
    if (guidanceKind === "context") {
      await this.executeGuidanceRequest(this.buildCurrentContextGuidanceOptions(userPrompt?.trim(), true));
      return;
    }

    await this.executeGuidanceRequest({
      kind: guidanceKind,
      userPrompt: userPrompt?.trim()
    });
  }

  public async askForGuidanceWithCurrentContext(userPrompt: string): Promise<void> {
    await this.executeGuidanceRequest(this.buildCurrentContextGuidanceOptions(userPrompt.trim(), false));
  }

  public async deepDiveSelectedAdvice(): Promise<void> {
    const selected = this.findSelectedConversation(this.sessionStore.getState());
    if (!selected) {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "深掘りするアドバイスを先に選択してください。"
        }
      });
      return;
    }

    await this.executeGuidanceRequest({
      kind: "deep_dive",
      userPrompt: "直前のアドバイスをもう少し具体的に説明してください。",
      previousAssistantText: selected.text
    });
  }

  public selectConversation(conversationId: string): void {
    const entry = this.sessionStore.getState().conversationHistory.find((item) => item.id === conversationId && item.role === "assistant");
    if (!entry) {
      return;
    }

    this.pushScreen("advice_detail");
    this.patchSession({
      selectedConversationId: conversationId
    });
  }

  public navigate(screen: NavigatorScreen): void {
    switch (screen) {
      case "onboarding":
        this.patchSession({ screen: "onboarding" });
        return;
      case "main":
        this.patchSession({ screen: this.resolveHomeScreen(this.sessionStore.getState().connectionState) });
        return;
      case "knowledge":
      case "settings":
        this.pushScreen(screen);
        return;
      default:
        return;
    }
  }

  public navigateBack(): void {
    const state = this.sessionStore.getState();
    if (state.screenHistory.length === 0) {
      this.patchSession({
        screen: this.resolveHomeScreen(state.connectionState)
      });
      return;
    }

    const nextHistory = [...state.screenHistory];
    const previousScreen = nextHistory.pop() ?? this.resolveHomeScreen(state.connectionState);
    this.patchSession({
      screen: previousScreen,
      screenHistory: nextHistory
    });
  }

  public async saveSettings(input: {
    defaultMode: AdviceMode;
    requestIntervalSec: number;
    idleDelaySec: number;
    excludeGlobs: string;
  }): Promise<void> {
    const nextSettings: NavigatorSettings = {
      ...this.settingsService.getSettings(),
      defaultMode: input.defaultMode,
      requestIntervalMs: input.requestIntervalSec * 1000,
      idleDelayMs: input.idleDelaySec * 1000,
      excludedGlobs: input.excludeGlobs
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    };

    await this.settingsService.saveSettings(nextSettings);

    this.patchSession({
      contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview()),
      statusMessage: {
        kind: "info",
        text: "設定を保存しました。"
      }
    });
  }

  public async resetSettings(): Promise<void> {
    await this.settingsService.resetSettings();
    this.patchSession({
      statusMessage: {
        kind: "info",
        text: "設定を初期値に戻しました。"
      }
    });
  }

  public async setMode(mode: AdviceMode): Promise<void> {
    if (mode === "manual") {
      this.patchSession({
        mode,
        statusMessage: {
          kind: "info",
          text: "必要時モードに切り替えました。"
        }
      });
      return;
    }

    if (this.connectionService.getState() !== "connected") {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "常時モードは Copilot 接続後に利用できます。"
        }
      });
      return;
    }

    this.adviceScheduler.resetPause();
    this.patchSession({
      mode,
      statusMessage: {
        kind: "info",
        text: "常時モードを開始しました。編集中の内容にあわせて自動助言します。"
      }
    });
  }

  public toggleAutoPause(): void {
    const state = this.sessionStore.getState();
    if (state.mode !== "always") {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "一時停止は常時モード中のみ利用できます。"
        }
      });
      return;
    }

    this.adviceScheduler.togglePaused();
    const paused = this.adviceScheduler.getState().paused;
    this.patchSession({
      statusMessage: {
        kind: "info",
        text: paused ? "常時モードを一時停止しました。" : "常時モードを再開しました。"
      }
    });
  }

  public searchKnowledge(query: string): void {
    this.patchSession({
      knowledgeQuery: query,
      selectedKnowledgeId: undefined
    });
  }

  public filterKnowledge(filter: string): void {
    this.patchSession({
      knowledgeStatusFilter: this.normalizeKnowledgeFilter(filter),
      selectedKnowledgeId: undefined
    });
  }

  public selectKnowledge(id: string): void {
    this.patchSession({
      selectedKnowledgeId: id
    });
  }

  public async exportKnowledge(): Promise<void> {
    const result = await this.knowledgeStore.exportToFiles();
    this.patchSession({
      statusMessage: {
        kind: "info",
        text: `${result.count}件のナレッジを JSON と Markdown にエクスポートしました。JSON: ${result.jsonPath} / Markdown: ${result.markdownPath}`
      }
    });
  }

  public async resetKnowledge(): Promise<void> {
    await this.knowledgeStore.reset();
    this.patchSession({
      selectedKnowledgeId: undefined,
      statusMessage: {
        kind: "info",
        text: "ナレッジをすべてリセットしました。"
      }
    });
  }

  public async saveKnowledge(conversationId?: string): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    const selected = conversationId
      ? state.conversationHistory.find((item) => item.id === conversationId && item.role === "assistant")
      : this.findSelectedConversation(state) ?? this.findLatestAssistant(state.conversationHistory);
    const latestGuidanceSource =
      conversationId && state.latestGuidance?.id === conversationId
        ? {
            id: state.latestGuidance.id,
            role: "assistant" as const,
            text: state.latestGuidance.text,
            createdAt: state.latestGuidance.requestedAt,
            kind: state.latestGuidance.requestPlan.kind,
            basedOn: state.latestGuidance.basedOn,
            mode: state.latestGuidance.mode,
            requestPlan: state.latestGuidance.requestPlan
          }
        : undefined;
    const source = selected ?? latestGuidanceSource;

    if (!source) {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "保存できるアドバイスがまだありません。"
        }
      });
      return;
    }

    this.patchSession({
      requestState: "saving_knowledge",
      statusMessage: {
        kind: "info",
        text: "Copilot でアドバイスをナレッジ用に整理しています..."
      }
    });

    const draftResult = await this.adviceService.createKnowledgeDraft({
      source: {
        ...source,
        context: this.guidanceContextByConversationId.get(source.id)
      },
      conversation: this.buildKnowledgeConversationWindow(state, source)
    });

    if (!draftResult.ok) {
      this.patchSession({
        requestState: "idle",
        connectionState: draftResult.connectionState,
        statusMessage: {
          kind: draftResult.connectionState === "restricted" || draftResult.connectionState === "unavailable" ? "error" : "warning",
          text: draftResult.message
        }
      });
      return;
    }

    const record = await this.knowledgeStore.create({
      title: draftResult.draft.title,
      summary: draftResult.draft.summary,
      body: draftResult.draft.body,
      tags: [...draftResult.draft.tags, ...this.createKnowledgeTags(source)],
      sourceAdviceId: source.id
    });

    this.patchSession({
      requestState: "idle",
      ...(conversationId ? {} : { screen: "knowledge" as const }),
      selectedKnowledgeId: record.id,
      statusMessage: {
        kind: "info",
        text: "アドバイスを整理してナレッジとして保存しました。"
      }
    });
  }

  public async updateKnowledge(input: {
    id: string;
    title: string;
    summary: string;
    body: string;
    status: KnowledgeStatus;
    tags: string;
  }): Promise<void> {
    const updated = await this.knowledgeStore.update(input.id, {
      title: input.title,
      summary: input.summary,
      body: input.body,
      status: input.status,
      tags: this.parseKnowledgeTags(input.tags)
    });

    this.patchSession({
      selectedKnowledgeId: updated?.id,
      statusMessage: {
        kind: updated ? "info" : "warning",
        text: updated ? "ナレッジを保存しました。" : "更新対象のナレッジが見つかりません。"
      }
    });
  }

  public async toggleKnowledgeStatus(id: string): Promise<void> {
    const record = this.knowledgeStore.get(id);
    if (!record) {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "状態を切り替えるナレッジが見つかりません。"
        }
      });
      return;
    }

    const nextStatus: KnowledgeStatus = record.status === "active" ? "disabled" : "active";
    const updated = await this.knowledgeStore.setStatus(id, nextStatus);
    this.patchSession({
      selectedKnowledgeId: updated?.id,
      statusMessage: {
        kind: "info",
        text: nextStatus === "active" ? "ナレッジを有効化しました。" : "ナレッジを無効化しました。"
      }
    });
  }

  public async deleteKnowledge(id: string): Promise<void> {
    const deleted = await this.knowledgeStore.delete(id);
    this.patchSession({
      selectedKnowledgeId: undefined,
      statusMessage: {
        kind: deleted ? "info" : "warning",
        text: deleted ? "ナレッジを削除しました。" : "削除対象のナレッジが見つかりません。"
      }
    });
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleAutomaticGuidance(reason: AdviceTriggerReason): Promise<void> {
    const settings = this.settingsService.getSettings();
    const preview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      this.contextCollector.collectGuidanceContext(),
      preview,
      settings,
      "always"
    );

    if (!this.hasMeaningfulContext(prepared.context)) {
      this.patchSession({
        contextPreview: preview
      });
      return;
    }

    const fingerprint = this.createAutomaticFingerprint(prepared.context);
    if (SUPPRESS_DUPLICATE_AUTO_ADVICE && fingerprint === this.lastAutomaticContextFingerprint) {
      this.patchSession({
        contextPreview: preview,
        statusMessage: {
          kind: "info",
          text: "類似した文脈のため、自動アドバイスを今回は控えました。"
        }
      });
      return;
    }

    const result = await this.executeGuidanceRequest({
      kind: "always",
      prepared,
      preview,
      triggerReason: reason
    });

    if (result.ok) {
      this.lastAutomaticContextFingerprint = fingerprint;
    }
  }

  private buildCurrentContextGuidanceOptions(
    userPrompt: string | undefined,
    requireContext: boolean
  ): GuidanceExecutionOptions {
    const state = this.sessionStore.getState();
    const livePreview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const liveContext = this.contextCollector.collectGuidanceContext();
    const stickySelectionAvailable = Boolean(
      state.contextPreview.selectedTextPreview &&
        this.pendingSelectionContext?.selectedText &&
        this.pendingSelectionPreview?.selectedTextPreview
    );
    const hasSelection = Boolean(liveContext.selectedText) || stickySelectionAvailable;
    const kind: GuidanceKind = requireContext || hasSelection ? "context" : "manual";

    if (kind !== "context") {
      return {
        kind,
        userPrompt,
        preview: livePreview
      };
    }

    const preview = liveContext.selectedText
      ? livePreview
      : stickySelectionAvailable
        ? this.pendingSelectionPreview!
        : livePreview;
    const rawContext = liveContext.selectedText
      ? liveContext
      : stickySelectionAvailable
        ? this.pendingSelectionContext!
        : liveContext;
    const settings = this.settingsService.getSettings();
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      rawContext,
      preview,
      settings,
      kind
    );

    return {
      kind,
      userPrompt,
      preview,
      prepared
    };
  }

  private async executeGuidanceRequest(options: GuidanceExecutionOptions): Promise<{ ok: boolean }> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return { ok: false };
    }

    if (this.connectionService.getState() !== "connected") {
      if (options.kind !== "always") {
        this.patchSession({
          connectionState: this.connectionService.getState(),
          statusMessage: {
            kind: "warning",
            text: "先に Copilot へ接続してください。"
          }
        });
      }
      return { ok: false };
    }

    const settings = this.settingsService.getSettings();
    const preview = options.preview ?? this.rememberSelectionContext(this.contextCollector.collectPreview());
    const prepared =
      options.prepared ??
      this.requestPlanner.prepareGuidanceRequest(
        this.contextCollector.collectGuidanceContext(),
        preview,
        settings,
        options.kind
      );
    this.clearSelectionAfterContextCapture(options.kind, prepared.context);
    const contextPreviewAfterCapture =
      options.kind === "context" && prepared.context.selectedText
        ? this.clearSelectionPreview(preview)
        : preview;

    const nextHistory = [...state.conversationHistory];
    const userEntryText = this.resolveUserEntryText(options.kind, options.userPrompt);
    if (userEntryText) {
      nextHistory.push(this.createConversationEntry("user", userEntryText, options.kind, preview));
    }

    this.patchSession({
      requestState: "requesting_guidance",
      connectionState: this.connectionService.getState(),
      screen: options.kind === "always" ? state.screen : "main",
      contextPreview: contextPreviewAfterCapture,
      conversationHistory: nextHistory,
      statusMessage: {
        kind: "info",
        text: this.buildPendingGuidanceMessage(options.kind, options.triggerReason)
      }
    });

    const result = await this.adviceService.requestGuidance({
      context: prepared.context,
      kind: options.kind,
      userPrompt: options.userPrompt?.trim(),
      previousAssistantText: options.previousAssistantText,
      knowledgeItems: this.knowledgeStore.findReusable(prepared.context)
    });

    const rawRefreshedPreview = this.contextCollector.collectPreview();
    const refreshedPreview =
      options.kind === "context" && prepared.context.selectedText
        ? this.clearSelectionPreview(rawRefreshedPreview)
        : this.rememberSelectionContext(rawRefreshedPreview);

    if (result.ok) {
      const assistantEntry = this.createConversationEntry(
        "assistant",
        result.text,
        options.kind,
        preview,
        state.mode,
        prepared.requestPlan
      );
      this.guidanceContextByConversationId.set(assistantEntry.id, prepared.context);
      const updatedHistory = [...nextHistory, assistantEntry];

      this.patchSession({
        connectionState: this.connectionService.getState(),
        requestState: "idle",
        screen: this.resolveScreenAfterSuccess(options.kind, state.screen),
        contextPreview: refreshedPreview,
        latestGuidance: this.createGuidanceCard(assistantEntry),
        conversationHistory: updatedHistory,
        selectedConversationId: this.resolveSelectedConversationIdAfterSuccess(options.kind, state, assistantEntry.id),
        statusMessage: undefined
      });
      return { ok: true };
    }

    const nextConnectionState = result.connectionState;
    const nextMode = options.kind === "always" ? "manual" : state.mode;

    this.patchSession({
      connectionState: nextConnectionState,
      requestState: "idle",
      screen: this.resolveScreenAfterFailure(options.kind, state.screen, nextConnectionState, Boolean(state.latestGuidance)),
      mode: nextMode,
      contextPreview: refreshedPreview,
      conversationHistory: nextHistory,
      statusMessage: {
        kind: "error",
        text:
          options.kind === "always"
            ? `${result.message} 自動助言は停止し、必要時モードに戻しました。`
            : result.message
      }
    });
    return { ok: false };
  }

  private refreshContextPreview(): void {
    this.patchSession({
      contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview())
    });
  }

  private patchSession(partial: Partial<NavigatorSessionState>): void {
    this.sessionStore.patch(partial);
    this.configureScheduler();
  }

  private configureScheduler(): void {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    this.adviceScheduler.configure(
      {
        requestIntervalMs: settings.requestIntervalMs,
        idleDelayMs: settings.idleDelayMs
      },
      {
        mode: state.mode,
        connectionState: state.connectionState,
        requestState: state.requestState
      }
    );
  }

  private clearSelectionAfterContextCapture(kind: GuidanceKind, context: GuidanceContext): void {
    if (kind !== "context" || !context.selectedText) {
      return;
    }

    this.pendingSelectionContext = undefined;
    this.pendingSelectionPreview = undefined;

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return;
    }

    const position = editor.selection.active;
    editor.selection = new vscode.Selection(position, position);
  }

  private rememberSelectionContext(
    preview: NavigatorSessionState["contextPreview"]
  ): NavigatorSessionState["contextPreview"] {
    if (!preview.selectedTextPreview) {
      return preview;
    }

    const context = this.contextCollector.collectGuidanceContext();
    if (context.selectedText) {
      this.pendingSelectionContext = context;
      this.pendingSelectionPreview = preview;
    }

    return preview;
  }

  private clearSelectionPreview(
    preview: NavigatorSessionState["contextPreview"]
  ): NavigatorSessionState["contextPreview"] {
    return {
      ...preview,
      selectedTextPreview: undefined
    };
  }

  private pushScreen(screen: NavigatorScreen): void {
    const state = this.sessionStore.getState();
    this.patchSession({
      screen,
      screenHistory: [...state.screenHistory, state.screen]
    });
  }

  private resolveHomeScreen(connectionState: ConnectionState): NavigatorScreen {
    switch (connectionState) {
      case "connected":
        return "main";
      case "restricted":
        return this.sessionStore.getState().latestGuidance ? "main" : "error";
      case "unavailable":
        return "error";
      case "connecting":
      case "consent_pending":
      case "disconnected":
      default:
        return "onboarding";
    }
  }

  private resolveScreenAfterSuccess(kind: GuidanceKind, currentScreen: NavigatorScreen): NavigatorScreen {
    if (kind === "deep_dive") {
      return "advice_detail";
    }

    if (kind === "always") {
      return currentScreen;
    }

    return "main";
  }

  private resolveSelectedConversationIdAfterSuccess(
    kind: GuidanceKind,
    state: NavigatorSessionState,
    assistantEntryId: string
  ): string | undefined {
    if (kind === "always" && state.screen === "advice_detail") {
      return state.selectedConversationId;
    }

    return assistantEntryId;
  }

  private resolveScreenAfterFailure(
    kind: GuidanceKind,
    currentScreen: NavigatorScreen,
    connectionState: ConnectionState,
    hasLatestGuidance: boolean
  ): NavigatorScreen {
    if (kind === "always" && !HOME_SCREENS.includes(currentScreen)) {
      return currentScreen;
    }

    if (connectionState === "restricted" && hasLatestGuidance) {
      return "main";
    }

    return this.resolveHomeScreen(connectionState);
  }

  private buildConnectionStatusMessage(connectionState: ConnectionState): NavigatorStatusMessage {
    switch (connectionState) {
      case "disconnected":
        return {
          kind: "warning",
          text: "接続が完了しませんでした。Copilot の同意ダイアログを確認して再試行してください。"
        };
      case "unavailable":
        return {
          kind: "error",
          text: vscode.workspace.isTrusted
            ? "Copilot に接続できません。GitHub Copilot Chat がインストール・サインイン済みか、または月間利用上限（Free: 50回）に達していないか確認してください。"
            : "Workspace Trust が無効です。ワークスペースを信頼してから再試行してください。"
        };
      case "restricted":
        return {
          kind: "error",
          text: "現在は Copilot リクエストが制限されています。少し時間を置いて再接続してください。"
        };
      case "connecting":
      case "consent_pending":
        return {
          kind: "info",
          text: "Copilot への接続を続行しています..."
        };
      case "connected":
      default:
        return {
          kind: "info",
          text: "Copilot に接続しました。"
        };
    }
  }

  private buildPendingGuidanceMessage(kind: GuidanceKind, reason?: AdviceTriggerReason): string {
    switch (kind) {
      case "always":
        return `現在の作業文脈をもとに自動フィードバックを生成しています${reason ? ` (${this.describeTriggerReason(reason)})` : ""}...`;
      case "deep_dive":
        return "直前のアドバイスをもとに追加の観点を整理しています...";
      case "context":
        return "現在の作業文脈をもとにガイダンスを生成しています...";
      case "manual":
      default:
        return "質問内容と現在の作業文脈をもとにガイダンスを生成しています...";
    }
  }

  private describeTriggerReason(reason: AdviceTriggerReason): string {
    switch (reason) {
      case "text_edit":
        return "編集";
      case "selection_change":
        return "選択範囲";
      case "editor_change":
        return "ファイル切替";
      case "diagnostics_change":
      default:
        return "診断変化";
    }
  }

  private createConversationEntry(
    role: "user" | "assistant",
    text: string,
    kind: GuidanceKind,
    basedOn?: NavigatorSessionState["contextPreview"],
    mode?: AdviceMode,
    requestPlan?: GuidanceCard["requestPlan"]
  ): ConversationEntry {
    return {
      id: this.createId(),
      role,
      text,
      createdAt: new Date().toISOString(),
      kind,
      basedOn,
      mode,
      requestPlan
    };
  }

  private createGuidanceCard(entry: ConversationEntry): GuidanceCard {
    return {
      id: entry.id,
      requestedAt: entry.createdAt,
      mode: entry.mode ?? "manual",
      text: entry.text,
      basedOn: entry.basedOn ?? { diagnosticsSummary: [] },
      requestPlan: entry.requestPlan ?? {
        kind: entry.kind,
        categories: [],
        targetFiles: [],
        excludedGlobs: [],
        estimatedSizeText: "0 B / 0カテゴリ"
      }
    };
  }

  private buildSelectedAdvice(state: NavigatorSessionState): AdviceDetailViewData | undefined {
    const selected = this.findSelectedConversation(state) ?? this.findLatestAssistant(state.conversationHistory);
    if (!selected) {
      return undefined;
    }

    const diagnosticsSummary =
      selected.basedOn?.diagnosticsSummary.length
        ? selected.basedOn.diagnosticsSummary.map((item) => `${item.severity} L${item.line}: ${item.message}`).join(" / ")
        : "診断情報はありません";

    return {
      id: selected.id,
      adviceBody: selected.text,
      speculativeNote: "参照文脈に基づいて整理した内容です。推測が含まれる可能性があります。",
      referenceFiles: selected.requestPlan?.targetFiles.filter((file) => file.included).map((file) => file.path) ?? [],
      diagnosticsSummary,
      changeSummary: this.describeCategory(selected.requestPlan?.categories, "recentEdits"),
      canDeepDive: this.connectionService.getState() === "connected"
    };
  }

  private describeCategory(categories: GuidanceCard["requestPlan"]["categories"] | undefined, key: ContextCategoryKey): string {
    const category = categories?.find((item) => item.key === key);
    if (!category) {
      return "情報はありません";
    }

    if (category.note) {
      return category.note;
    }

    return category.included ? "参照対象に含まれています" : "現在は参照対象に含まれていません";
  }

  private buildKnowledgeItems(state: NavigatorSessionState): KnowledgeListItem[] {
    return this.knowledgeStore.list({
      query: state.knowledgeQuery,
      status: state.knowledgeStatusFilter
    }).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      tags: item.tags,
      updatedAt: item.updatedAt
    }));
  }

  private buildSelectedKnowledge(state: NavigatorSessionState): KnowledgeDetailViewData | undefined {
    const selected = state.selectedKnowledgeId ? this.knowledgeStore.get(state.selectedKnowledgeId) : undefined;
    if (!selected) {
      return undefined;
    }

    return {
      id: selected.id,
      title: selected.title,
      summary: selected.summary,
      body: selected.body,
      status: selected.status,
      tags: selected.tags,
      sourceAdviceId: selected.sourceAdviceId,
      createdAt: selected.createdAt,
      updatedAt: selected.updatedAt
    };
  }

  private findSelectedConversation(state: NavigatorSessionState): ConversationEntry | undefined {
    if (!state.selectedConversationId) {
      return undefined;
    }

    return state.conversationHistory.find((item) => item.id === state.selectedConversationId && item.role === "assistant");
  }

  private findLatestAssistant(history: ConversationEntry[]): ConversationEntry | undefined {
    return [...history].reverse().find((item) => item.role === "assistant");
  }

  private buildKnowledgeConversationWindow(
    state: NavigatorSessionState,
    source: ConversationEntry
  ): ConversationEntry[] {
    const sourceIndex = state.conversationHistory.findIndex((item) => item.id === source.id);
    if (sourceIndex < 0) {
      return [source];
    }

    const start = Math.max(0, sourceIndex - 4);
    const end = Math.min(state.conversationHistory.length, sourceIndex + 3);
    return state.conversationHistory.slice(start, end);
  }

  private resolveUserEntryText(kind: GuidanceKind, userPrompt?: string): string | undefined {
    if (userPrompt?.trim() && kind !== "always") {
      return userPrompt.trim();
    }

    switch (kind) {
      case "context":
        return "この箇所を相談";
      case "deep_dive":
        return "直前のアドバイスを深掘りしたい";
      case "always":
      case "manual":
      default:
        return undefined;
    }
  }

  private hasMeaningfulContext(context: GuidanceContext): boolean {
    return Boolean(
      context.activeFileExcerpt ||
        context.selectedText ||
        context.diagnosticsSummary.length > 0 ||
        context.recentEditsSummary.length > 0 ||
        context.relatedSymbols.length > 0
    );
  }

  private createAutomaticFingerprint(context: GuidanceContext): string {
    return JSON.stringify({
      file: context.activeFilePath,
      excerpt: context.activeFileExcerpt,
      selection: context.selectedText,
      diagnostics: context.diagnosticsSummary.map((item) => `${item.severity}:${item.line}:${item.message}`),
      recentEdits: context.recentEditsSummary,
      relatedSymbols: context.relatedSymbols
    });
  }

  private isActiveDocument(uri: vscode.Uri): boolean {
    const activeDocument = vscode.window.activeTextEditor?.document;
    return Boolean(activeDocument && activeDocument.uri.toString() === uri.toString());
  }

  private hasActiveDocumentDiagnosticChange(uris: readonly vscode.Uri[]): boolean {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (!activeDocument) {
      return false;
    }

    return uris.some((uri) => uri.toString() === activeDocument.uri.toString());
  }

  private createInitialState(): NavigatorSessionState {
    return {
      screen: "onboarding",
      screenHistory: [],
      connectionState: this.connectionService.getState(),
      requestState: "idle",
      mode: "manual",
      autoAdvice: {
        enabled: false,
        paused: false,
        waitingForIdle: false,
        idleRemainingMs: 0,
        cooldownRemainingMs: 0
      },
      contextPreview: {
        diagnosticsSummary: []
      },
      conversationHistory: [],
      knowledgeQuery: "",
      knowledgeStatusFilter: "all"
    };
  }

  private normalizeKnowledgeFilter(filter: string): KnowledgeStatusFilter {
    switch (filter) {
      case "active":
      case "有効":
        return "active";
      case "disabled":
      case "無効":
        return "disabled";
      case "all":
      case "すべて":
      default:
        return "all";
    }
  }

  private parseKnowledgeTags(value: string): string[] {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  private createKnowledgeTitle(text: string): string {
    const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    if (!firstLine) {
      return "AIアドバイス";
    }

    return firstLine.length <= 64 ? firstLine : `${firstLine.slice(0, 64)}...`;
  }

  private createKnowledgeSummary(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length <= 160 ? normalized : `${normalized.slice(0, 160)}...`;
  }

  private createKnowledgeTags(
    entry: Pick<ConversationEntry, "kind" | "mode" | "requestPlan">
  ): string[] {
    return [
      entry.kind,
      entry.mode ?? "manual",
      ...(entry.requestPlan?.categories.filter((category) => category.included).map((category) => category.key) ?? [])
    ];
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
