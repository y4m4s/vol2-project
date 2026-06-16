import * as vscode from "vscode";
import { ConnectionState } from "../shared/types";
import type { UsageMeter } from "./UsageMeter";

// 2026/6 の AI Credits 移行で無料モデルが廃止されたため、クレジット単価の安い順に選ぶ
// (GPT-4.1 / GPT-4o は廃止済み)
const LOW_COST_COPILOT_MODEL_PRIORITY = [
  {
    keys: ["gpt54nano"]
  },
  {
    keys: ["gpt5mini"]
  },
  {
    keys: ["raptormini"]
  },
  {
    keys: ["gemini3flash"]
  }
];

export class ConnectionService {
  private connectionState: ConnectionState = "disconnected";
  private model: vscode.LanguageModelChat | undefined;
  private pendingConnection: Promise<ConnectionState> | undefined;

  public constructor(private readonly usageMeter?: UsageMeter) {}

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

      const lowCostModel = this.selectLowCostCopilotModel(models);

      if (!lowCostModel) {
        this.model = undefined;
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.model = lowCostModel;
      this.connectionState = "consent_pending";

      await this.runProbe(this.model);

      this.connectionState = "connected";
    } catch (error) {
      this.model = undefined;
      this.connectionState = this.classifyConnectError(error);
    }

    return this.connectionState;
  }

  private selectLowCostCopilotModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
    for (const preference of LOW_COST_COPILOT_MODEL_PRIORITY) {
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
    const probePrompt = "Respond with exactly: ready";
    const messages = [vscode.LanguageModelChatMessage.User(probePrompt)];
    const response = await model.sendRequest(messages, {}, tokenSource.token);

    let text = "";
    for await (const chunk of response.text) {
      text += chunk;
    }

    await this.recordProbeUsage(model, probePrompt, text);
  }

  private async recordProbeUsage(model: vscode.LanguageModelChat, prompt: string, responseText: string): Promise<void> {
    if (!this.usageMeter) {
      return;
    }

    try {
      const [inputTokens, outputTokens] = await Promise.all([
        model.countTokens(prompt),
        responseText ? model.countTokens(responseText) : Promise.resolve(0)
      ]);
      await this.usageMeter.record({ inputTokens, outputTokens });
    } catch {
      await this.usageMeter.record({
        inputTokens: Math.ceil(prompt.length / 3),
        outputTokens: Math.ceil(responseText.length / 3)
      });
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
