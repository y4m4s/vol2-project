import * as vscode from "vscode";
import { ConnectionState, CopilotModelOption } from "../shared/types";
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
  private availableModelOptions: CopilotModelOption[] = [];
  private pendingConnection: Promise<ConnectionState> | undefined;
  private usedAutoFallbackModel = false;

  public constructor(private readonly usageMeter?: UsageMeter) {}

  public getState(): ConnectionState {
    return this.connectionState;
  }

  public getModel(): vscode.LanguageModelChat | undefined {
    return this.model;
  }

  public getModelOptions(): CopilotModelOption[] {
    return this.availableModelOptions;
  }

  public didUseAutoFallbackModel(): boolean {
    return this.usedAutoFallbackModel;
  }

  public async refreshAvailableModels(): Promise<CopilotModelOption[]> {
    try {
      const models = await this.fetchCopilotModels(false);
      this.availableModelOptions = this.getSelectableCopilotModels(models).map((model) => this.toModelOption(model));
    } catch {
      this.availableModelOptions = [];
    }

    return this.availableModelOptions;
  }

  public async connect(copilotModelId?: string): Promise<ConnectionState> {
    if (this.pendingConnection) {
      return this.pendingConnection;
    }

    this.pendingConnection = this.connectInternal(copilotModelId).finally(() => {
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
    this.usedAutoFallbackModel = false;
    this.connectionState = "disconnected";
    return this.connectionState;
  }

  private async connectInternal(copilotModelId?: string): Promise<ConnectionState> {
    this.usedAutoFallbackModel = false;

    if (!vscode.workspace.isTrusted) {
      this.model = undefined;
      this.connectionState = "unavailable";
      return this.connectionState;
    }

    this.connectionState = "connecting";

    try {
      const models = await this.fetchCopilotModels(true);
      const selectableModels = this.getSelectableCopilotModels(models);
      this.availableModelOptions = selectableModels.map((model) => this.toModelOption(model));
      const lowCostModel = copilotModelId ? undefined : this.selectLowCostCopilotModel(selectableModels);
      const selectedModel = copilotModelId
        ? selectableModels.find((model) => model.id === copilotModelId)
        : lowCostModel ?? selectableModels[0];

      if (!selectedModel) {
        this.model = undefined;
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.usedAutoFallbackModel = !copilotModelId && !lowCostModel;
      this.model = selectedModel;
      this.connectionState = "consent_pending";

      await this.runProbe(this.model);

      this.connectionState = "connected";
    } catch (error) {
      this.model = undefined;
      this.usedAutoFallbackModel = false;
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

  private async fetchCopilotModels(retryIfEmpty: boolean): Promise<vscode.LanguageModelChat[]> {
    let models = await vscode.lm.selectChatModels({ vendor: "copilot" });

    // Copilot Chat がまだ起動中の場合があるため 1.5 秒待ってリトライ
    if (retryIfEmpty && models.length === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    }

    return models;
  }

  private getSelectableCopilotModels(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat[] {
    const seen = new Set<string>();
    const selectableModels: vscode.LanguageModelChat[] = [];

    for (const model of models) {
      if (!model.id || this.isAutoRoutingModel(model) || seen.has(model.id)) {
        continue;
      }

      seen.add(model.id);
      selectableModels.push(model);
    }

    return selectableModels.sort((a, b) => this.toModelLabel(a).localeCompare(this.toModelLabel(b)));
  }

  private isAutoRoutingModel(model: vscode.LanguageModelChat): boolean {
    const searchable = normalizeModelIdentifier(
      `${model.id} ${model.name} ${model.family} ${model.version} ${this.toModelLabel(model)}`
    );
    return searchable.includes("auto");
  }

  private toModelOption(model: vscode.LanguageModelChat): CopilotModelOption {
    return {
      id: model.id,
      label: this.toModelLabel(model),
      tokenLimitText: this.toTokenLimitText(model)
    };
  }

  private toModelLabel(model: vscode.LanguageModelChat): string {
    return model.name || model.family || model.id;
  }

  private toTokenLimitText(model: vscode.LanguageModelChat): string {
    return Number.isFinite(model.maxInputTokens) && model.maxInputTokens > 0
      ? `文脈上限：${Math.floor(model.maxInputTokens).toLocaleString()} tokens`
      : "文脈上限：未提供";
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
