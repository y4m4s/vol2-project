import * as vscode from "vscode";
import { SessionStore } from "./SessionStore";
import { ContextCollector } from "../services/ContextCollector";
import { AdviceService } from "../services/AdviceService";
import { ConnectionService } from "../services/ConnectionService";
import { KnowledgeStore } from "../services/KnowledgeStore";
import { RequestPlanner } from "../services/RequestPlanner";
import { SettingsService } from "../services/SettingsService";
import {
  AdviceDetailViewData,
  AdviceMode,
  ConnectionState,
  ContextCategoryKey,
  ConversationEntry,
  GuidanceCard,
  GuidanceKind,
  KnowledgeListItem,
  NavigatorScreen,
  NavigatorSessionState,
  NavigatorSettings,
  NavigatorStatusMessage,
  NavigatorViewModel
} from "../shared/types";

const HOME_SCREENS: NavigatorScreen[] = ["onboarding", "main", "error"];

export class NavigatorController implements vscode.Disposable {
  private readonly sessionStore: SessionStore;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly connectionService: ConnectionService,
    private readonly adviceService: AdviceService,
    private readonly requestPlanner: RequestPlanner,
    private readonly settingsService: SettingsService,
    private readonly knowledgeStore: KnowledgeStore
  ) {
    this.sessionStore = new SessionStore(this.createInitialState());

    this.disposables.push(
      this.sessionStore,
      this.didChangeStateEmitter,
      this.sessionStore.onDidChangeState(() => {
        this.didChangeStateEmitter.fire();
      })
    );
  }

  public async initialize(): Promise<void> {
    await this.knowledgeStore.initialize();

    const settings = this.settingsService.getSettings();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.refreshContextPreview();
      }),
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.refreshContextPreview();
      }),
      vscode.languages.onDidChangeDiagnostics(() => {
        this.refreshContextPreview();
      })
    );

    this.patchSession({
      mode: settings.defaultMode === "always" && settings.alwaysModeEnabled ? "always" : "manual"
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
      "context"
    ).requestPlan;

    return {
      screen: state.screen,
      connectionState: state.connectionState,
      mode: state.mode,
      canConnect: state.requestState === "idle",
      canAskForGuidance: state.connectionState === "connected" && state.requestState === "idle",
      canSwitchMode: settings.alwaysModeEnabled && state.connectionState === "connected",
      isBusy: state.requestState !== "idle",
      statusMessage: state.statusMessage,
      contextPreview: state.contextPreview,
      latestGuidance: state.latestGuidance,
      conversationHistory: state.conversationHistory,
      selectedAdvice: this.buildSelectedAdvice(state),
      currentRequestPlan,
      settings,
      knowledgeItems: this.buildKnowledgeItems()
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

    if (connectionState === "connected") {
      this.patchSession({
        connectionState,
        requestState: "idle",
        screen: "main",
        statusMessage: {
          kind: "info",
          text: "Copilot に接続しました。現在の文脈で手動ガイダンスを利用できます。"
        },
        contextPreview: this.contextCollector.collectPreview()
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
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    if (this.connectionService.getState() !== "connected") {
      this.patchSession({
        connectionState: this.connectionService.getState(),
        statusMessage: {
          kind: "warning",
          text: "先に Copilot へ接続してください。"
        }
      });
      return;
    }

    const guidanceKind = kind ?? (userPrompt?.trim() ? "manual" : "context");
    const preview = this.contextCollector.collectPreview();
    const settings = this.settingsService.getSettings();
    const prepared = this.requestPlanner.prepareGuidanceRequest(
      this.contextCollector.collectGuidanceContext(),
      preview,
      settings,
      guidanceKind
    );

    const nextHistory = [...state.conversationHistory];
    const userEntryText = this.resolveUserEntryText(guidanceKind, userPrompt);
    if (userEntryText) {
      nextHistory.push(this.createConversationEntry("user", userEntryText, guidanceKind));
    }

    this.patchSession({
      requestState: "requesting_guidance",
      connectionState: this.connectionService.getState(),
      screen: "main",
      conversationHistory: nextHistory,
      statusMessage: {
        kind: "info",
        text: "現在の作業文脈をもとにガイダンスを生成しています..."
      }
    });

    const result = await this.adviceService.requestGuidance({
      context: prepared.context,
      kind: guidanceKind,
      userPrompt: userPrompt?.trim(),
      previousAssistantText: guidanceKind === "deep_dive" ? this.findSelectedConversation(state)?.text : undefined
    });

    const refreshedPreview = this.contextCollector.collectPreview();

    if (result.ok) {
      const assistantEntry = this.createConversationEntry(
        "assistant",
        result.text,
        guidanceKind,
        refreshedPreview,
        state.mode,
        prepared.requestPlan
      );
      const updatedHistory = [...nextHistory, assistantEntry];

      this.patchSession({
        connectionState: this.connectionService.getState(),
        requestState: "idle",
        screen: guidanceKind === "deep_dive" ? "advice_detail" : "main",
        contextPreview: refreshedPreview,
        latestGuidance: this.createGuidanceCard(assistantEntry),
        conversationHistory: updatedHistory,
        selectedConversationId: assistantEntry.id,
        statusMessage: undefined
      });
      return;
    }

    this.patchSession({
      connectionState: result.connectionState,
      requestState: "idle",
      screen: result.connectionState === "restricted" && state.latestGuidance ? "main" : this.resolveHomeScreen(result.connectionState),
      contextPreview: refreshedPreview,
      conversationHistory: nextHistory,
      statusMessage: {
        kind: "error",
        text: result.message
      }
    });
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

    await this.askForGuidance("直前のアドバイスをもう少し具体的に説明してください。", "deep_dive");
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

  public navigate(screen: string): void {
    switch (screen) {
      case "s01":
        this.patchSession({ screen: "onboarding" });
        return;
      case "s02":
        this.patchSession({ screen: this.resolveHomeScreen(this.sessionStore.getState().connectionState) });
        return;
      case "s04":
        this.pushScreen("context_check");
        return;
      case "s05":
        this.pushScreen("knowledge");
        return;
      case "s06":
        this.pushScreen("settings");
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
    alwaysModeEnabled: boolean;
    requestIntervalSec: number;
    idleDelaySec: number;
    suppressDuplicate: boolean;
    ctxActiveFile: boolean;
    ctxSelection: boolean;
    ctxDiagnostics: boolean;
    ctxRecentEdits: boolean;
    ctxSymbols: boolean;
    excludeGlobs: string;
  }): Promise<void> {
    const nextSettings: NavigatorSettings = {
      ...this.settingsService.getSettings(),
      defaultMode: input.defaultMode,
      alwaysModeEnabled: input.alwaysModeEnabled,
      requestIntervalMs: input.requestIntervalSec * 1000,
      idleDelayMs: input.idleDelaySec * 1000,
      suppressDuplicate: input.suppressDuplicate,
      sendTargets: {
        activeFile: input.ctxActiveFile,
        selection: input.ctxSelection,
        diagnostics: input.ctxDiagnostics,
        recentEdits: input.ctxRecentEdits,
        relatedSymbols: input.ctxSymbols
      },
      excludedGlobs: input.excludeGlobs
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    };

    const saved = await this.settingsService.saveSettings(nextSettings);
    this.patchSession({
      mode: saved.defaultMode === "always" && saved.alwaysModeEnabled ? "always" : "manual",
      statusMessage: {
        kind: "info",
        text: "設定を保存しました。"
      }
    });
  }

  public async resetSettings(): Promise<void> {
    const reset = await this.settingsService.resetSettings();
    this.patchSession({
      mode: reset.defaultMode === "always" && reset.alwaysModeEnabled ? "always" : "manual",
      statusMessage: {
        kind: "info",
        text: "設定を初期値に戻しました。"
      }
    });
  }

  public setMode(mode: AdviceMode): void {
    const settings = this.settingsService.getSettings();

    if (mode === "manual") {
      this.patchSession({
        mode,
        statusMessage: undefined
      });
      return;
    }

    if (!settings.alwaysModeEnabled) {
      this.patchSession({
        statusMessage: {
          kind: "warning",
          text: "常時モードは設定画面で有効化できます。"
        }
      });
      return;
    }

    this.patchSession({
      mode,
      statusMessage: {
        kind: "info",
        text: "常時モードの自動助言は Phase 3 で導入予定です。現在は手動相談のみ利用できます。"
      }
    });
  }

  public searchKnowledge(_query: string): void {
    // Phase 2 では UI 表示のみ。
  }

  public filterKnowledge(_filter: string): void {
    // Phase 2 では UI 表示のみ。
  }

  public exportKnowledge(): void {
    this.patchSession({
      statusMessage: {
        kind: "info",
        text: "ナレッジのエクスポートは Phase 4 で実装予定です。"
      }
    });
  }

  public resetKnowledge(): void {
    this.patchSession({
      statusMessage: {
        kind: "info",
        text: "ナレッジのリセットは Phase 4 で実装予定です。"
      }
    });
  }

  public saveKnowledge(): void {
    this.patchSession({
      statusMessage: {
        kind: "info",
        text: "ナレッジ保存は Phase 4 で実装予定です。"
      }
    });
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refreshContextPreview(): void {
    this.patchSession({
      contextPreview: this.contextCollector.collectPreview()
    });
  }

  private patchSession(partial: Partial<NavigatorSessionState>): void {
    this.sessionStore.patch(partial);
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
            ? "Copilot を利用できません。Copilot の利用状態とネットワーク、VS Code Desktop 環境を確認してください。"
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

  private buildKnowledgeItems(): KnowledgeListItem[] {
    return [];
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

  private resolveUserEntryText(kind: GuidanceKind, userPrompt?: string): string | undefined {
    if (userPrompt?.trim()) {
      return userPrompt.trim();
    }

    switch (kind) {
      case "context":
        return "この箇所を相談";
      case "deep_dive":
        return "直前のアドバイスを深掘りしたい";
      case "manual":
      default:
        return undefined;
    }
  }

  private createInitialState(): NavigatorSessionState {
    return {
      screen: "onboarding",
      screenHistory: [],
      connectionState: this.connectionService.getState(),
      requestState: "idle",
      mode: "manual" satisfies AdviceMode,
      contextPreview: {
        diagnosticsSummary: []
      },
      conversationHistory: []
    };
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
