import * as vscode from "vscode";
import { AiProviderId, ConnectionState, CopilotModelOption, NavigatorSettings } from "../shared/types";
import { LmStudioClient, LmStudioError, LmStudioFailureKind, LmStudioModel } from "./LmStudioClient";
import { LmStudioSecretStore } from "./LmStudioSecretStore";
import type { UsageMeter } from "./UsageMeter";

export type LmStudioConnectionIssue = LmStudioFailureKind | "noLoadedModel" | "savedModelNotLoaded" | "selectionCancelled";

export interface ProviderTextResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ConnectedProviderModel {
  providerId: AiProviderId;
  modelId: string;
  modelLabel: string;
  requestText(prompt: string, token: vscode.CancellationToken): Promise<ProviderTextResponse>;
  countTokens?(text: string): Promise<number>;
}

export class ConnectionService {
  private connectionState: ConnectionState = "disconnected";
  private providerId: AiProviderId = "copilot";
  private copilotModel: vscode.LanguageModelChat | undefined;
  private connectedModel: ConnectedProviderModel | undefined;
  private availableModelOptions: CopilotModelOption[] = [];
  private pendingConnection: Promise<ConnectionState> | undefined;
  private usedAutomaticModelFallback = false;
  private lastLmStudioIssue: LmStudioConnectionIssue | undefined;
  private lmStudioModelKeyChange: string | null | undefined;

  public constructor(
    private readonly usageMeter: UsageMeter | undefined,
    private readonly lmStudioClient: LmStudioClient,
    private readonly lmStudioSecretStore: LmStudioSecretStore,
    private readonly languageModelAccessInformation?: vscode.LanguageModelAccessInformation
  ) {}

  public getState(): ConnectionState {
    return this.connectionState;
  }

  public getProviderId(): AiProviderId {
    return this.providerId;
  }

  public getConnectedModel(): ConnectedProviderModel | undefined {
    return this.connectedModel;
  }

  public normalizeLmStudioBaseUrl(value: string): string {
    return this.lmStudioClient.normalizeBaseUrl(value);
  }

  public async saveLmStudioToken(value: string): Promise<void> {
    await this.lmStudioSecretStore.saveToken(value);
  }

  public async deleteLmStudioToken(): Promise<void> {
    await this.lmStudioSecretStore.deleteToken();
  }

  // Kept temporarily for Copilot-specific callers during the provider migration.
  public getModel(): vscode.LanguageModelChat | undefined {
    return this.copilotModel;
  }

  public getModelOptions(): CopilotModelOption[] {
    return this.availableModelOptions;
  }

  public getLastLmStudioIssue(): LmStudioConnectionIssue | undefined {
    return this.lastLmStudioIssue;
  }

  public consumeLmStudioModelKeyChange(): string | null | undefined {
    const value = this.lmStudioModelKeyChange;
    this.lmStudioModelKeyChange = undefined;
    return value;
  }

  public didUseAutoFallbackModel(): boolean {
    return this.usedAutomaticModelFallback;
  }

  public async refreshAvailableModels(preferredModelId?: string): Promise<CopilotModelOption[]> {
    try {
      const models = await this.fetchCopilotModels(false);
      this.availableModelOptions = this.getManualSelectableCopilotModels(models, preferredModelId).map((model) => this.toModelOption(model));
    } catch {
      this.availableModelOptions = [];
    }
    return this.availableModelOptions;
  }

  public async connect(settings: NavigatorSettings): Promise<ConnectionState> {
    if (this.pendingConnection) {
      return this.pendingConnection;
    }

    this.pendingConnection = this.connectInternal(settings).finally(() => {
      this.pendingConnection = undefined;
    });
    return this.pendingConnection;
  }

  public markRestricted(): ConnectionState {
    this.connectionState = "restricted";
    return this.connectionState;
  }

  public markUnavailable(): ConnectionState {
    this.copilotModel = undefined;
    this.connectedModel = undefined;
    this.connectionState = "unavailable";
    return this.connectionState;
  }

  public resetToDisconnected(): ConnectionState {
    this.copilotModel = undefined;
    this.connectedModel = undefined;
    this.usedAutomaticModelFallback = false;
    this.lastLmStudioIssue = undefined;
    this.connectionState = "disconnected";
    return this.connectionState;
  }

  private async connectInternal(settings: NavigatorSettings): Promise<ConnectionState> {
    this.providerId = settings.providerId;
    this.usedAutomaticModelFallback = false;
    this.lastLmStudioIssue = undefined;
    this.lmStudioModelKeyChange = undefined;
    this.copilotModel = undefined;
    this.connectedModel = undefined;

    if (!vscode.workspace.isTrusted) {
      this.connectionState = "unavailable";
      return this.connectionState;
    }

    this.connectionState = "connecting";
    return settings.providerId === "lmStudio"
      ? this.connectLmStudio(settings)
      : this.connectCopilot(settings.copilotModelId);
  }

  private async connectCopilot(copilotModelId?: string): Promise<ConnectionState> {
    try {
      const models = await this.fetchCopilotModels(true);
      const manualSelectableModels = this.getManualSelectableCopilotModels(models, copilotModelId);
      this.availableModelOptions = manualSelectableModels.map((model) => this.toModelOption(model));
      const automaticModel = copilotModelId ? undefined : this.selectAutoRoutingCopilotModel(models);
      const selectedModel = copilotModelId
        ? manualSelectableModels.find((model) => model.id === copilotModelId)
        : automaticModel ?? manualSelectableModels[0];

      if (!selectedModel) {
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.usedAutomaticModelFallback = !copilotModelId && !automaticModel;
      this.copilotModel = selectedModel;
      this.connectedModel = this.createCopilotModel(selectedModel);
      this.connectionState = "consent_pending";
      await this.runProbe(selectedModel);
      this.connectionState = "connected";
    } catch (error) {
      this.copilotModel = undefined;
      this.connectedModel = undefined;
      this.usedAutomaticModelFallback = false;
      this.connectionState = this.classifyCopilotConnectError(error);
    }
    return this.connectionState;
  }

  private async connectLmStudio(settings: NavigatorSettings): Promise<ConnectionState> {
    try {
      const token = await this.lmStudioSecretStore.getToken();
      const models = await this.lmStudioClient.listModels(settings.lmStudioBaseUrl, token);
      const selected = await this.resolveLmStudioModel(models, settings.lmStudioModelKey);
      if (!selected) {
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      const normalizedBaseUrl = this.lmStudioClient.normalizeBaseUrl(settings.lmStudioBaseUrl);
      this.connectedModel = this.createLmStudioModel(normalizedBaseUrl, selected);
      this.connectionState = "connected";
    } catch (error) {
      this.connectedModel = undefined;
      this.lastLmStudioIssue = this.classifyLmStudioIssue(error);
      this.connectionState = "unavailable";
    }
    return this.connectionState;
  }

  private async resolveLmStudioModel(
    models: LmStudioModel[],
    savedModelKey: string | undefined
  ): Promise<LmStudioModel | undefined> {
    const saved = savedModelKey ? models.find((model) => model.key === savedModelKey) : undefined;
    if (savedModelKey && saved) {
      if (saved.loadedInstanceCount > 0) {
        return saved;
      }
      this.lastLmStudioIssue = "savedModelNotLoaded";
      return undefined;
    }

    if (savedModelKey && !saved) {
      this.lmStudioModelKeyChange = null;
    }

    const loadedModels = models.filter((model) => model.loadedInstanceCount > 0);
    if (loadedModels.length === 0) {
      this.lastLmStudioIssue = "noLoadedModel";
      return undefined;
    }
    if (loadedModels.length === 1) {
      this.lmStudioModelKeyChange = loadedModels[0].key;
      return loadedModels[0];
    }

    const choice = await vscode.window.showQuickPick(
      loadedModels.map((model) => ({ label: model.label, description: model.key, model })),
      {
        title: "NaviCom: Select an LM Studio model",
        placeHolder: "Select one loaded LM Studio model to use"
      }
    );
    if (!choice) {
      this.lastLmStudioIssue = "selectionCancelled";
      return undefined;
    }

    this.lmStudioModelKeyChange = choice.model.key;
    return choice.model;
  }

  private createCopilotModel(model: vscode.LanguageModelChat): ConnectedProviderModel {
    return {
      providerId: "copilot",
      modelId: model.id,
      modelLabel: this.toModelLabel(model),
      requestText: async (prompt, token) => {
        const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
        let text = "";
        for await (const chunk of response.text) {
          text += chunk;
        }
        return { text };
      },
      countTokens: async (text) => model.countTokens(text)
    };
  }

  private createLmStudioModel(baseUrl: string, model: LmStudioModel): ConnectedProviderModel {
    return {
      providerId: "lmStudio",
      modelId: model.key,
      modelLabel: model.label,
      requestText: async (prompt, cancellationToken) => {
        const token = await this.lmStudioSecretStore.getToken();
        return this.lmStudioClient.createCompletion(baseUrl, model.key, prompt, token, cancellationToken);
      }
    };
  }

  private async fetchCopilotModels(retryIfEmpty: boolean): Promise<vscode.LanguageModelChat[]> {
    let models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (retryIfEmpty && models.length === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    }
    return models;
  }

  private getManualSelectableCopilotModels(
    models: vscode.LanguageModelChat[],
    preferredModelId?: string
  ): vscode.LanguageModelChat[] {
    const seenIds = new Set<string>();
    const seenLabelIndexes = new Map<string, number>();
    const selectable: vscode.LanguageModelChat[] = [];
    for (const model of models) {
      if (
        !model.id ||
        this.isAutoRoutingModel(model) ||
        this.languageModelAccessInformation?.canSendRequest(model) === false ||
        seenIds.has(model.id)
      ) {
        continue;
      }

      seenIds.add(model.id);
      const labelKey = this.toModelLabelKey(model);
      const existingIndex = seenLabelIndexes.get(labelKey);
      if (existingIndex !== undefined) {
        if (model.id === preferredModelId) {
          selectable[existingIndex] = model;
        }
        continue;
      }

      seenLabelIndexes.set(labelKey, selectable.length);
      selectable.push(model);
    }
    return selectable.sort((a, b) => this.toModelLabel(a).localeCompare(this.toModelLabel(b)));
  }

  private selectAutoRoutingCopilotModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
    return models.find((model) => model.id && this.isAutoRoutingModel(model));
  }

  private isAutoRoutingModel(model: vscode.LanguageModelChat): boolean {
    return normalizeModelIdentifier(`${model.id} ${model.name} ${model.family} ${model.version} ${this.toModelLabel(model)}`).includes("auto");
  }

  private toModelOption(model: vscode.LanguageModelChat): CopilotModelOption {
    return { id: model.id, label: this.toModelLabel(model), tokenLimitText: this.toTokenLimitText(model) };
  }

  private toModelLabel(model: vscode.LanguageModelChat): string {
    return model.name || model.family || model.id;
  }

  private toModelLabelKey(model: vscode.LanguageModelChat): string {
    return normalizeModelIdentifier(this.toModelLabel(model));
  }

  private toTokenLimitText(model: vscode.LanguageModelChat): string {
    return Number.isFinite(model.maxInputTokens) && model.maxInputTokens > 0
      ? `${Math.floor(model.maxInputTokens).toLocaleString()} tokens`
      : "Token limit unavailable";
  }

  private async runProbe(model: vscode.LanguageModelChat): Promise<void> {
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const prompt = "Respond with exactly: ready";
      const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, tokenSource.token);
      let text = "";
      for await (const chunk of response.text) text += chunk;
      await this.recordProbeUsage(model, prompt, text);
    } finally {
      tokenSource.dispose();
    }
  }

  private async recordProbeUsage(model: vscode.LanguageModelChat, prompt: string, responseText: string): Promise<void> {
    if (!this.usageMeter) return;
    try {
      const [inputTokens, outputTokens] = await Promise.all([
        model.countTokens(prompt),
        responseText ? model.countTokens(responseText) : Promise.resolve(0)
      ]);
      await this.usageMeter.record({ providerId: "copilot", modelId: model.id, inputTokens, outputTokens });
    } catch {
      await this.usageMeter.record({
        providerId: "copilot",
        modelId: model.id,
        inputTokens: Math.ceil(prompt.length / 3),
        outputTokens: Math.ceil(responseText.length / 3)
      });
    }
  }

  private classifyCopilotConnectError(error: unknown): ConnectionState {
    return error instanceof vscode.LanguageModelError && error.code === "NoPermissions" ? "disconnected" : "unavailable";
  }

  private classifyLmStudioIssue(error: unknown): LmStudioConnectionIssue {
    if (this.lastLmStudioIssue) return this.lastLmStudioIssue;
    return error instanceof LmStudioError ? error.kind : "other";
  }
}

function normalizeModelIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
