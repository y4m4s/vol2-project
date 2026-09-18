import * as vscode from "vscode";
import { canFallbackToTestedCopilot } from "../../shared/copilotFallback";
import { ConnectionService } from "../../services/ConnectionService";
import { LmStudioServerService } from "../../services/LmStudioServerService";
import { SettingsService } from "../../services/SettingsService";
import {
  AiProviderId,
  ConnectionState,
  LmStudioServerViewData,
  NavigatorSessionState,
  NavigatorSettings,
  NavigatorStatusMessage,
  RequestState
} from "../../shared/types";

export interface LmStudioCoordinatorHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  notifyStateChanged(): void;
  saveSettings(settings: NavigatorSettings): Promise<NavigatorSettings>;
  buildConnectionStatus(providerId: AiProviderId, state: ConnectionState): NavigatorStatusMessage;
}

export class LmStudioCoordinator {
  private server: LmStudioServerViewData = {
    state: "checking",
    canStart: false,
    canStop: false,
    message: "LM Studio サーバーの状態を確認しています…"
  };
  private pendingOperation?: Promise<void>;

  public constructor(
    private readonly connectionService: ConnectionService,
    private readonly serverService: LmStudioServerService,
    private readonly settingsService: SettingsService,
    private readonly host: LmStudioCoordinatorHost
  ) {}

  public getViewData(requestState: RequestState): LmStudioServerViewData {
    return {
      ...this.server,
      canStart: this.server.canStart && requestState === "idle",
      canStop: this.server.canStop && requestState === "idle"
    };
  }

  public async refreshModels(announce = true): Promise<void> {
    const options = await this.connectionService.refreshAvailableLmStudioModels(
      this.settingsService.getSettings().lmStudioBaseUrl
    );
    if (!announce) {
      this.host.notifyStateChanged();
      return;
    }

    this.host.patchSession({
      statusMessage: options.length > 0
        ? { kind: "info", text: `LM Studio のロード中モデルを ${options.length}件取得しました。` }
        : this.host.buildConnectionStatus("lmStudio", "unavailable")
    });
  }

  public async refreshServerStatus(announce = true): Promise<void> {
    if (this.pendingOperation) {
      await this.pendingOperation;
      return;
    }
    if (!vscode.workspace.isTrusted) {
      this.updateServer({
        state: "error",
        canStart: false,
        canStop: false,
        message: "Workspace Trust を有効にしてください。"
      });
      return;
    }

    this.updateServer({
      state: "checking",
      port: this.server.port,
      canStart: false,
      canStop: false,
      message: "LM Studio サーバーの状態を確認しています…"
    });

    try {
      const baseUrl = this.settingsService.getSettings().lmStudioBaseUrl;
      const status = await this.serverService.getStatus(baseUrl);
      if (isLmStudioApiReady(status)) {
        await this.connectionService.refreshAvailableLmStudioModels(baseUrl);
      } else {
        this.connectionService.clearLmStudioModelOptions();
      }
      const connectionStatus = status.state === "stopped"
        ? await this.reconcileStoppedServer()
        : undefined;
      this.updateServer(status);

      if (announce) {
        this.host.patchSession({
          statusMessage: connectionStatus ?? {
            kind: status.state === "running" ? "info" : status.state === "stopped" ? "warning" : "error",
            text: status.message ?? "LM Studio サーバーの状態を更新しました。"
          }
        });
      } else {
        this.host.notifyStateChanged();
      }
    } catch (error) {
      this.updateServer({
        state: "error",
        canStart: false,
        canStop: false,
        message: toErrorMessage(error, "LM Studio サーバーの状態を取得できませんでした。")
      });
    }
  }

  /**
   * NaviCom の外で LM Studio を起動・停止されても通知は届かないので、表示を実機の状態に
   * 追従させるための読み直し。refreshServerStatus と違い、statusMessage の上書きも
   * 停止時の自動フォールバックも行わないため、保存操作の途中に差し込んでも副作用がない。
   */
  public async syncServerStatus(): Promise<void> {
    if (this.pendingOperation) {
      await this.pendingOperation;
      return;
    }
    if (!vscode.workspace.isTrusted) return;

    this.updateServer({
      state: "checking",
      port: this.server.port,
      canStart: false,
      canStop: false,
      message: "LM Studio サーバーの状態を確認しています…"
    });

    try {
      const baseUrl = this.settingsService.getSettings().lmStudioBaseUrl;
      const status = await this.serverService.getStatus(baseUrl);
      if (isLmStudioApiReady(status)) {
        await this.connectionService.refreshAvailableLmStudioModels(baseUrl);
      } else {
        this.connectionService.clearLmStudioModelOptions();
      }
      this.updateServer(status);
    } catch (error) {
      this.updateServer({
        state: "error",
        canStart: false,
        canStop: false,
        message: toErrorMessage(error, "LM Studio サーバーの状態を取得できませんでした。")
      });
    }
  }

  public async startServer(): Promise<void> {
    if (this.pendingOperation) {
      await this.pendingOperation;
      return;
    }
    if (this.host.getState().requestState !== "idle") {
      this.host.patchSession({
        statusMessage: { kind: "warning", text: "現在の処理が完了してから LM Studio サーバーを起動してください。" }
      });
      return;
    }
    this.pendingOperation = this.performStart().finally(() => {
      this.pendingOperation = undefined;
    });
    await this.pendingOperation;
  }

  public async stopServer(): Promise<void> {
    if (this.pendingOperation) {
      await this.pendingOperation;
      return;
    }
    if (this.host.getState().requestState !== "idle") {
      this.host.patchSession({
        statusMessage: { kind: "warning", text: "回答生成が完了してから LM Studio サーバーを停止してください。" }
      });
      return;
    }
    this.pendingOperation = this.performStop().finally(() => {
      this.pendingOperation = undefined;
    });
    await this.pendingOperation;
  }

  public async checkServerForRoutingConnection(): Promise<boolean> {
    if (!vscode.workspace.isTrusted) return false;
    if (this.pendingOperation) await this.pendingOperation;
    try {
      const baseUrl = this.settingsService.getSettings().lmStudioBaseUrl;
      const current = await this.serverService.getStatus(baseUrl);
      if (current.state === "stopped") {
        const connectionStatus = await this.reconcileStoppedServer();
        if (connectionStatus) this.host.patchSession({ statusMessage: connectionStatus });
      }
      this.updateServer(current);
      return isLmStudioApiReady(current);
    } catch {
      return false;
    }
  }

  public async useRunningPort(): Promise<void> {
    const port = this.server.state === "portMismatch" ? this.server.port : undefined;
    if (!port || this.host.getState().requestState !== "idle") return;

    const settings = await this.host.saveSettings({
      ...this.settingsService.getSettings(),
      lmStudioBaseUrl: `http://127.0.0.1:${port}`
    });
    const result = settings.providerId === "lmStudio"
      ? await this.connectionService.connectAndActivate(settings)
      : undefined;
    await this.refreshServerStatus(false);
    this.host.patchSession({
      ...(result ? { connectionState: result.connectionState } : {}),
      statusMessage: {
        kind: result && !result.activated ? "warning" : "info",
        text: result && !result.activated
          ? `接続先を localhost:${port} に変更しましたが、モデルへの接続を確認できませんでした。`
          : `接続先を実行中の localhost:${port} に切り替えました。`
      }
    });
  }

  public async restartOnConfiguredPort(): Promise<void> {
    if (this.server.state !== "portMismatch" || this.host.getState().requestState !== "idle") return;
    this.host.patchSession({ requestState: "connecting" });
    try {
      const baseUrl = this.settingsService.getSettings().lmStudioBaseUrl;
      const stopped = await this.serverService.stop(baseUrl);
      if (stopped.state !== "stopped") {
        throw new Error(stopped.message ?? "LM Studio サーバーを停止できませんでした。");
      }
      const started = await this.serverService.start(baseUrl);
      this.updateServer(started);
      const settings = this.settingsService.getSettings();
      const result = started.state === "running" && settings.providerId === "lmStudio"
        ? await this.connectionService.connectAndActivate(settings)
        : undefined;
      this.host.patchSession({
        ...(result ? { connectionState: result.connectionState } : {}),
        requestState: "idle",
        statusMessage: {
          kind: started.state === "running" && (!result || result.activated) ? "info" : "error",
          text: started.state === "running" && result && !result.activated
            ? "設定ポートで再起動しましたが、モデルへの接続を確認できませんでした。"
            : started.state === "running"
              ? `設定ポート localhost:${started.port} で再起動しました。`
              : started.message ?? "設定ポートで再起動できませんでした。"
        }
      });
    } catch (error) {
      this.host.patchSession({
        requestState: "idle",
        statusMessage: { kind: "error", text: toErrorMessage(error, "設定ポートで再起動できませんでした。") }
      });
      await this.refreshServerStatus(false);
    }
  }

  private async performStart(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      this.updateServer({ state: "error", canStart: false, canStop: false, message: "Workspace Trust を有効にしてください。" });
      return;
    }

    this.host.patchSession({ requestState: "connecting" });
    this.updateServer({
      state: "starting",
      port: this.server.port,
      canStart: false,
      canStop: false,
      message: "LM Studio サーバーを起動しています…"
    });
    try {
      const baseUrl = this.settingsService.getSettings().lmStudioBaseUrl;
      const status = await this.serverService.start(baseUrl);
      this.updateServer(status);
      if (status.state !== "running") {
        this.host.patchSession({
          requestState: "idle",
          statusMessage: { kind: "error", text: status.message ?? "LM Studio サーバーを起動できませんでした。" }
        });
        return;
      }
      const options = await this.connectionService.refreshAvailableLmStudioModels(baseUrl);
      this.host.patchSession({
        requestState: "idle",
        statusMessage: options.length > 0
          ? { kind: "info", text: `LM Studio サーバーを起動し、ロード中モデルを ${options.length}件取得しました。` }
          : { kind: "warning", text: "LM Studio サーバーは起動しましたが、ロード中のモデルがありません。" }
      });
    } catch (error) {
      const message = toErrorMessage(error, "LM Studio サーバーを起動できませんでした。");
      this.updateServer({ state: "error", canStart: true, canStop: false, message });
      this.host.patchSession({ requestState: "idle", statusMessage: { kind: "error", text: message } });
    }
  }

  private async performStop(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      this.updateServer({ state: "error", canStart: false, canStop: false, message: "Workspace Trust を有効にしてください。" });
      return;
    }

    this.host.patchSession({ requestState: "connecting" });
    this.updateServer({
      state: "stopping",
      port: this.server.port,
      canStart: false,
      canStop: false,
      message: "LM Studio サーバーを停止しています…"
    });
    try {
      const baseUrl = this.settingsService.getSettings().lmStudioBaseUrl;
      const status = await this.serverService.stop(baseUrl);
      if (status.state !== "stopped") {
        this.updateServer(status);
        this.host.patchSession({
          requestState: "idle",
          statusMessage: { kind: "error", text: status.message ?? "LM Studio サーバーを停止できませんでした。" }
        });
        return;
      }

      this.connectionService.clearLmStudioModelOptions();
      const connectionStatus = await this.reconcileStoppedServer();
      this.updateServer(status);
      this.host.patchSession({
        requestState: "idle",
        statusMessage: connectionStatus ?? { kind: "info", text: "LM Studio サーバーを停止しました。" }
      });
    } catch (error) {
      const message = toErrorMessage(error, "LM Studio サーバーを停止できませんでした。");
      this.updateServer({ state: "error", canStart: false, canStop: true, message });
      this.host.patchSession({ requestState: "idle", statusMessage: { kind: "error", text: message } });
    }
  }

  private async reconcileStoppedServer(): Promise<NavigatorStatusMessage | undefined> {
    if (this.connectionService.getProviderId() !== "lmStudio") return undefined;

    const settings = this.settingsService.getSettings();
    this.connectionService.markUnavailable();
    const canFallback = canFallbackToTestedCopilot(
      settings,
      this.host.getState().conversationHistory,
      this.connectionService.getTestedModels(settings).some(model => model.providerId === "copilot")
    );
    if (canFallback && this.connectionService.activateTestedProvider("copilot", settings)) {
      await this.host.saveSettings({ ...settings, providerId: "copilot" });
      this.host.patchSession({ connectionState: "connected" });
      return { kind: "warning", text: "LM Studio サーバーが停止したため、接続確認済みのCopilotに切り替えました。" };
    }

    this.host.patchSession({ connectionState: "unavailable" });
    return {
      kind: "warning",
      text: "LM Studio サーバーが停止しました。自動切り替えは行っていません。接続先を確認してください。",
      action: "openConnectionSettings"
    };
  }

  private updateServer(value: LmStudioServerViewData): void {
    this.server = value;
    this.host.notifyStateChanged();
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isLmStudioApiReady(status: LmStudioServerViewData): boolean {
  return status.state === "running" || status.state === "statusMismatch";
}
