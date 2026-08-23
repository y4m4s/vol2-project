import * as vscode from "vscode";
import { AdviceScheduler } from "../../services/AdviceScheduler";
import { ConnectionActivationResult, ConnectionService } from "../../services/ConnectionService";
import { SettingsService } from "../../services/SettingsService";
import {
  AdviceMode,
  AiProviderId,
  AssistanceDepth,
  ConnectionState,
  NavigatorSessionState,
  NavigatorSettings,
  NavigatorStatusMessage
} from "../../shared/types";
import { resolveHomeScreen } from "./NavigationCoordinator";
import { normalizeAdditionalContext } from "../GuidanceInput";

export interface SettingsInput {
  providerId: AiProviderId;
  defaultMode: AdviceMode;
  defaultAssistanceDepth: AssistanceDepth;
  copilotModelId?: string;
  lmStudioModelKey?: string;
  idleDelaySec: number;
  requestIntervalSec: number;
  dailyTokenLimit: number;
  excludeGlobs: string;
}

interface ConnectionSettingsHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  collectContextPreview(): NavigatorSessionState["contextPreview"];
  notifyStateChanged(): void;
}

interface CopilotFallbackResult {
  connectionState: ConnectionState;
  settings: NavigatorSettings;
  statusMessage: NavigatorStatusMessage;
}

export class ConnectionSettingsCoordinator {
  private settingsRevision = 0;

  public constructor(
    private readonly connectionService: ConnectionService,
    private readonly settingsService: SettingsService,
    private readonly adviceScheduler: AdviceScheduler,
    private readonly host: ConnectionSettingsHost
  ) {}

  public get revision(): number {
    return this.settingsRevision;
  }

  public getCurrentProviderId(): AiProviderId {
    return this.connectionService.getProviderId();
  }

  public getCurrentModelIdentifier(): string | undefined {
    return this.connectionService.getConnectedModel()?.modelId;
  }

  public getCurrentModelLabel(): string | undefined {
    const model = this.connectionService.getConnectedModel();
    if (!model) {
      return undefined;
    }
    return `${model.providerId === "lmStudio" ? "LM Studio" : "GitHub Copilot"} · ${model.modelLabel}`;
  }

  public async connect(providerId?: AiProviderId): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle") {
      return;
    }

    this.host.patchSession({
      requestState: "connecting",
      connectionState: "connecting"
    });

    const currentSettings = this.settingsService.getSettings();
    const settings = providerId && providerId !== currentSettings.providerId
      ? { ...currentSettings, providerId }
      : currentSettings;
    const connectionResult = await this.connectionService.connectAndActivate(settings);
    const connectionState = connectionResult.connectionState;
    if (!connectionResult.activated && settings.providerId === "lmStudio") {
      const fallback = await this.restoreCopilotAfterLmStudioFailure(settings, connectionResult);
      this.host.patchSession({
        connectionState: fallback.connectionState,
        requestState: "idle",
        screen: fallback.connectionState === "connected" ? "main" : resolveHomeScreen(fallback.connectionState),
        mode: fallback.settings.defaultMode,
        assistanceDepth: fallback.settings.defaultAssistanceDepth,
        statusMessage: fallback.statusMessage,
        contextPreview: this.host.collectContextPreview()
      });
      return;
    }
    const effectiveSettings = connectionResult.activated
      ? await this.applyLmStudioModelKeyChange(await this.saveSettingsWithRevision(settings))
      : currentSettings;

    if (connectionResult.activated) {
      this.host.patchSession({
        connectionState,
        requestState: "idle",
        screen: "main",
        mode: effectiveSettings.defaultMode,
        assistanceDepth: effectiveSettings.defaultAssistanceDepth,
        statusMessage: this.buildAutoModelFallbackStatusMessage(),
        contextPreview: this.host.collectContextPreview()
      });
      return;
    }

    this.host.patchSession({
      connectionState,
      requestState: "idle",
      screen: resolveHomeScreen(connectionState),
      statusMessage: this.buildConnectionAttemptStatusMessage(settings.providerId, connectionResult)
    });
  }

  public async save(input: SettingsInput): Promise<void> {
    const previousSettings = this.settingsService.getSettings();
    const nextSettings: NavigatorSettings = {
      ...previousSettings,
      providerId: input.providerId,
      defaultMode: input.defaultMode,
      defaultAssistanceDepth: input.defaultAssistanceDepth,
      copilotModelId: input.copilotModelId,
      lmStudioModelKey: input.lmStudioModelKey,
      idleDelayMs: input.idleDelaySec * 1000,
      requestIntervalMs: input.requestIntervalSec * 1000,
      dailyTokenLimit: input.dailyTokenLimit,
      excludedGlobs: input.excludeGlobs
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    };

    const isConnected = this.connectionService.getState() === "connected";
    const canApplyAlways = input.defaultMode !== "always" || isConnected;
    const modelSettingChanged =
      previousSettings.providerId !== nextSettings.providerId ||
      previousSettings.copilotModelId !== nextSettings.copilotModelId ||
      previousSettings.lmStudioModelKey !== nextSettings.lmStudioModelKey;
    const connectionSettingChanged =
      modelSettingChanged ||
      this.connectionService.getProviderId() !== nextSettings.providerId ||
      this.connectionService.getState() !== "connected";

    if (input.defaultMode === "always" && isConnected) {
      this.adviceScheduler.resetPause();
    }

    if (connectionSettingChanged && this.host.getState().requestState === "idle") {
      this.host.patchSession({
        ...(canApplyAlways ? { mode: input.defaultMode } : {}),
        assistanceDepth: input.defaultAssistanceDepth,
        contextPreview: this.host.collectContextPreview()
      });
      await this.reconnectForModelSetting(nextSettings);
      return;
    }

    await this.saveSettingsWithRevision(nextSettings);
    this.host.patchSession({
      ...(canApplyAlways ? { mode: input.defaultMode } : {}),
      assistanceDepth: input.defaultAssistanceDepth,
      contextPreview: this.host.collectContextPreview(),
      statusMessage: {
        kind: connectionSettingChanged && isConnected ? "warning" : "info",
        text: connectionSettingChanged && isConnected
          ? "設定を保存しました。使用モデルは現在のリクエスト完了後、次回接続時に反映されます。"
          : "設定を保存しました。"
      }
    });
  }

  public async reset(): Promise<void> {
    const wasConnected = this.connectionService.getState() === "connected";
    const settings = await this.settingsService.resetSettings();
    this.settingsRevision += 1;
    this.host.patchSession({
      mode: "manual",
      assistanceDepth: "low",
      statusMessage: {
        kind: "info",
        text: "設定を初期値に戻しました。"
      }
    });

    if (wasConnected && this.host.getState().requestState === "idle") {
      await this.reconnectForModelSetting(settings);
    }
  }

  public async setAssistanceDepth(assistanceDepth: AssistanceDepth): Promise<void> {
    if (this.host.getState().requestState !== "idle") {
      return;
    }

    await this.saveSettingsWithRevision({
      ...this.settingsService.getSettings(),
      defaultAssistanceDepth: assistanceDepth
    });
    this.host.patchSession({ assistanceDepth, statusMessage: undefined });
  }

  public async setMode(mode: AdviceMode, additionalContext?: string): Promise<void> {
    const isConnected = this.connectionService.getState() === "connected";
    if (mode === "always" && !isConnected) {
      this.host.patchSession({
        statusMessage: {
          kind: "warning",
          text: "常時モードは AI 接続後に利用できます。"
        }
      });
      return;
    }

    await this.saveSettingsWithRevision({
      ...this.settingsService.getSettings(),
      defaultMode: mode
    });

    if (mode === "always") {
      this.adviceScheduler.resetPause();
    }

    const state = this.host.getState();
    const receivedAdditionalContext = additionalContext !== undefined;
    const normalizedAdditionalContext = normalizeAdditionalContext(additionalContext);
    this.host.patchSession({
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

  public async refreshCopilotModelOptions(): Promise<void> {
    await this.connectionService.refreshAvailableModels(this.settingsService.getSettings().copilotModelId);
    this.host.notifyStateChanged();
  }

  public async saveSettingsWithRevision(settings: NavigatorSettings): Promise<NavigatorSettings> {
    const saved = await this.settingsService.saveSettings(settings);
    this.settingsRevision += 1;
    return saved;
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

    return this.saveSettingsWithRevision({
      ...settings,
      lmStudioModelKey: nextModelKey ?? undefined
    });
  }

  public buildConnectionStatusMessageForProvider(
    providerId: AiProviderId,
    connectionState: ConnectionState
  ): NavigatorStatusMessage {
    if (providerId === "lmStudio") {
      if (!vscode.workspace.isTrusted) {
        return { kind: "error", text: "Workspace Trust を有効にしてから LM Studio に接続してください。" };
      }
      if (connectionState === "unavailable") {
        switch (this.connectionService.getLastLmStudioIssue()) {
          case "auth":
            return { kind: "error", text: "LM Studio の認証設定を確認してください。" };
          case "unreachable":
            return { kind: "error", text: "LM Studio サーバーに接続できません。起動状態を確認してください。" };
          case "timeout":
            return { kind: "error", text: "LM Studio の応答がタイムアウトしました。" };
          case "noLoadedModel":
            return { kind: "warning", text: "LM Studio でモデルをロードしてから接続してください。" };
          case "selectionCancelled":
            return { kind: "warning", text: "使用する LM Studio モデルを選択してください。" };
          default:
            return { kind: "error", text: "LM Studio への接続に失敗しました。" };
        }
      }
      if (connectionState === "disconnected") {
        return { kind: "warning", text: "LM Studio に接続してください。" };
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
          text: this.connectionService.getLastCopilotIssue() === "timeout"
            ? "Copilot の接続確認が15秒でタイムアウトしました。通信状態を確認して再試行してください。"
            : vscode.workspace.isTrusted
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

  private async reconnectForModelSetting(settings: NavigatorSettings): Promise<void> {
    this.host.patchSession({
      requestState: "connecting",
      connectionState: "connecting",
      statusMessage: {
        kind: "info",
        text: "設定を保存し、使用モデルを切り替えています..."
      }
    });

    const connectionResult = await this.connectionService.connectAndActivate(settings);
    const connectionState = connectionResult.connectionState;
    if (connectionResult.activated) {
      const effectiveSettings = await this.applyLmStudioModelKeyChange(await this.saveSettingsWithRevision(settings));
      const fallbackStatusMessage = this.buildAutoModelFallbackStatusMessage();
      this.host.patchSession({
        connectionState,
        requestState: "idle",
        mode: effectiveSettings.defaultMode,
        assistanceDepth: effectiveSettings.defaultAssistanceDepth,
        contextPreview: this.host.collectContextPreview(),
        statusMessage: fallbackStatusMessage ?? {
          kind: "info",
          text: `設定を保存し、使用モデルを ${this.getCurrentModelLabel() ?? "指定モデル"} に切り替えました。`
        }
      });
      return;
    }

    if (settings.providerId === "lmStudio") {
      const fallback = await this.restoreCopilotAfterLmStudioFailure(settings, connectionResult);
      this.host.patchSession({
        connectionState: fallback.connectionState,
        requestState: "idle",
        mode: fallback.connectionState === "connected" || fallback.settings.defaultMode !== "always"
          ? fallback.settings.defaultMode
          : this.host.getState().mode,
        assistanceDepth: fallback.settings.defaultAssistanceDepth,
        contextPreview: this.host.collectContextPreview(),
        statusMessage: fallback.statusMessage
      });
      return;
    }

    this.host.patchSession({
      connectionState,
      requestState: "idle",
      statusMessage: this.buildConnectionAttemptStatusMessage(settings.providerId, connectionResult)
    });
  }

  private async restoreCopilotAfterLmStudioFailure(
    attemptedSettings: NavigatorSettings,
    lmStudioResult: ConnectionActivationResult
  ): Promise<CopilotFallbackResult> {
    const lmStudioFailure = this.buildConnectionStatusMessageForProvider(
      "lmStudio",
      lmStudioResult.failureState ?? lmStudioResult.connectionState
    );
    const settings = await this.saveSettingsWithRevision({
      ...attemptedSettings,
      providerId: "copilot"
    });

    if (
      this.connectionService.getProviderId() !== "copilot" ||
      this.connectionService.getState() !== "connected"
    ) {
      this.connectionService.resetToDisconnected();
      await this.connectionService.connectAndActivate(settings);
    }

    const connectionState = this.connectionService.getState();
    const copilotConnected =
      connectionState === "connected" && this.connectionService.getProviderId() === "copilot";
    return {
      connectionState,
      settings,
      statusMessage: {
        kind: lmStudioFailure.kind,
        text: copilotConnected
          ? `${lmStudioFailure.text} Copilotに戻し、接続先設定もCopilotとして保存しました。`
          : `${lmStudioFailure.text} 接続先設定はCopilotに戻して保存しましたが、Copilotにも接続できませんでした。`
      }
    };
  }

  private buildConnectionAttemptStatusMessage(
    providerId: AiProviderId,
    result: ConnectionActivationResult
  ): NavigatorStatusMessage {
    if (result.activated) {
      return this.buildConnectionStatusMessageForProvider(providerId, result.connectionState);
    }

    const failureMessage = this.buildConnectionStatusMessageForProvider(
      providerId,
      result.failureState ?? result.connectionState
    );
    if (result.connectionState === "connected" && result.previousProviderId) {
      return {
        kind: failureMessage.kind,
        text: `${failureMessage.text} 現在の接続は維持し、接続先設定は保存していません。`
      };
    }
    return {
      kind: failureMessage.kind,
      text: `${failureMessage.text} 接続先設定は保存していません。`
    };
  }

  private buildAutoModelFallbackStatusMessage(): NavigatorStatusMessage | undefined {
    if (!this.connectionService.didUseAutoFallbackModel()) {
      return undefined;
    }

    return {
      kind: "warning",
      text: `Copilot の自動モデルルーティングが見つからなかったため、${this.getCurrentModelLabel() ?? "利用可能なモデル"} で接続しました。`
    };
  }
}
