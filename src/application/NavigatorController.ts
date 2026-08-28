import * as vscode from "vscode";
import { SessionStore } from "./SessionStore";
import { ContextCollector } from "../services/ContextCollector";
import { AdviceService } from "../services/AdviceService";
import { AdviceScheduler } from "../services/AdviceScheduler";
import { ConversationStore } from "../services/ConversationStore";
import { ConnectionService } from "../services/ConnectionService";
import { KnowledgeStore } from "../services/KnowledgeStore";
import { FeedbackStore } from "../services/FeedbackStore";
import { RequestPlanner, PreparedGuidanceRequest } from "../services/RequestPlanner";
import { SettingsService } from "../services/SettingsService";
import { UsageMeter } from "../services/UsageMeter";
import { LmStudioServerService } from "../services/LmStudioServerService";
import { LmStudioCoordinator } from "./coordinators/LmStudioCoordinator";
import { ConversationCoordinator } from "./coordinators/ConversationCoordinator";
import {
  NavigationCoordinator,
  resolveHomeScreen,
  resolveScreenAfterFailure,
  resolveScreenAfterSuccess,
  resolveSelectedConversationIdAfterSuccess
} from "./coordinators/NavigationCoordinator";
import { FeedbackCoordinator } from "./coordinators/FeedbackCoordinator";
import { KnowledgeCoordinator } from "./coordinators/KnowledgeCoordinator";
import {
  ConnectionSettingsCoordinator,
  SettingsInput
} from "./coordinators/ConnectionSettingsCoordinator";
import {
  createAutomaticFingerprint,
  hasMeaningfulContext,
  normalizeAdditionalContext,
  parseSlashInput,
  resolveAdditionalContext,
  resolveEffectiveAssistanceDepth,
  resolveNextProjectScope,
  resolveUserEntryText,
  withAdditionalContext
} from "./GuidanceInput";
import { getSkill } from "../shared/skills";
import {
  AdviceMode,
  AiProviderId,
  AdviceTriggerReason,
  AssistanceDepth,
  ConversationEntry,
  GuidanceCard,
  GuidanceKind,
  GuidanceContext,
  NavigatorScreen,
  NavigatorSessionState,
  NavigatorSettings,
  NavigatorViewModel,
  SlashCommand,
  SlashCommandScope,
  UsageTodayViewData,
  FeedbackRating,
  BadFeedbackReason
} from "../shared/types";

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

export class NavigatorController implements vscode.Disposable {
  private readonly sessionStore: SessionStore;
  private readonly connectionSettingsCoordinator: ConnectionSettingsCoordinator;
  private readonly lmStudioCoordinator: LmStudioCoordinator;
  private readonly conversationCoordinator: ConversationCoordinator;
  private readonly navigationCoordinator: NavigationCoordinator;
  private readonly feedbackCoordinator: FeedbackCoordinator;
  private readonly knowledgeCoordinator: KnowledgeCoordinator;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();
  private pendingSelectionContext?: GuidanceContext;
  private pendingSelectionPreview?: NavigatorSessionState["contextPreview"];
  private lastAutomaticContextFingerprint?: string;
  private activeGuidanceRequest?: {
    id: number;
    tokenSource: vscode.CancellationTokenSource;
  };
  private nextGuidanceRequestId = 1;
  private initialized = false;

  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly connectionService: ConnectionService,
    private readonly adviceService: AdviceService,
    private readonly adviceScheduler: AdviceScheduler,
    private readonly requestPlanner: RequestPlanner,
    private readonly settingsService: SettingsService,
    lmStudioServerService: LmStudioServerService,
    private readonly conversationStore: ConversationStore,
    private readonly knowledgeStore: KnowledgeStore,
    private readonly feedbackStore: FeedbackStore,
    private readonly usageMeter: UsageMeter
  ) {
    this.sessionStore = new SessionStore(this.createInitialState());
    this.connectionSettingsCoordinator = new ConnectionSettingsCoordinator(
      this.connectionService,
      this.settingsService,
      this.adviceScheduler,
      {
        getState: () => this.sessionStore.getState(),
        patchSession: (partial) => this.patchSession(partial),
        collectContextPreview: () => this.rememberSelectionContext(this.contextCollector.collectPreview()),
        notifyStateChanged: () => this.didChangeStateEmitter.fire()
      }
    );
    this.lmStudioCoordinator = new LmStudioCoordinator(
      this.connectionService,
      lmStudioServerService,
      this.settingsService,
      {
        getState: () => this.sessionStore.getState(),
        patchSession: (partial) => this.patchSession(partial),
        notifyStateChanged: () => this.didChangeStateEmitter.fire(),
        saveSettings: (settings) => this.connectionSettingsCoordinator.saveSettingsWithRevision(settings),
        buildConnectionStatus: (providerId, state) =>
          this.connectionSettingsCoordinator.buildConnectionStatusMessageForProvider(providerId, state)
      }
    );
    this.conversationCoordinator = new ConversationCoordinator(
      this.conversationStore,
      this.adviceService,
      this.connectionService,
      this.settingsService,
      this.usageMeter,
      {
        getState: () => this.sessionStore.getState(),
        patchSession: (partial) => this.patchSession(partial),
        resolveHomeScreen: () => resolveHomeScreen(this.sessionStore.getState().connectionState),
        resetAutomaticFingerprint: () => { this.lastAutomaticContextFingerprint = undefined; },
        createGuidanceCard: (entry) => this.createGuidanceCard(entry),
        getGuidanceAdditionalContext: (state) => this.getGuidanceAdditionalContext(state),
        getCurrentProviderId: () => this.connectionSettingsCoordinator.getCurrentProviderId()
      }
    );
    this.navigationCoordinator = new NavigationCoordinator({
      getState: () => this.sessionStore.getState(),
      patchSession: (partial) => this.patchSession(partial),
      onSettingsOpened: () => { void this.lmStudioCoordinator.refreshServerStatus(false); }
    });
    this.feedbackCoordinator = new FeedbackCoordinator(
      this.feedbackStore,
      this.adviceService,
      {
        getState: () => this.sessionStore.getState(),
        patchSession: (partial) => this.patchSession(partial),
        pushFeedbackForm: () => this.navigationCoordinator.pushScreen("feedback_form"),
        navigateBack: () => this.navigationCoordinator.navigateBack(),
        createGuidanceCard: (entry) => this.createGuidanceCard(entry),
        persistConversation: () => this.conversationCoordinator.persist({ summarizeTitle: false })
      }
    );
    this.knowledgeCoordinator = new KnowledgeCoordinator(
      this.knowledgeStore,
      this.conversationStore,
      this.connectionService,
      this.adviceService,
      {
        getState: () => this.sessionStore.getState(),
        patchSession: (partial) => this.patchSession(partial),
        getCurrentModelLabel: () => this.connectionSettingsCoordinator.getCurrentModelLabel(),
        getGuidanceContext: (entryId) => this.conversationCoordinator.getGuidanceContext(entryId)
      }
    );

    this.disposables.push(
      this.sessionStore,
      this.adviceScheduler,
      this.conversationStore,
      this.knowledgeStore,
      this.feedbackStore,
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
    await this.feedbackStore.initialize();
    await this.conversationCoordinator.restore();

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
        void this.connectionSettingsCoordinator.refreshCopilotModelOptions();
      })
    );

    this.initialized = true;
    this.patchSession({
      screen: resolveHomeScreen(this.connectionService.getState()),
      mode: settings.defaultMode,
      assistanceDepth: settings.defaultAssistanceDepth
    });
    this.refreshContextPreview();
    void this.connectionSettingsCoordinator.refreshCopilotModelOptions();
  }

  public getViewModel(): NavigatorViewModel {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();
    const currentRequestPlan = this.requestPlanner.prepareGuidanceRequest(
      withAdditionalContext(this.contextCollector.collectGuidanceContext(), this.getStreamAdditionalContext(state)),
      state.contextPreview,
      settings,
      state.mode === "always" ? "always" : "context",
      resolveEffectiveAssistanceDepth(state.mode === "always" ? "always" : "context", state.assistanceDepth)
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
      providerId: this.connectionService.getProviderId(),
      modelLabel: this.connectionSettingsCoordinator.getCurrentModelLabel(),
      copilotModelOptions: this.connectionService.getModelOptions(),
      lmStudioModelOptions: this.connectionService.getLmStudioModelOptions(),
      orcaRouterModelOptions: this.connectionService.getOrcaRouterModelOptions(),
      orcaRouterApiKeyConfigured: this.connectionService.isOrcaRouterApiKeyConfigured(),
      lmStudioServer: this.lmStudioCoordinator.getViewData(state.requestState),
      settingsRevision: this.connectionSettingsCoordinator.revision,
      statusMessage: state.statusMessage,
      contextPreview: state.contextPreview,
      latestGuidance: state.latestGuidance,
      conversationStreams: state.conversationStreams,
      activeConversationStreamId: state.activeConversationStreamId,
      activeAdditionalContext: this.getVisibleAdditionalContext(state),
      conversationHistory: state.conversationHistory,
      pendingFeedbackEntryId: state.pendingFeedbackEntryId,
      currentRequestPlan,
      settings,
      knowledgeItems: this.initialized ? this.knowledgeCoordinator.buildItems(state) : [],
      selectedKnowledge: this.initialized ? this.knowledgeCoordinator.buildSelected(state) : undefined,
      savedKnowledgeSourceIds: this.initialized ? this.knowledgeStore.listSourceAdviceIds() : [],
      knowledgeQuery: state.knowledgeQuery
    };
  }

  public async connectCopilot(providerId?: AiProviderId): Promise<void> {
    await this.connectionSettingsCoordinator.connect(providerId);
  }

  public async createConversationStream(): Promise<void> {
    await this.conversationCoordinator.createStream();
  }

  public async selectConversationStream(streamId: string): Promise<void> {
    await this.conversationCoordinator.selectStream(streamId);
  }

  public async deleteConversationStream(streamId: string): Promise<void> {
    await this.conversationCoordinator.deleteStream(streamId);
  }

  public async askForGuidance(userPrompt?: string, kind?: GuidanceKind, additionalContext?: string): Promise<void> {
    const parsed = parseSlashInput(userPrompt);
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
        : resolveAdditionalContext(undefined, this.getStreamAdditionalContext(this.sessionStore.getState())),
      slashCommand: parsed.slashCommand,
      slashCommandScope: parsed.slashCommandScope
    });
  }

  public async askForGuidanceWithCurrentContext(userPrompt: string, additionalContext?: string): Promise<void> {
    const parsed = parseSlashInput(userPrompt);
    await this.executeGuidanceRequest(await this.buildCurrentContextGuidanceOptions(parsed.userPrompt, false, additionalContext, parsed.slashCommand, parsed.slashCommandScope));
  }

  public cancelGuidanceRequest(): void {
    const activeRequest = this.activeGuidanceRequest;
    if (!activeRequest) {
      return;
    }

    activeRequest.tokenSource.cancel();
    this.activeGuidanceRequest = undefined;
    this.patchSession({
      requestState: "idle",
      statusMessage: {
        kind: "info",
        text: "回答生成を中断しました。"
      }
    });
  }


  public navigate(screen: NavigatorScreen): void {
    this.navigationCoordinator.navigate(screen);
  }

  public navigateBack(): void {
    this.navigationCoordinator.navigateBack();
  }

  public async saveSettings(input: SettingsInput): Promise<void> {
    await this.connectionSettingsCoordinator.save(input);
  }

  public async resetSettings(): Promise<void> {
    await this.connectionSettingsCoordinator.reset();
  }

  public async setAssistanceDepth(assistanceDepth: AssistanceDepth): Promise<void> {
    await this.connectionSettingsCoordinator.setAssistanceDepth(assistanceDepth);
  }

  public async setMode(mode: AdviceMode, additionalContext?: string): Promise<void> {
    await this.connectionSettingsCoordinator.setMode(mode, additionalContext);
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
      pendingAdditionalContext: normalizeAdditionalContext(additionalContext)
    });
  }

  public searchKnowledge(query: string): void {
    this.knowledgeCoordinator.search(query);
  }

  public selectKnowledge(id: string): void {
    this.knowledgeCoordinator.select(id);
  }

  public async saveKnowledge(conversationId?: string): Promise<void> {
    await this.knowledgeCoordinator.save(conversationId);
  }

  public async updateKnowledge(input: {
    id: string;
    title: string;
    summary: string;
    body: string;
  }): Promise<void> {
    await this.knowledgeCoordinator.update(input);
  }

  public async deleteKnowledge(id: string): Promise<void> {
    await this.knowledgeCoordinator.delete(id);
  }

  public async rateAdvice(conversationEntryId: string, rating: FeedbackRating): Promise<void> {
    await this.feedbackCoordinator.rateAdvice(conversationEntryId, rating);
  }

  public async submitBadFeedback(reasons: BadFeedbackReason[], comment: string): Promise<void> {
    await this.feedbackCoordinator.submitBadFeedback(reasons, comment);
  }

  public cancelBadFeedback(): void {
    this.feedbackCoordinator.cancelBadFeedback();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleAutomaticGuidance(reason: AdviceTriggerReason): Promise<void> {
    const state = this.sessionStore.getState();
    const settings = this.settingsService.getSettings();

    if (this.usageMeter.isTokenLimitExceeded(
      this.connectionSettingsCoordinator.getCurrentProviderId(),
      settings.dailyTokenLimit
    )) {
      this.pauseAutoAdviceForTokenLimit();
      return;
    }

    const preview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const additionalContext = this.getGuidanceAdditionalContext(state);
    const guidanceContext = await this.collectGuidanceContextForDepth(settings, "low");
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      withAdditionalContext(guidanceContext, additionalContext),
      preview,
      settings,
      "always",
      "low"
    );

    if (!hasMeaningfulContext(prepared.context)) {
      this.patchSession({
        contextPreview: preview
      });
      return;
    }

    const fingerprint = createAutomaticFingerprint(prepared.context);
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

  private buildUsageToday(settings: NavigatorSettings): UsageTodayViewData {
    const providerId = this.connectionSettingsCoordinator.getCurrentProviderId();
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
      tokenLimit: settings.dailyTokenLimit,
      tokenLimitExceeded: this.usageMeter.isTokenLimitExceeded(providerId, settings.dailyTokenLimit)
    };
  }

  private pauseAutoAdviceForTokenLimit(): void {
    if (!this.adviceScheduler.getState().paused) {
      this.adviceScheduler.togglePaused();
    }

    this.patchSession({
      statusMessage: {
        kind: "warning",
        text: "NaviCom内の本日の概算トークン数が上限に達したため、自動助言を一時停止しました。設定から上限を変更できます。"
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
      ? normalizeAdditionalContext(additionalContext)
      : resolveAdditionalContext(undefined, this.getStreamAdditionalContext(state));
    const livePreview = this.rememberSelectionContext(this.contextCollector.collectPreview());
    const liveContext = this.contextCollector.collectGuidanceContext();
    const stickySelectionAvailable = Boolean(
      state.contextPreview.selectedTextPreview &&
        this.pendingSelectionContext?.selectedText &&
        this.pendingSelectionPreview?.selectedTextPreview
    );
    const hasSelection = Boolean(liveContext.selectedText) || stickySelectionAvailable;
    const kind: GuidanceKind = requireContext || hasSelection ? "context" : "manual";
    const assistanceDepth = resolveEffectiveAssistanceDepth(kind, state.assistanceDepth, slashCommand);
    const projectScope = slashCommand && getSkill(slashCommand).usesProjectScope
      ? resolveNextProjectScope(assistanceDepth, slashCommandScope)
      : undefined;

    if (kind !== "context") {
      const prepared = projectScope
        ? this.requestPlanner.prepareGuidanceRequest(
            withAdditionalContext(
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
      withAdditionalContext(requestContext, effectiveAdditionalContext),
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
            text: "先に AI へ接続してください。"
          }
        });
      }
      return { ok: false };
    }

    state = await this.prepareConversationForGuidance(state, options.kind);

    const fallbackAdditionalContext = this.getGuidanceAdditionalContext(state);
    const receivedAdditionalContext = options.additionalContext !== undefined;
    const incomingAdditionalContext = normalizeAdditionalContext(options.additionalContext);
    const effectiveAdditionalContext = receivedAdditionalContext
      ? incomingAdditionalContext
      : resolveAdditionalContext(undefined, fallbackAdditionalContext);
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
    const assistanceDepth = resolveEffectiveAssistanceDepth(
      options.kind,
      options.assistanceDepth ?? state.assistanceDepth,
      options.slashCommand
    );
    const usesProjectScope = options.slashCommand
      ? getSkill(options.slashCommand).usesProjectScope
      : false;
    const fallbackContext = options.prepared
      ? undefined
      : usesProjectScope
        ? await this.contextCollector.collectNextActionContext(
            settings,
            resolveNextProjectScope(assistanceDepth, options.slashCommandScope)
          )
        : await this.collectGuidanceContextForDepth(settings, assistanceDepth);
    const prepared =
      options.prepared ??
      this.requestPlanner.prepareGuidanceRequest(
        withAdditionalContext(
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
    const userEntryText = resolveUserEntryText(
      options.kind,
      options.userPrompt,
      options.slashCommand,
      options.slashCommandScope
    );
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
    const responseModelLabel = this.connectionSettingsCoordinator.getCurrentModelLabel();
    const requestId = this.nextGuidanceRequestId++;
    const tokenSource = new vscode.CancellationTokenSource();
    this.activeGuidanceRequest = {
      id: requestId,
      tokenSource
    };

    const result = await this.adviceService.requestGuidance(
      {
        context: prepared.context,
        referencedFilePaths: prepared.requestPlan.targetFiles
          .filter((file) => file.included)
          .map((file) => file.path),
        kind: options.kind,
        userPrompt: options.userPrompt?.trim(),
        assistanceDepth,
        slashCommand: options.slashCommand,
        slashCommandScope: options.slashCommandScope,
        knowledgeItems: this.knowledgeStore.findReusable(prepared.context),
        feedbackTendency: options.kind === "always" ? undefined : this.feedbackStore.getTendencySummary()
      },
      tokenSource.token
    );
    const activeRequestAfterResponse = this.activeGuidanceRequest;
    const requestIsCurrent = activeRequestAfterResponse?.id === requestId;
    const wasCancelled = tokenSource.token.isCancellationRequested || (!result.ok && result.cancelled);
    if (activeRequestAfterResponse?.id === requestId) {
      this.activeGuidanceRequest = undefined;
    }
    tokenSource.dispose();

    if (wasCancelled || !requestIsCurrent) {
      if (requestIsCurrent) {
        this.patchSession({
          requestState: "idle",
          statusMessage: {
            kind: "info",
            text: "回答生成を中断しました。"
          }
        });
      }
      return { ok: false };
    }

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
        const reportedCostUsd = result.usage.costUsd;
        assistantEntry.tokenUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCostUsd: reportedCostUsd ?? this.usageMeter.estimateCostUsd(
            this.connectionSettingsCoordinator.getCurrentProviderId(),
            this.connectionSettingsCoordinator.getCurrentModelIdentifier(),
            result.usage
          ),
          costSource: reportedCostUsd !== undefined ? "providerResponse" : undefined
        };
      }
      this.conversationCoordinator.setGuidanceContext(assistantEntry.id, prepared.context);
      const updatedHistory = [...latestState.conversationHistory, assistantEntry];

      this.patchSession({
        connectionState: this.connectionService.getState(),
        requestState: "idle",
        screen: resolveScreenAfterSuccess(options.kind, latestState.screen),
        contextPreview: refreshedPreview,
        latestGuidance: this.createGuidanceCard(assistantEntry),
        conversationHistory: updatedHistory,
        activeAdditionalContext: nextActiveAdditionalContext,
        pendingAdditionalContext: undefined,
        selectedConversationId: resolveSelectedConversationIdAfterSuccess(options.kind, latestState, assistantEntry.id),
        statusMessage: this.usageMeter.isTokenLimitExceeded(
          this.connectionSettingsCoordinator.getCurrentProviderId(),
          settings.dailyTokenLimit
        )
          ? {
              kind: "warning",
              text: "NaviCom内の本日の概算トークン数が設定上限を超えています。設定から上限を確認できます。"
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
      screen: resolveScreenAfterFailure(
        options.kind,
        latestState.screen,
        nextConnectionState,
        Boolean(latestState.latestGuidance)
      ),
      mode: nextMode,
      contextPreview: refreshedPreview,
      conversationHistory: latestState.conversationHistory,
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

  private async prepareConversationForGuidance(
    state: NavigatorSessionState,
    kind: GuidanceKind
  ): Promise<NavigatorSessionState> {
    return this.conversationCoordinator.prepareForGuidance(state, kind);
  }

  private async persistActiveConversationState(options: { summarizeTitle?: boolean } = {}): Promise<void> {
    await this.conversationCoordinator.persist(options);
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

  public async refreshLmStudioModels(announce = true): Promise<void> {
    await this.lmStudioCoordinator.refreshModels(announce);
  }

  public async setOrcaRouterApiKey(apiKey: string): Promise<void> {
    await this.connectionService.storeOrcaRouterApiKey(apiKey);
    const options = await this.connectionService.refreshAvailableOrcaRouterModels();
    const issue = this.connectionService.getLastOrcaRouterIssue();
    const refreshStatus = issue
      ? this.connectionSettingsCoordinator.buildConnectionStatusMessageForProvider("orcaRouter", "unavailable")
      : undefined;
    this.patchSession({
      statusMessage: refreshStatus
        ? {
            kind: refreshStatus.kind,
            text: `APIキーは保存しましたが、モデル一覧を取得できませんでした。${refreshStatus.text}`
          }
        : {
            kind: "info",
            text: `OrcaRouter APIキーを安全なストレージに保存し、テキストモデルを ${Math.max(0, options.length - 2)} 件取得しました。`
          }
    });
  }

  public async deleteOrcaRouterApiKey(): Promise<void> {
    await this.connectionService.deleteOrcaRouterApiKey();
    this.patchSession({
      connectionState: this.connectionService.getState(),
      statusMessage: { kind: "info", text: "OrcaRouter APIキーを削除しました。" }
    });
  }

  public async refreshOrcaRouterModels(): Promise<void> {
    const options = await this.connectionService.refreshAvailableOrcaRouterModels();
    const issue = this.connectionService.getLastOrcaRouterIssue();
    this.patchSession({
      statusMessage: issue
        ? this.connectionSettingsCoordinator.buildConnectionStatusMessageForProvider("orcaRouter", "unavailable")
        : { kind: "info", text: `OrcaRouter のテキストモデルを ${Math.max(0, options.length - 2)} 件取得しました。` }
    });
  }

  public async refreshLmStudioServerStatus(announce = true): Promise<void> {
    await this.lmStudioCoordinator.refreshServerStatus(announce);
  }

  public async startLmStudioServer(): Promise<void> {
    await this.lmStudioCoordinator.startServer();
  }

  public async stopLmStudioServer(): Promise<void> {
    await this.lmStudioCoordinator.stopServer();
  }

  public async useLmStudioRunningPort(): Promise<void> {
    await this.lmStudioCoordinator.useRunningPort();
  }

  public async restartLmStudioOnConfiguredPort(): Promise<void> {
    await this.lmStudioCoordinator.restartOnConfiguredPort();
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
      screen: resolveHomeScreen(connectionState),
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
