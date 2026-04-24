import * as vscode from "vscode";
import { ConnectionState } from "../shared/types";

const INCLUDED_COPILOT_MODEL_PRIORITY = [
  {
    keys: ["gpt41"]
  },
  {
    keys: ["gpt5mini"]
  },
  {
    keys: ["gpt4o"]
  }
];

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
      let models = await vscode.lm.selectChatModels({ vendor: "copilot" });

      // Copilot Chat がまだ起動中の場合があるため 1.5 秒待ってリトライ
      if (models.length === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      }

      const includedModel = this.selectIncludedCopilotModel(models);

      if (!includedModel) {
        this.model = undefined;
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.model = includedModel;
      this.connectionState = "consent_pending";

      await this.runProbe(this.model);

      this.connectionState = "connected";
    } catch (error) {
      this.model = undefined;
      this.connectionState = this.classifyConnectError(error);
    }

    return this.connectionState;
  }

  private selectIncludedCopilotModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
    for (const preference of INCLUDED_COPILOT_MODEL_PRIORITY) {
      const match = models.find((model) => this.matchesModelKeys(model, preference.keys));
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private matchesModelKeys(model: vscode.LanguageModelChat, keys: string[]): boolean {
    const searchable = normalizeModelIdentifier(
      `${model.id} ${model.name} ${model.family} ${model.version}`
    );

    return keys.some((key) => searchable.includes(key));
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

function normalizeModelIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
