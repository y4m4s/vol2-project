import * as vscode from "vscode";
import { SessionStore } from "./SessionStore";
import { ContextCollector } from "../services/ContextCollector";
import { AdviceService } from "../services/AdviceService";
import { AdviceScheduler } from "../services/AdviceScheduler";
import {
  ConversationStore,
  ConversationStreamRecord,
  DEFAULT_CONVERSATION_STREAM_TITLE,
  StoredConversationEntry
} from "../services/ConversationStore";
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
  additionalContext?: string;
}

export class NavigatorController implements vscode.Disposable {
  private readonly sessionStore: SessionStore;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();
  private readonly guidanceContextByConversationId = new Map<string, GuidanceContext>();
  private readonly summarizedConversationTitleStreamIds = new Set<string>();
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
    private readonly conversationStore: ConversationStore,
    private readonly knowledgeStore: KnowledgeStore
  ) {
    this.sessionStore = new SessionStore(this.createInitialState());

    this.disposables.push(
      this.sessionStore,
      this.adviceScheduler,
      this.conversationStore,
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
    await this.conversationStore.initialize();
    await this.knowledgeStore.initialize();
    await this.restoreConversationState();

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
      screen: this.resolveHomeScreen(this.connectionService.getState()),
      mode: settings.defaultMode
    });
    this.refreshContextPreview();
  }

  public getViewModel(): NavigatorViewModel {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    const currentRequestPlan = this.requestPlanner.prepareGuidanceRequest(
      this.withAdditionalContext(this.contextCollector.collectGuidanceContext(), this.getStreamAdditionalContext(state)),
      state.contextPreview,
      settings,
      state.mode === "always" ? "always" : "context"
    ).requestPlan;

    return {
      screen: state.screen,
      connectionState: state.connectionState,
      requestState: state.requestState,
      mode: state.mode,
      canConnect: state.requestState === "idle",
      canAskForGuidance: state.connectionState === "connected" && state.requestState === "idle",
      canSwitchMode: state.connectionState === "connected" && state.requestState === "idle",
      isBusy: state.requestState !== "idle",
      autoAdvice: this.adviceScheduler.getState(),
      statusMessage: state.statusMessage,
      contextPreview: state.contextPreview,
      latestGuidance: state.latestGuidance,
      conversationStreams: state.conversationStreams,
      activeConversationStreamId: state.activeConversationStreamId,
      conversationHistory: state.conversationHistory,
      selectedAdvice: this.buildSelectedAdvice(state),
      currentRequestPlan,
      settings,
      knowledgeItems: this.buildKnowledgeItems(state),
      selectedKnowledge: this.buildSelectedKnowledge(state),
      savedKnowledgeSourceIds: this.knowledgeStore.listSourceAdviceIds(),
      knowledgeQuery: state.knowledgeQuery
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
        statusMessage: undefined,
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

  public async createConversationStream(): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    await this.discardActiveConversationIfEmpty();
    const record = await this.conversationStore.createStream();
    await this.conversationStore.setActiveStream(record.id);
    this.lastAutomaticContextFingerprint = undefined;
    this.hydrateConversationStream(record, { screen: "conversation", resetNavigation: true, clearStatusMessage: true });
  }

  public async selectConversationStream(streamId: string): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle" || (state.activeConversationStreamId === streamId && state.screen === "conversation")) {
      return;
    }

    const record = this.conversationStore.get(streamId);
    if (!record) {
      return;
    }

    await this.conversationStore.setActiveStream(record.id);
    this.lastAutomaticContextFingerprint = undefined;
    this.hydrateConversationStream(record, { screen: "conversation", resetNavigation: true, clearStatusMessage: true });
  }

  public async deleteConversationStream(streamId: string): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    const deletingActiveStream = state.activeConversationStreamId === streamId;
    const deleted = await this.conversationStore.deleteStream(streamId);
    if (!deleted) {
      this.patchSession({
        conversationStreams: this.conversationStore.list()
      });
      return;
    }

    this.summarizedConversationTitleStreamIds.delete(streamId);
    if (deletingActiveStream) {
      this.guidanceContextByConversationId.clear();
    }
    this.patchSession({
      conversationStreams: this.conversationStore.list(),
      statusMessage: undefined,
      ...(deletingActiveStream
        ? {
            activeConversationStreamId: undefined,
            activeAdditionalContext: undefined,
            latestGuidance: undefined,
            conversationHistory: [],
            selectedConversationId: undefined,
            screen: state.screen === "conversation" ? this.resolveHomeScreen(state.connectionState) : state.screen
          }
        : {})
    });
  }

  public async askForGuidance(userPrompt?: string, kind?: GuidanceKind, additionalContext?: string): Promise<void> {
    const guidanceKind = kind ?? (userPrompt?.trim() ? "manual" : "context");
    if (guidanceKind === "context") {
      await this.executeGuidanceRequest(this.buildCurrentContextGuidanceOptions(userPrompt?.trim(), true, additionalContext));
      return;
    }

    await this.executeGuidanceRequest({
      kind: guidanceKind,
      userPrompt: userPrompt?.trim(),
      additionalContext: this.resolveAdditionalContext(additionalContext, this.getStreamAdditionalContext(this.sessionStore.getState()))
    });
  }

  public async askForGuidanceWithCurrentContext(userPrompt: string, additionalContext?: string): Promise<void> {
    await this.executeGuidanceRequest(this.buildCurrentContextGuidanceOptions(userPrompt.trim(), false, additionalContext));
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
    const state = this.sessionStore.getState();

    switch (screen) {
      case "onboarding":
        this.patchSession({ screen: "onboarding" });
        return;
      case "main":
        this.patchSession({
          screen: this.resolveHomeScreen(state.connectionState),
          selectedConversationId: undefined
        });
        return;
      case "history":
        this.pushScreen("history");
        return;
      case "conversation":
        this.patchSession({
          screen: state.activeConversationStreamId ? "conversation" : this.resolveHomeScreen(state.connectionState)
        });
        return;
      case "knowledge":
        this.pushScreen("knowledge");
        this.patchSession({
          selectedKnowledgeId: undefined
        });
        return;
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
    idleDelaySec: number;
    excludeGlobs: string;
  }): Promise<void> {
    const nextSettings: NavigatorSettings = {
      ...this.settingsService.getSettings(),
      defaultMode: input.defaultMode,
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
        statusMessage: undefined
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
      statusMessage: undefined
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
    this.patchSession({
      statusMessage: undefined
    });
  }

  public searchKnowledge(query: string): void {
    this.patchSession({
      knowledgeQuery: query,
      selectedKnowledgeId: undefined
    });
  }

  public selectKnowledge(id: string): void {
    const record = this.knowledgeStore.get(id);
    if (!record) {
      this.patchSession({
        selectedKnowledgeId: undefined,
        statusMessage: {
          kind: "warning",
          text: "表示するナレッジが見つかりません。"
        }
      });
      return;
    }

    const state = this.sessionStore.getState();
    this.patchSession({
      screen: "knowledge_detail",
      screenHistory: state.screen === "knowledge_detail" ? state.screenHistory : [...state.screenHistory, state.screen],
      selectedKnowledgeId: id,
      statusMessage: undefined
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
    const source = selected;

    if (!source) {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "保存できるアドバイスがまだありません。"
        }
      });
      return;
    }

    const existingKnowledge = this.knowledgeStore.getBySourceAdviceId(source.id);
    if (existingKnowledge) {
      this.patchSession({
        selectedKnowledgeId: existingKnowledge.id,
        statusMessage: {
          kind: "info",
          text: "このアドバイスはすでにナレッジ化されています。"
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
  }): Promise<void> {
    const updated = await this.knowledgeStore.update(input.id, {
      title: input.title,
      summary: input.summary,
      body: input.body
    });

    this.patchSession({
      selectedKnowledgeId: updated?.id,
      statusMessage: {
        kind: updated ? "info" : "warning",
        text: updated ? "ナレッジを保存しました。" : "更新対象のナレッジが見つかりません。"
      }
    });
  }

  public async deleteKnowledge(id: string): Promise<void> {
    const state = this.sessionStore.getState();
    const deleted = await this.knowledgeStore.delete(id);
    this.patchSession({
      selectedKnowledgeId: state.selectedKnowledgeId === id ? undefined : state.selectedKnowledgeId,
      ...(state.screen === "knowledge_detail" && state.selectedKnowledgeId === id ? { screen: "knowledge" as const } : {}),
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
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    const preview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      this.withAdditionalContext(this.contextCollector.collectGuidanceContext(), this.getStreamAdditionalContext(state)),
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
    requireContext: boolean,
    additionalContext?: string
  ): GuidanceExecutionOptions {
    const state = this.sessionStore.getState();
    const effectiveAdditionalContext = this.resolveAdditionalContext(additionalContext, this.getStreamAdditionalContext(state));
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
        preview: livePreview,
        additionalContext: effectiveAdditionalContext
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
      this.withAdditionalContext(rawContext, effectiveAdditionalContext),
      preview,
      settings,
      kind
    );

    return {
      kind,
      userPrompt,
      preview,
      prepared,
      additionalContext: effectiveAdditionalContext
    };
  }

  private async executeGuidanceRequest(options: GuidanceExecutionOptions): Promise<{ ok: boolean }> {
    let state = this.sessionStore.getState();
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

    state = await this.prepareConversationForGuidance(state, options.kind);

    const incomingAdditionalContext = this.normalizeAdditionalContext(options.additionalContext);
    const effectiveAdditionalContext = this.resolveAdditionalContext(incomingAdditionalContext, this.getStreamAdditionalContext(state));
    if (incomingAdditionalContext && incomingAdditionalContext !== state.activeAdditionalContext) {
      state = {
        ...state,
        activeAdditionalContext: incomingAdditionalContext
      };
    }

    const settings = this.settingsService.getSettings();
    const preview = options.preview ?? this.rememberSelectionContext(this.contextCollector.collectPreview());
    const prepared =
      options.prepared ??
      this.requestPlanner.prepareGuidanceRequest(
        this.withAdditionalContext(
          this.contextCollector.collectGuidanceContext(),
          effectiveAdditionalContext
        ),
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
      screen:
        options.kind === "always" || options.kind === "deep_dive"
          ? state.screen
          : "conversation",
      contextPreview: contextPreviewAfterCapture,
      conversationHistory: nextHistory,
      ...(incomingAdditionalContext ? { activeAdditionalContext: incomingAdditionalContext } : {}),
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
    const latestState = this.sessionStore.getState();

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
        screen: this.resolveScreenAfterSuccess(options.kind, latestState.screen),
        contextPreview: refreshedPreview,
        latestGuidance: this.createGuidanceCard(assistantEntry),
        conversationHistory: updatedHistory,
        selectedConversationId: this.resolveSelectedConversationIdAfterSuccess(options.kind, latestState, assistantEntry.id),
        statusMessage: undefined
      });
      await this.persistActiveConversationState();
      return { ok: true };
    }

    const nextConnectionState = result.connectionState;
    const nextMode = options.kind === "always" ? "manual" : latestState.mode;

    this.patchSession({
      connectionState: nextConnectionState,
      requestState: "idle",
      screen: this.resolveScreenAfterFailure(
        options.kind,
        latestState.screen,
        nextConnectionState,
        Boolean(latestState.latestGuidance)
      ),
      mode: nextMode,
      contextPreview: refreshedPreview,
      conversationHistory: nextHistory,
      ...(incomingAdditionalContext ? { activeAdditionalContext: incomingAdditionalContext } : {}),
      statusMessage: {
        kind: "error",
        text:
          options.kind === "always"
            ? `${result.message} 自動助言は停止し、必要時モードに戻しました。`
            : result.message
      }
    });
    await this.persistActiveConversationState();
    return { ok: false };
  }

  private refreshContextPreview(): void {
    this.patchSession({
      contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview())
    });
  }

  private async restoreConversationState(): Promise<void> {
    const existingStream = this.resolveInitialConversationStream();
    if (!existingStream) {
      this.patchSession({
        conversationStreams: this.conversationStore.list(),
        activeConversationStreamId: undefined,
        latestGuidance: undefined,
        conversationHistory: [],
        selectedConversationId: undefined
      });
      return;
    }

    this.hydrateConversationStream(existingStream);
  }

  private resolveInitialConversationStream(): ConversationStreamRecord | undefined {
    const activeStreamId = this.conversationStore.getActiveStreamId();
    if (activeStreamId) {
      const activeStream = this.conversationStore.get(activeStreamId);
      if (activeStream) {
        return activeStream;
      }
    }

    const latestStream = this.conversationStore.list()[0];
    return latestStream ? this.conversationStore.get(latestStream.id) : undefined;
  }

  private async prepareConversationForGuidance(
    state: NavigatorSessionState,
    kind: GuidanceKind
  ): Promise<NavigatorSessionState> {
    if (kind === "always") {
      if (state.screen === "main") {
        return this.createNewActiveConversationStream();
      }

      return this.ensureActiveConversationStream();
    }

    if (kind !== "deep_dive" && state.screen === "main") {
      return this.createNewActiveConversationStream();
    }

    if (state.activeConversationStreamId) {
      return state;
    }

    return this.ensureActiveConversationStream();
  }

  private async createNewActiveConversationStream(): Promise<NavigatorSessionState> {
    await this.discardActiveConversationIfEmpty();
    const record = await this.conversationStore.createStream();
    await this.conversationStore.setActiveStream(record.id);
    this.lastAutomaticContextFingerprint = undefined;
    this.hydrateConversationStream(record);
    return this.sessionStore.getState();
  }

  private async ensureActiveConversationStream(): Promise<NavigatorSessionState> {
    const state = this.sessionStore.getState();
    if (state.activeConversationStreamId) {
      return state;
    }

    const existingStream = this.resolveInitialConversationStream();
    if (existingStream) {
      await this.conversationStore.setActiveStream(existingStream.id);
      this.hydrateConversationStream(existingStream);
      return this.sessionStore.getState();
    }

    const record = await this.conversationStore.createStream();
    await this.conversationStore.setActiveStream(record.id);
    this.lastAutomaticContextFingerprint = undefined;
    this.hydrateConversationStream(record);
    return this.sessionStore.getState();
  }

  private hydrateConversationStream(
    record: ConversationStreamRecord,
    options: {
      screen?: NavigatorScreen;
      resetNavigation?: boolean;
      clearStatusMessage?: boolean;
    } = {}
  ): void {
    this.guidanceContextByConversationId.clear();
    const conversationHistory = this.toConversationHistory(record.entries);
    const latestAssistant = this.findLatestAssistant(conversationHistory);

    this.patchSession({
      conversationStreams: this.conversationStore.list(),
      activeConversationStreamId: record.id,
      activeAdditionalContext: record.additionalContext,
      latestGuidance: latestAssistant ? this.createGuidanceCard(latestAssistant) : undefined,
      conversationHistory,
      selectedConversationId: undefined,
      ...(options.screen ? { screen: options.screen } : {}),
      ...(options.resetNavigation ? { screenHistory: [] } : {}),
      ...(options.clearStatusMessage ? { statusMessage: undefined } : {})
    });
  }

  private async persistActiveConversationState(): Promise<void> {
    const record = this.buildActiveConversationRecord();
    if (!record) {
      return;
    }

    if (record.entries.length === 0) {
      await this.conversationStore.deleteStream(record.id);
      this.patchSession({
        activeConversationStreamId: undefined,
        activeAdditionalContext: undefined,
        conversationStreams: this.conversationStore.list(),
        latestGuidance: undefined,
        conversationHistory: [],
        selectedConversationId: undefined
      });
      return;
    }

    const recordToSave = await this.withSummarizedConversationTitle(record);
    const saved = await this.conversationStore.saveStream(recordToSave);
    this.patchSession({
      activeConversationStreamId: saved.id,
      activeAdditionalContext: saved.additionalContext,
      conversationStreams: this.conversationStore.list()
    });
  }

  private async discardActiveConversationIfEmpty(): Promise<void> {
    const state = this.sessionStore.getState();
    const streamId = state.activeConversationStreamId ?? this.conversationStore.getActiveStreamId();
    if (!streamId) {
      return;
    }

    const existing = this.conversationStore.get(streamId);
    if (!existing || existing.entries.length > 0) {
      return;
    }

    if (state.activeConversationStreamId === streamId && state.conversationHistory.length > 0) {
      return;
    }

    await this.conversationStore.deleteStream(streamId);
    if (state.activeConversationStreamId === streamId) {
      this.patchSession({
        activeConversationStreamId: undefined,
        activeAdditionalContext: undefined,
        conversationStreams: this.conversationStore.list(),
        latestGuidance: undefined,
        conversationHistory: [],
        selectedConversationId: undefined
      });
    }
  }

  private async withSummarizedConversationTitle(record: ConversationStreamRecord): Promise<ConversationStreamRecord> {
    if (
      this.summarizedConversationTitleStreamIds.has(record.id) ||
      this.connectionService.getState() !== "connected"
    ) {
      return record;
    }

    const fallbackTitle = this.resolveConversationStreamTitle(undefined, record.entries);
    const shouldSummarize =
      !record.title ||
      record.title === DEFAULT_CONVERSATION_STREAM_TITLE ||
      record.title === fallbackTitle;

    if (!shouldSummarize) {
      return record;
    }

    const title = await this.adviceService.createConversationTitle({ entries: record.entries });
    if (!title) {
      return record;
    }

    this.summarizedConversationTitleStreamIds.add(record.id);
    return {
      ...record,
      title
    };
  }

  private buildActiveConversationRecord(): ConversationStreamRecord | undefined {
    const state = this.sessionStore.getState();
    const streamId = state.activeConversationStreamId;
    if (!streamId) {
      return undefined;
    }

    const existing = this.conversationStore.get(streamId);
    const now = new Date().toISOString();
    const entries = this.toStoredConversationEntries(state.conversationHistory);

    return {
      id: streamId,
      title: this.resolveConversationStreamTitle(existing?.title, state.conversationHistory),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
      entries,
      additionalContext: this.normalizeAdditionalContext(state.activeAdditionalContext ?? existing?.additionalContext)
    };
  }

  private toConversationHistory(entries: StoredConversationEntry[]): ConversationEntry[] {
    return entries.map((entry) => {
      if (entry.guidanceContext) {
        this.guidanceContextByConversationId.set(entry.id, entry.guidanceContext);
      }

      const { guidanceContext, ...conversationEntry } = entry;
      return conversationEntry;
    });
  }

  private toStoredConversationEntries(entries: ConversationEntry[]): StoredConversationEntry[] {
    return entries.map((entry) => ({
      ...entry,
      guidanceContext: this.guidanceContextByConversationId.get(entry.id)
    }));
  }

  private resolveConversationStreamTitle(currentTitle: string | undefined, history: ConversationEntry[]): string {
    if (currentTitle && currentTitle !== DEFAULT_CONVERSATION_STREAM_TITLE) {
      return currentTitle;
    }

    for (const entry of history) {
      const candidate = this.buildConversationStreamTitleCandidate(entry);
      if (candidate) {
        return candidate;
      }
    }

    return currentTitle ?? DEFAULT_CONVERSATION_STREAM_TITLE;
  }

  private buildConversationStreamTitleCandidate(entry: ConversationEntry): string | undefined {
    if (entry.role === "user") {
      if (entry.kind === "manual") {
        return this.normalizeConversationStreamTitle(entry.text);
      }

      if (entry.kind === "context") {
        return this.normalizeConversationStreamTitle(entry.basedOn?.selectedTextPreview);
      }
    }

    if (entry.role === "assistant") {
      return this.normalizeConversationStreamTitle(entry.text);
    }

    return undefined;
  }

  private normalizeConversationStreamTitle(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const firstMeaningfulLine = value
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").trim())
      .find((line) => line.length > 0);

    if (!firstMeaningfulLine) {
      return undefined;
    }

    return firstMeaningfulLine.length <= 60
      ? firstMeaningfulLine
      : `${firstMeaningfulLine.slice(0, 60)}...`;
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
      return "conversation";
    }

    if (kind === "always") {
      return currentScreen === "main" ? "conversation" : currentScreen;
    }

    if (this.shouldKeepUtilityScreen(currentScreen)) {
      return currentScreen;
    }

    return "conversation";
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

    if (kind === "deep_dive") {
      return currentScreen;
    }

    if (kind === "always" && connectionState === "restricted" && hasLatestGuidance) {
      return "main";
    }

    if (kind !== "always") {
      if (this.shouldKeepUtilityScreen(currentScreen)) {
        return currentScreen;
      }

      return "conversation";
    }

    return this.resolveHomeScreen(connectionState);
  }

  private shouldKeepUtilityScreen(screen: NavigatorScreen): boolean {
    return screen === "history" || screen === "knowledge" || screen === "knowledge_detail" || screen === "settings";
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
            ? "Copilot に接続できません。GitHub Copilot Chat がインストール・サインイン済みか、included model（GPT-4.1 / GPT-5 mini / GPT-4o）が利用可能か確認してください。"
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
      query: state.knowledgeQuery
    }).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      updatedAt: item.updatedAt
    }));
  }

  private buildSelectedKnowledge(state: NavigatorSessionState): KnowledgeDetailViewData | undefined {
    const selected = state.selectedKnowledgeId ? this.knowledgeStore.get(state.selectedKnowledgeId) : undefined;
    if (!selected) {
      return undefined;
    }

    const sourceConversation = selected.sourceAdviceId
      ? this.conversationStore.findStreamByEntryId(selected.sourceAdviceId)
      : undefined;

    return {
      id: selected.id,
      title: selected.title,
      summary: selected.summary,
      body: selected.body,
      createdAt: selected.createdAt,
      updatedAt: selected.updatedAt,
      sourceConversation
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
        context.relatedSymbols.length > 0 ||
        context.additionalContext
    );
  }

  private withAdditionalContext(context: GuidanceContext, additionalContext?: string): GuidanceContext {
    const normalized = this.normalizeAdditionalContext(additionalContext);
    return normalized ? { ...context, additionalContext: normalized } : context;
  }

  private getStreamAdditionalContext(state: NavigatorSessionState): string | undefined {
    return state.screen === "main" ? undefined : state.activeAdditionalContext;
  }

  private resolveAdditionalContext(additionalContext: string | undefined, fallback?: string): string | undefined {
    return this.normalizeAdditionalContext(additionalContext ?? fallback);
  }

  private normalizeAdditionalContext(value?: string): string | undefined {
    const normalized = value?.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      return undefined;
    }

    return normalized.length <= 4000 ? normalized : `${normalized.slice(0, 4000)}...`;
  }

  private createAutomaticFingerprint(context: GuidanceContext): string {
    return JSON.stringify({
      file: context.activeFilePath,
      excerpt: context.activeFileExcerpt,
      selection: context.selectedText,
      diagnostics: context.diagnosticsSummary.map((item) => `${item.severity}:${item.line}:${item.message}`),
      recentEdits: context.recentEditsSummary,
      relatedSymbols: context.relatedSymbols,
      additionalContext: context.additionalContext
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
    const connectionState = this.connectionService.getState();

    return {
      screen: this.resolveHomeScreen(connectionState),
      screenHistory: [],
      connectionState,
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
      conversationStreams: [],
      conversationHistory: [],
      knowledgeQuery: "",
      activeAdditionalContext: undefined
    };
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

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
