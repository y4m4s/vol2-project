import * as vscode from "vscode";
import { ConnectionState } from "../shared/types";

export class ConnectionService {
  private connectionState: ConnectionState = "disconnected";
  private model: vscode.LanguageModelChat | undefined;
  private pendingConnection: Promise<ConnectionState> | undefined;

  public getState(): ConnectionState {
    return this.connectionState;
  }

  public getModel(): vscode.LanguageModelChat | undefined {
    return this.model;
  }

  public async connect(): Promise<ConnectionState> {
    if (this.pendingConnection) {
      return this.pendingConnection;
    }

    this.pendingConnection = this.connectInternal().finally(() => {
      this.pendingConnection = undefined;
    });

    return this.pendingConnection;
  }

  public markRestricted(): ConnectionState {
    this.connectionState = "restricted";
    return this.connectionState;
  }

  public resetToDisconnected(): ConnectionState {
    this.model = undefined;
    this.connectionState = "disconnected";
    return this.connectionState;
  }

  private async connectInternal(): Promise<ConnectionState> {
    if (!vscode.workspace.isTrusted) {
      this.model = undefined;
      this.connectionState = "unavailable";
      return this.connectionState;
    }

    this.connectionState = "connecting";

    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });

      if (models.length === 0) {
        this.model = undefined;
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.model = models[0];
      this.connectionState = "consent_pending";

      await this.runProbe(this.model);

      this.connectionState = "connected";
    } catch (error) {
      this.model = undefined;
      this.connectionState = this.classifyConnectError(error);
    }

    return this.connectionState;
  }

  private async runProbe(model: vscode.LanguageModelChat): Promise<void> {
    const tokenSource = new vscode.CancellationTokenSource();
    const messages = [vscode.LanguageModelChatMessage.User("Respond with exactly: ready")];
    const response = await model.sendRequest(messages, {}, tokenSource.token);

    for await (const _ of response.text) {
      /* consume */
    }
  }

  private classifyConnectError(error: unknown): ConnectionState {
    if (error instanceof vscode.LanguageModelError && error.code === "NoPermissions") {
      return "disconnected";
    }

    return "unavailable";
  }
}
