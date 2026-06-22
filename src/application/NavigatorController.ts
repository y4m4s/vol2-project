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
import { UsageMeter } from "../services/UsageMeter";
import {
  AdviceMode,
  AiProviderId,
  AdviceTriggerReason,
  AssistanceDepth,
  ConnectionState,
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
  NavigatorViewModel,
  ProjectContextScope,
  SlashCommand,
  SlashCommandScope,
  UsageTodayViewData
} from "../shared/types";

const HOME_SCREENS: NavigatorScreen[] = ["onboarding", "main", "error"];
const SUPPRESS_DUPLICATE_AUTO_ADVICE = true;

interface GuidanceExecutionOptions {
  kind: GuidanceKind;
  userPrompt?: string;
  prepared?: PreparedGuidanceRequest;
  preview?: NavigatorSessionState["contextPreview"];
  triggerReason?: AdviceTriggerReason;
  additionalContext?: string;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
}

interface ParsedSlashInput {
  userPrompt?: string;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
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
  private initialized = false;

  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly connectionService: ConnectionService,
    private readonly adviceService: AdviceService,
    private readonly adviceScheduler: AdviceScheduler,
    private readonly requestPlanner: RequestPlanner,
    private readonly settingsService: SettingsService,
    private readonly conversationStore: ConversationStore,
    private readonly knowledgeStore: KnowledgeStore,
    private readonly usageMeter: UsageMeter
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
      }),
      vscode.lm.onDidChangeChatModels(() => {
        void this.refreshCopilotModelOptions();
      })
    );

    this.initialized = true;
    this.patchSession({
      screen: this.resolveHomeScreen(this.connectionService.getState()),
      mode: settings.defaultMode,
      assistanceDepth: settings.defaultAssistanceDepth
    });
    this.refreshContextPreview();
    void this.refreshCopilotModelOptions();
  }

  public getViewModel(): NavigatorViewModel {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    const currentRequestPlan = this.requestPlanner.prepareGuidanceRequest(
      this.withAdditionalContext(this.contextCollector.collectGuidanceContext(), this.getStreamAdditionalContext(state)),
      state.contextPreview,
      settings,
      state.mode === "always" ? "always" : "context",
      this.resolveEffectiveAssistanceDepth(state.mode === "always" ? "always" : "context", state.assistanceDepth)
    ).requestPlan;

    return {
      screen: state.screen,
      connectionState: state.connectionState,
      requestState: state.requestState,
      mode: state.mode,
      assistanceDepth: state.assistanceDepth,
      canConnect: state.requestState === "idle",
      canAskForGuidance: state.connectionState === "connected" && state.requestState === "idle",
      canSwitchMode: state.connectionState === "connected" && state.requestState === "idle",
      canSwitchAssistanceDepth: state.requestState === "idle",
      isBusy: state.requestState !== "idle",
      autoAdvice: this.adviceScheduler.getState(),
      usageToday: this.buildUsageToday(settings),
      providerId: settings.providerId,
      modelLabel: this.getCurrentModelLabel(),
      copilotModelOptions: this.connectionService.getModelOptions(),
      statusMessage: state.statusMessage,
      contextPreview: state.contextPreview,
      latestGuidance: state.latestGuidance,
      conversationStreams: state.conversationStreams,
      activeConversationStreamId: state.activeConversationStreamId,
      activeAdditionalContext: this.getVisibleAdditionalContext(state),
      conversationHistory: state.conversationHistory,
      currentRequestPlan,
      settings,
      knowledgeItems: this.initialized ? this.buildKnowledgeItems(state) : [],
      selectedKnowledge: this.initialized ? this.buildSelectedKnowledge(state) : undefined,
      savedKnowledgeSourceIds: this.initialized ? this.knowledgeStore.listSourceAdviceIds() : [],
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
      connectionState: "connecting"
    });

    const settings = this.settingsService.getSettings();
    const connectionState = await this.connectionService.connect(settings);
    const effectiveSettings = await this.applyLmStudioModelKeyChange(settings);
    const nextMode = effectiveSettings.defaultMode;
    const nextAssistanceDepth = effectiveSettings.defaultAssistanceDepth;

    if (connectionState === "connected") {
      this.patchSession({
        connectionState,
        requestState: "idle",
        screen: "main",
        mode: nextMode,
        assistanceDepth: nextAssistanceDepth,
        statusMessage: this.buildAutoModelFallbackStatusMessage(),
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
            screenHistory: state.screenHistory.filter(s => s !== "conversation" && s !== "advice_detail"),
            screen: state.screen === "conversation" ? this.resolveHomeScreen(state.connectionState) : state.screen
          }
        : {})
    });
  }

  public async askForGuidance(userPrompt?: string, kind?: GuidanceKind, additionalContext?: string): Promise<void> {
    const parsed = this.parseSlashInput(userPrompt);
    const guidanceKind = kind ?? (parsed.userPrompt ? "manual" : "context");
    if (guidanceKind === "context") {
      await this.executeGuidanceRequest(await this.buildCurrentContextGuidanceOptions(parsed.userPrompt, true, additionalContext, parsed.slashCommand, parsed.slashCommandScope));
      return;
    }

    await this.executeGuidanceRequest({
      kind: guidanceKind,
      userPrompt: parsed.userPrompt,
      additionalContext: additionalContext !== undefined
        ? additionalContext
        : this.resolveAdditionalContext(undefined, this.getStreamAdditionalContext(this.sessionStore.getState())),
      slashCommand: parsed.slashCommand,
      slashCommandScope: parsed.slashCommandScope
    });
  }

  public async askForGuidanceWithCurrentContext(userPrompt: string, additionalContext?: string): Promise<void> {
    const parsed = this.parseSlashInput(userPrompt);
    await this.executeGuidanceRequest(await this.buildCurrentContextGuidanceOptions(parsed.userPrompt, false, additionalContext, parsed.slashCommand, parsed.slashCommandScope));
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
          selectedConversationId: undefined,
          activeAdditionalContext: undefined,
          pendingAdditionalContext: undefined
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
    providerId: AiProviderId;
    defaultMode: AdviceMode;
    defaultAssistanceDepth: AssistanceDepth;
    copilotModelId?: string;
    lmStudioBaseUrl: string;
    lmStudioToken?: string;
    idleDelaySec: number;
    requestIntervalSec: number;
    dailyBudgetUsd: number;
    excludeGlobs: string;
  }): Promise<void> {
    const previousSettings = this.settingsService.getSettings();
    let lmStudioBaseUrl = previousSettings.lmStudioBaseUrl;
    if (input.providerId === "lmStudio") {
      try {
        lmStudioBaseUrl = this.connectionService.normalizeLmStudioBaseUrl(input.lmStudioBaseUrl);
      } catch {
        this.patchSession({
          statusMessage: { kind: "error", text: "LM Studio の接続先はローカルホストの URL を指定してください。" }
        });
        return;
      }
    }

    if (input.lmStudioToken?.trim()) {
      await this.connectionService.saveLmStudioToken(input.lmStudioToken);
    }

    const nextSettings: NavigatorSettings = {
      ...previousSettings,
      providerId: input.providerId,
      defaultMode: input.defaultMode,
      defaultAssistanceDepth: input.defaultAssistanceDepth,
      copilotModelId: input.copilotModelId,
      lmStudioBaseUrl,
      idleDelayMs: input.idleDelaySec * 1000,
      requestIntervalMs: input.requestIntervalSec * 1000,
      dailyBudgetUsd: input.dailyBudgetUsd,
      excludedGlobs: input.excludeGlobs
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    };

    const savedSettings = await this.settingsService.saveSettings(nextSettings);

    const isConnected = this.connectionService.getState() === "connected";
    const canApplyAlways = input.defaultMode !== "always" || isConnected;
    const modelSettingChanged =
      previousSettings.providerId !== savedSettings.providerId ||
      previousSettings.copilotModelId !== savedSettings.copilotModelId ||
      previousSettings.lmStudioBaseUrl !== savedSettings.lmStudioBaseUrl;
    const connectionSettingChanged = modelSettingChanged || Boolean(input.lmStudioToken?.trim());

    if (input.defaultMode === "always" && isConnected) {
      this.adviceScheduler.resetPause();
    }

    if (connectionSettingChanged && isConnected && this.sessionStore.getState().requestState === "idle") {
      this.patchSession({
        ...(canApplyAlways ? { mode: input.defaultMode } : {}),
        assistanceDepth: input.defaultAssistanceDepth,
        contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview())
      });
      await this.reconnectCopilotForModelSetting(savedSettings);
      return;
    }

    this.patchSession({
      ...(canApplyAlways ? { mode: input.defaultMode } : {}),
      assistanceDepth: input.defaultAssistanceDepth,
      contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview()),
      statusMessage: {
        kind: connectionSettingChanged && isConnected ? "warning" : "info",
        text: connectionSettingChanged && isConnected
          ? "設定を保存しました。使用モデルは現在のリクエスト完了後、次回接続時に反映されます。"
          : "設定を保存しました。"
      }
    });
  }

  public async resetSettings(): Promise<void> {
    const wasConnected = this.connectionService.getState() === "connected";
    const settings = await this.settingsService.resetSettings();
    this.patchSession({
      mode: "manual",
      assistanceDepth: "low",
      statusMessage: {
        kind: "info",
        text: "設定を初期値に戻しました。"
      }
    });

    if (wasConnected && this.sessionStore.getState().requestState === "idle") {
      await this.reconnectCopilotForModelSetting(settings);
    }
  }

  private async reconnectCopilotForModelSetting(settings: NavigatorSettings): Promise<void> {
    this.connectionService.resetToDisconnected();
    this.patchSession({
      requestState: "connecting",
      connectionState: "connecting",
      statusMessage: {
        kind: "info",
        text: "設定を保存し、使用モデルを切り替えています..."
      }
    });

    const connectionState = await this.connectionService.connect(settings);
    await this.applyLmStudioModelKeyChange(settings);
    if (connectionState === "connected") {
      const fallbackStatusMessage = this.buildAutoModelFallbackStatusMessage();
      this.patchSession({
        connectionState,
        requestState: "idle",
        contextPreview: this.rememberSelectionContext(this.contextCollector.collectPreview()),
        statusMessage: fallbackStatusMessage ?? {
          kind: "info",
          text: `設定を保存し、使用モデルを ${this.getCurrentModelLabel() ?? "指定モデル"} に切り替えました。`
        }
      });
      return;
    }

    this.patchSession({
      connectionState,
      requestState: "idle",
      statusMessage: this.buildConnectionStatusMessage(connectionState)
    });
  }

  public async setAssistanceDepth(assistanceDepth: AssistanceDepth): Promise<void> {
    if (this.sessionStore.getState().requestState !== "idle") {
      return;
    }

    await this.settingsService.saveSettings({
      ...this.settingsService.getSettings(),
      defaultAssistanceDepth: assistanceDepth
    });

    this.patchSession({
      assistanceDepth,
      statusMessage: undefined
    });
  }

  public async setMode(mode: AdviceMode, additionalContext?: string): Promise<void> {
    const isConnected = this.connectionService.getState() === "connected";
    if (mode === "always" && !isConnected) {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "常時モードは Copilot 接続後に利用できます。"
        }
      });
      return;
    }

    await this.settingsService.saveSettings({
      ...this.settingsService.getSettings(),
      defaultMode: mode
    });

    if (mode === "always") {
      this.adviceScheduler.resetPause();
    }

    const state = this.sessionStore.getState();
    const receivedAdditionalContext = additionalContext !== undefined;
    const normalizedAdditionalContext = this.normalizeAdditionalContext(additionalContext);

    this.patchSession({
      mode,
      ...(receivedAdditionalContext && state.screen === "main" && mode === "always"
        ? {
            activeAdditionalContext: normalizedAdditionalContext,
            pendingAdditionalContext: normalizedAdditionalContext
          }
        : {}),
      ...(receivedAdditionalContext && state.screen !== "main"
        ? { activeAdditionalContext: normalizedAdditionalContext }
        : {}),
      statusMessage: undefined
    });
  }

  public setComposerActive(active: boolean): void {
    this.adviceScheduler.setComposerActive(active);
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

  public setAdditionalContext(additionalContext: string): void {
    const state = this.sessionStore.getState();
    if (state.screen !== "main") {
      return;
    }
    this.patchSession({
      pendingAdditionalContext: this.normalizeAdditionalContext(additionalContext)
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

    const knowledgeModelLabel = source.modelLabel ?? this.getCurrentModelLabel();
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
      sourceAdviceId: source.id,
      providerId: source.providerId,
      modelId: source.modelId,
      modelLabel: knowledgeModelLabel
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

    if (this.usageMeter.isBudgetExceeded(this.getCurrentProviderId(), settings.dailyBudgetUsd)) {
      this.pauseAutoAdviceForBudget();
      return;
    }

    const preview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const additionalContext = this.getGuidanceAdditionalContext(state);
    const guidanceContext = await this.collectGuidanceContextForDepth(settings, "low");
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      this.withAdditionalContext(guidanceContext, additionalContext),
      preview,
      settings,
      "always",
      "low"
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
      triggerReason: reason,
      additionalContext,
      assistanceDepth: "low"
    });

    if (result.ok) {
      this.lastAutomaticContextFingerprint = fingerprint;
    }
  }

  private getModelIdentifier(): string | undefined {
    return this.connectionService.getConnectedModel()?.modelId;
  }

  private getCurrentProviderId(): AiProviderId {
    return this.settingsService.getSettings().providerId;
  }

  private buildUsageToday(settings: NavigatorSettings): UsageTodayViewData {
    const providerId = this.getCurrentProviderId();
    const usage = this.usageMeter.getToday(providerId);
    const cost = this.usageMeter.estimateCostUsd(providerId);

    return {
      date: usage.date,
      requestCount: usage.requestCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      estimatedCostText: cost > 0 && cost < 0.001 ? "$0.001未満" : `$${cost.toFixed(3)}`,
      blendedPricePerMTokenUsd: this.usageMeter.estimateBlendedPricePerMTokUsd(providerId),
      budgetUsd: settings.dailyBudgetUsd,
      budgetExceeded: this.usageMeter.isBudgetExceeded(providerId, settings.dailyBudgetUsd)
    };
  }

  private pauseAutoAdviceForBudget(): void {
    if (!this.adviceScheduler.getState().paused) {
      this.adviceScheduler.togglePaused();
    }

    this.patchSession({
      statusMessage: {
        kind: "warning",
        text: "本日の利用額が上限に達したため、自動助言を一時停止しました。設定から上限を変更できます。"
      }
    });
  }

  private async buildCurrentContextGuidanceOptions(
    userPrompt: string | undefined,
    requireContext: boolean,
    additionalContext?: string,
    slashCommand?: SlashCommand,
    slashCommandScope?: SlashCommandScope
  ): Promise<GuidanceExecutionOptions> {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    const receivedAdditionalContext = additionalContext !== undefined;
    const effectiveAdditionalContext = receivedAdditionalContext
      ? this.normalizeAdditionalContext(additionalContext)
      : this.resolveAdditionalContext(undefined, this.getStreamAdditionalContext(state));
    const livePreview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const liveContext = this.contextCollector.collectGuidanceContext();
    const stickySelectionAvailable = Boolean(
      state.contextPreview.selectedTextPreview &&
        this.pendingSelectionContext?.selectedText &&
        this.pendingSelectionPreview?.selectedTextPreview
    );
    const hasSelection = Boolean(liveContext.selectedText) || stickySelectionAvailable;
    const kind: GuidanceKind = requireContext || hasSelection ? "context" : "manual";
    const assistanceDepth = this.resolveEffectiveAssistanceDepth(kind, state.assistanceDepth, slashCommand);
    const projectScope = slashCommand === "next"
      ? this.resolveNextProjectScope(assistanceDepth, slashCommandScope)
      : undefined;

    if (kind !== "context") {
      const prepared = projectScope
        ? this.requestPlanner.prepareGuidanceRequest(
            this.withAdditionalContext(
              await this.contextCollector.collectNextActionContext(settings, projectScope, liveContext),
              effectiveAdditionalContext
            ),
            livePreview,
            settings,
            kind,
            assistanceDepth,
            slashCommand,
            slashCommandScope
          )
        : undefined;

      return {
        kind,
        userPrompt,
        preview: livePreview,
        prepared,
        additionalContext: receivedAdditionalContext ? additionalContext : effectiveAdditionalContext,
        assistanceDepth,
        slashCommand,
        slashCommandScope
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
    const requestContext = projectScope
      ? await this.contextCollector.collectNextActionContext(settings, projectScope, rawContext)
      : await this.collectGuidanceContextForDepth(settings, assistanceDepth, rawContext);
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      this.withAdditionalContext(requestContext, effectiveAdditionalContext),
      preview,
      settings,
      kind,
      assistanceDepth,
      slashCommand,
      slashCommandScope
    );

    return {
      kind,
      userPrompt,
      preview,
      prepared,
      additionalContext: receivedAdditionalContext ? additionalContext : effectiveAdditionalContext,
      assistanceDepth,
      slashCommand,
      slashCommandScope
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

    const fallbackAdditionalContext = this.getGuidanceAdditionalContext(state);
    const receivedAdditionalContext = options.additionalContext !== undefined;
    const incomingAdditionalContext = this.normalizeAdditionalContext(options.additionalContext);
    const effectiveAdditionalContext = receivedAdditionalContext
      ? incomingAdditionalContext
      : this.resolveAdditionalContext(undefined, fallbackAdditionalContext);
    const nextActiveAdditionalContext = receivedAdditionalContext
      ? incomingAdditionalContext
      : state.screen === "main"
        ? effectiveAdditionalContext
        : state.activeAdditionalContext;
    if (nextActiveAdditionalContext !== state.activeAdditionalContext) {
      state = {
        ...state,
        activeAdditionalContext: nextActiveAdditionalContext
      };
    }

    const settings = this.settingsService.getSettings();
    const preview = options.preview ?? this.rememberSelectionContext(this.contextCollector.collectPreview());
    const assistanceDepth = this.resolveEffectiveAssistanceDepth(
      options.kind,
      options.assistanceDepth ?? state.assistanceDepth,
      options.slashCommand
    );
    const fallbackContext = options.prepared
      ? undefined
      : options.slashCommand === "next"
        ? await this.contextCollector.collectNextActionContext(
            settings,
            this.resolveNextProjectScope(assistanceDepth, options.slashCommandScope)
          )
        : await this.collectGuidanceContextForDepth(settings, assistanceDepth);
    const prepared =
      options.prepared ??
      this.requestPlanner.prepareGuidanceRequest(
        this.withAdditionalContext(
          fallbackContext!,
          effectiveAdditionalContext
        ),
        preview,
        settings,
        options.kind,
        assistanceDepth,
        options.slashCommand,
        options.slashCommandScope
      );
    this.clearSelectionAfterContextCapture(options.kind, prepared.context);
    const contextPreviewAfterCapture =
      options.kind === "context" && prepared.context.selectedText
        ? this.clearSelectionPreview(preview)
        : preview;

    const nextHistory = [...state.conversationHistory];
    const userEntryText = this.resolveUserEntryText(options.kind, options.userPrompt, options.slashCommand, options.slashCommandScope);
    if (userEntryText) {
      nextHistory.push(this.createConversationEntry(
        "user",
        userEntryText,
        options.kind,
        preview,
        undefined,
        undefined,
        assistanceDepth,
        options.slashCommand,
        options.slashCommandScope
      ));
    }

    this.patchSession({
      requestState: "requesting_guidance",
      connectionState: this.connectionService.getState(),
      screen:
        options.kind === "always"
          ? state.screen
          : "conversation",
      contextPreview: contextPreviewAfterCapture,
      conversationHistory: nextHistory,
      activeAdditionalContext: nextActiveAdditionalContext
    });

    const responseModel = this.connectionService.getConnectedModel();
    const responseModelLabel = this.getCurrentModelLabel();
    const result = await this.adviceService.requestGuidance({
      context: prepared.context,
      kind: options.kind,
      userPrompt: options.userPrompt?.trim(),
      assistanceDepth,
      slashCommand: options.slashCommand,
      slashCommandScope: options.slashCommandScope,
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
        prepared.requestPlan,
        assistanceDepth,
        options.slashCommand,
        options.slashCommandScope,
        responseModelLabel,
        responseModel?.providerId,
        responseModel?.modelId
      );
      if (result.usage) {
        assistantEntry.tokenUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCostUsd: this.usageMeter.estimateCostUsd(
            this.getCurrentProviderId(),
            this.getModelIdentifier(),
            result.usage
          )
        };
      }
      this.guidanceContextByConversationId.set(assistantEntry.id, prepared.context);
      const updatedHistory = [...nextHistory, assistantEntry];

      this.patchSession({
        connectionState: this.connectionService.getState(),
        requestState: "idle",
        screen: this.resolveScreenAfterSuccess(options.kind, latestState.screen),
        contextPreview: refreshedPreview,
        latestGuidance: this.createGuidanceCard(assistantEntry),
        conversationHistory: updatedHistory,
        activeAdditionalContext: nextActiveAdditionalContext,
        pendingAdditionalContext: undefined,
        selectedConversationId: this.resolveSelectedConversationIdAfterSuccess(options.kind, latestState, assistantEntry.id),
        statusMessage: this.usageMeter.isBudgetExceeded(this.getCurrentProviderId(), settings.dailyBudgetUsd)
          ? {
              kind: "warning",
              text: "本日の利用額が設定上限を超えています。設定から上限を確認できます。"
            }
          : undefined
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
      activeAdditionalContext: nextActiveAdditionalContext,
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

    this.hydrateConversationStream({ ...existingStream, additionalContext: undefined });
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

    if (state.screen === "main") {
      return this.createNewActiveConversationStream();
    }

    if (state.activeConversationStreamId) {
      return state;
    }

    return this.ensureActiveConversationStream();
  }

  private async createNewActiveConversationStream(): Promise<NavigatorSessionState> {
    const currentState = this.sessionStore.getState();
    const additionalContext = this.getGuidanceAdditionalContext(currentState);
    await this.discardActiveConversationIfEmpty();
    const record = await this.conversationStore.createStream();
    await this.conversationStore.setActiveStream(record.id);
    this.lastAutomaticContextFingerprint = undefined;
    this.hydrateConversationStream({ ...record, additionalContext });
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

    // 予算超過時はタイトル生成のリクエストを行わずフォールバック名を使う
    if (this.usageMeter.isBudgetExceeded(this.getCurrentProviderId(), this.settingsService.getSettings().dailyBudgetUsd)) {
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
      additionalContext: this.normalizeAdditionalContext(state.activeAdditionalContext)
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

  private async refreshCopilotModelOptions(): Promise<void> {
    await this.connectionService.refreshAvailableModels();
    this.didChangeStateEmitter.fire();
  }

  public async deleteLmStudioToken(): Promise<void> {
    await this.connectionService.deleteLmStudioToken();
    this.patchSession({
      statusMessage: { kind: "info", text: "LM Studio の API トークンを削除しました。" }
    });
  }

  private async applyLmStudioModelKeyChange(settings: NavigatorSettings): Promise<NavigatorSettings> {
    if (settings.providerId !== "lmStudio") {
      this.connectionService.consumeLmStudioModelKeyChange();
      return settings;
    }

    const nextModelKey = this.connectionService.consumeLmStudioModelKeyChange();
    if (nextModelKey === undefined || nextModelKey === settings.lmStudioModelKey) {
      return settings;
    }

    return this.settingsService.saveSettings({
      ...settings,
      lmStudioModelKey: nextModelKey ?? undefined
    });
  }

  private async collectGuidanceContextForDepth(
    settings: NavigatorSettings,
    assistanceDepth: AssistanceDepth,
    baseContext?: GuidanceContext
  ): Promise<GuidanceContext> {
    if (assistanceDepth !== "high") {
      return baseContext ?? this.contextCollector.collectGuidanceContext();
    }

    return this.contextCollector.collectGuidanceContextWithWorkspace(settings, baseContext);
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
    if (this.settingsService.getSettings().providerId === "lmStudio") {
      if (!vscode.workspace.isTrusted) {
        return { kind: "error", text: "Workspace Trust を有効にしてから LM Studio に接続してください。" };
      }
      if (connectionState === "unavailable") {
        switch (this.connectionService.getLastLmStudioIssue()) {
          case "auth":
            return { kind: "error", text: "LM Studio の API トークンを確認してください。" };
          case "unreachable":
            return { kind: "error", text: "LM Studio サーバーに接続できません。起動状態を確認してください。" };
          case "timeout":
            return { kind: "error", text: "LM Studio の応答がタイムアウトしました。" };
          case "savedModelNotLoaded":
            return { kind: "warning", text: "保存済みモデルを LM Studio でロードしてください。" };
          case "noLoadedModel":
            return { kind: "warning", text: "LM Studio でモデルをロードしてから接続してください。" };
          case "selectionCancelled":
            return { kind: "warning", text: "使用する LM Studio モデルを選択してください。" };
          default:
            return { kind: "error", text: "LM Studio への接続に失敗しました。" };
        }
      }
      if (connectionState === "connecting") {
        return { kind: "info", text: "LM Studio に接続しています..." };
      }
      if (connectionState === "connected") {
        return { kind: "info", text: "LM Studio に接続しました。" };
      }
    }

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
            ? this.settingsService.getSettings().copilotModelId
              ? "Copilot に接続できません。設定で指定したモデルが現在利用可能か確認するか、使用モデルを自動に戻してください。"
              : "Copilot に接続できません。GitHub Copilot Chat がインストール・サインイン済みか、利用可能な Copilot モデルがあるか確認してください。"
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

  private buildAutoModelFallbackStatusMessage(): NavigatorStatusMessage | undefined {
    if (!this.connectionService.didUseAutoFallbackModel()) {
      return undefined;
    }

    return {
      kind: "warning",
      text: `低コストモデルが見つからなかったため、${this.getCurrentModelLabel() ?? "利用可能なモデル"} で接続しました。使用量に注意してください。`
    };
  }

  private getCurrentModelLabel(): string | undefined {
    const model = this.connectionService.getConnectedModel();
    if (!model) {
      return undefined;
    }
    return `${model.providerId === "lmStudio" ? "LM Studio" : "GitHub Copilot"} · ${model.modelLabel}`;
  }

  private createConversationEntry(
    role: "user" | "assistant",
    text: string,
    kind: GuidanceKind,
    basedOn?: NavigatorSessionState["contextPreview"],
    mode?: AdviceMode,
    requestPlan?: GuidanceCard["requestPlan"],
    assistanceDepth?: AssistanceDepth,
    slashCommand?: SlashCommand,
    slashCommandScope?: SlashCommandScope,
    modelLabel?: string,
    providerId?: AiProviderId,
    modelId?: string
  ): ConversationEntry {
    return {
      id: this.createId(),
      role,
      text,
      createdAt: new Date().toISOString(),
      kind,
      basedOn,
      mode,
      assistanceDepth,
      slashCommand,
      slashCommandScope,
      providerId,
      modelId,
      modelLabel,
      requestPlan
    };
  }

  private createGuidanceCard(entry: ConversationEntry): GuidanceCard {
    return {
      id: entry.id,
      requestedAt: entry.createdAt,
      mode: entry.mode ?? "manual",
      assistanceDepth: entry.assistanceDepth ?? entry.requestPlan?.assistanceDepth ?? "low",
      slashCommand: entry.slashCommand ?? entry.requestPlan?.slashCommand,
      slashCommandScope: entry.slashCommandScope ?? entry.requestPlan?.slashCommandScope,
      providerId: entry.providerId,
      modelId: entry.modelId,
      modelLabel: entry.modelLabel,
      text: entry.text,
      basedOn: entry.basedOn ?? { diagnosticsSummary: [] },
      requestPlan: entry.requestPlan ?? {
        kind: entry.kind,
        assistanceDepth: entry.assistanceDepth,
        slashCommand: entry.slashCommand,
        slashCommandScope: entry.slashCommandScope,
        categories: [],
        targetFiles: [],
        excludedGlobs: [],
        estimatedSizeText: "0 B / 0カテゴリ"
      }
    };
  }

  private buildKnowledgeItems(state: NavigatorSessionState): KnowledgeListItem[] {
    return this.knowledgeStore.list({
      query: state.knowledgeQuery
    }).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      providerId: item.providerId,
      modelId: item.modelId,
      modelLabel: item.modelLabel,
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
    const sourceConversationDeleted = Boolean(selected.sourceAdviceId && !sourceConversation);

    return {
      id: selected.id,
      title: selected.title,
      summary: selected.summary,
      providerId: selected.providerId,
      modelId: selected.modelId,
      modelLabel: selected.modelLabel,
      body: selected.body,
      createdAt: selected.createdAt,
      updatedAt: selected.updatedAt,
      sourceConversation,
      sourceConversationDeleted
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

  private resolveUserEntryText(
    kind: GuidanceKind,
    userPrompt?: string,
    slashCommand?: SlashCommand,
    slashCommandScope?: SlashCommandScope
  ): string | undefined {
    if (slashCommand) {
      return userPrompt?.trim() || this.getSlashCommandUserEntryText(slashCommand, slashCommandScope);
    }

    if (userPrompt?.trim() && kind !== "always") {
      return userPrompt.trim();
    }

    switch (kind) {
      case "context":
        return "この箇所を相談";
      case "always":
      case "manual":
      default:
        return undefined;
    }
  }

  private getSlashCommandUserEntryText(
    slashCommand: SlashCommand,
    slashCommandScope?: SlashCommandScope
  ): string {
    switch (slashCommand) {
      case "hint":
        return "ヒントをください";
      case "next":
        return slashCommandScope === "deep"
          ? "次に何をすればよいか広めに整理してください"
          : "次に何をすればよいか整理してください";
      case "flow":
        return "処理やデータの流れを整理してください";
      case "risk":
        return "壊れやすい箇所や注意点を確認してください";
      case "test":
        return "テスト観点を整理してください";
      default:
        return "相談したいです";
    }
  }

  private parseSlashInput(value?: string): ParsedSlashInput {
    const trimmed = value?.trim();
    if (!trimmed) {
      return {};
    }

    const match = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!match) {
      return { userPrompt: trimmed };
    }

    const slashCommand = this.normalizeSlashCommand(match[1]);
    if (!slashCommand) {
      return { userPrompt: trimmed };
    }

    const userPrompt = match[2]?.trim();
    if (slashCommand === "next") {
      const nextScope = this.parseNextSlashCommandScope(userPrompt);
      return {
        slashCommand,
        slashCommandScope: nextScope.scope,
        userPrompt: nextScope.userPrompt
      };
    }

    return {
      slashCommand,
      slashCommandScope: "standard",
      userPrompt: userPrompt || undefined
    };
  }

  private parseNextSlashCommandScope(value: string | undefined): {
    scope: SlashCommandScope;
    userPrompt?: string;
  } {
    const args = value?.trim();
    if (!args) {
      return { scope: "standard" };
    }

    const [firstArg, ...rest] = args.split(/\s+/);
    if (firstArg && /^(deep|wide|full)$/i.test(firstArg)) {
      const userPrompt = rest.join(" ").trim();
      return {
        scope: "deep",
        userPrompt: userPrompt || undefined
      };
    }

    return {
      scope: "standard",
      userPrompt: args
    };
  }

  private normalizeSlashCommand(value: string): SlashCommand | undefined {
    switch (value.toLowerCase()) {
      case "hint":
      case "next":
      case "flow":
      case "risk":
      case "test":
        return value.toLowerCase() as SlashCommand;
      default:
        return undefined;
    }
  }

  private resolveEffectiveAssistanceDepth(
    kind: GuidanceKind,
    assistanceDepth: AssistanceDepth,
    slashCommand?: SlashCommand
  ): AssistanceDepth {
    if (kind === "always") {
      return "low";
    }

    // /flow は流れの整理に関連ファイル等の厚い文脈が必要なため、常にハイとして実行する
    if (slashCommand === "flow") {
      return "high";
    }

    return assistanceDepth;
  }

  private resolveNextProjectScope(
    assistanceDepth: AssistanceDepth,
    slashCommandScope?: SlashCommandScope
  ): ProjectContextScope {
    if (slashCommandScope === "deep") {
      return "deep";
    }

    return assistanceDepth === "high" ? "project" : "project-lite";
  }

  private hasMeaningfulContext(context: GuidanceContext): boolean {
    return Boolean(
      context.activeFileExcerpt ||
        context.selectedText ||
        context.workspaceTree?.treeText ||
        context.referencedFiles.length > 0 ||
        context.diagnosticsSummary.length > 0 ||
        context.recentEditsSummary.length > 0 ||
        context.relatedSymbols.length > 0 ||
        context.projectSummary ||
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

  private getVisibleAdditionalContext(state: NavigatorSessionState): string | undefined {
    return state.screen === "main"
      ? state.pendingAdditionalContext ?? state.activeAdditionalContext
      : state.activeAdditionalContext ?? state.pendingAdditionalContext;
  }

  private getGuidanceAdditionalContext(state: NavigatorSessionState): string | undefined {
    return state.screen === "main"
      ? state.pendingAdditionalContext ?? state.activeAdditionalContext
      : state.activeAdditionalContext;
  }

  private resolveAdditionalContext(additionalContext: string | undefined, fallback?: string): string | undefined {
    return this.normalizeAdditionalContext(additionalContext) ?? this.normalizeAdditionalContext(fallback);
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
      workspaceTree: context.workspaceTree?.treeText,
      referencedFiles: context.referencedFiles.map((file) => ({
        path: file.path,
        reason: file.reason,
        excerpt: file.excerpt,
        diagnostics: file.diagnosticsSummary.map((item) => `${item.severity}:${item.line}:${item.message}`)
      })),
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
      assistanceDepth: "low",
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
      activeAdditionalContext: undefined,
      pendingAdditionalContext: undefined
    };
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
