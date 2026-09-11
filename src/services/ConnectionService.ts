import * as vscode from "vscode";
import { OllamaClient, DEFAULT_OLLAMA_BASE_URL } from "./OllamaClient";
import {
  AiProviderId,
  ConnectionState,
  CopilotModelOption,
  LmStudioModelOption,
  NavigatorSettings,
  OrcaRouterModelOption
} from "../shared/types";
import { LmStudioClient, LmStudioError, LmStudioFailureKind, LmStudioModel } from "./LmStudioClient";
import {
  OrcaRouterClient,
  OrcaRouterError,
  OrcaRouterFailureKind
} from "./OrcaRouterClient";
import { createBuiltInOrcaRouterOptions, toOrcaRouterModelOptions } from "./OrcaRouterModelPolicy";
import { OrcaRouterCredentialStore } from "./OrcaRouterCredentialStore";
import type { ModelProfileSource } from "./ModelProfile";
import type { UsageMeter } from "./UsageMeter";
import {
  AiResponseLimitError,
  AiTextRequest,
  MAX_PROVIDER_MODEL_COUNT,
  getResponseCharacterLimit,
  normalizeProviderField
} from "./AiRequestPolicy";

export type LmStudioConnectionIssue = LmStudioFailureKind | "noLoadedModel" | "selectionCancelled";
export type CopilotConnectionIssue = "timeout" | "autoUnavailable" | "noPermissions" | "blocked" | "notFound" | "other";
export type OrcaRouterConnectionIssue = OrcaRouterFailureKind | "missingApiKey" | "modelNotFound";

const COPILOT_PROBE_TIMEOUT_SECONDS = 60;

export interface ProviderTextResponse {
  reasoningTokens?: number;
  tokensPerSecond?: number;
  timeToFirstTokenSeconds?: number;
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  requestId?: string;
  resolvedModelId?: string;
  finishReason?: string;
  providerAttemptCount?: number;
}

export interface ProviderRequestMetadata {
  referencedFilePaths: string[];
}

export interface ConnectedProviderModel {
  providerId: AiProviderId;
  modelId: string;
  modelLabel: string;
  profileSource: ModelProfileSource;
  endpoint?: string;
  requestText(
    request: AiTextRequest,
    token: vscode.CancellationToken,
    metadata?: ProviderRequestMetadata
  ): Promise<ProviderTextResponse>;
  countTokens?(text: string, token?: vscode.CancellationToken): Promise<number>;
}

export interface ConnectionActivationResult {
  connectionState: ConnectionState;
  activated: boolean;
  failureState?: ConnectionState;
  previousProviderId?: AiProviderId;
}

interface ConnectionSnapshot {
  connectionState: ConnectionState;
  providerId: AiProviderId;
  copilotModel: vscode.LanguageModelChat | undefined;
  connectedModel: ConnectedProviderModel | undefined;
}

export class ConnectionService {
  private connectionState: ConnectionState = "disconnected";
  private providerId: AiProviderId = "copilot";
  private copilotModel: vscode.LanguageModelChat | undefined;
  private connectedModel: ConnectedProviderModel | undefined;
  private availableModelOptions: CopilotModelOption[] = [];
  private availableLmStudioModelOptions: LmStudioModelOption[] = [];
  private availableOrcaRouterModelOptions: OrcaRouterModelOption[] = [];
  private availableOllamaModelOptions: LmStudioModelOption[] = [];
  private ollamaModelsBaseUrl: string | undefined;
  private ollamaStatus = "Ollama に接続してモデル一覧を取得してください。";
  private ollamaModelKeyChange: string | null | undefined;
  private lastUsedOllama: { baseUrl: string; model: string } | undefined;
  private ollamaRefreshRevision = 0;
  private pendingConnection: Promise<ConnectionActivationResult> | undefined;
  private lastLmStudioIssue: LmStudioConnectionIssue | undefined;
  private lmStudioModelKeyChange: string | null | undefined;
  private lastCopilotIssue: CopilotConnectionIssue | undefined;
  private lastOrcaRouterIssue: OrcaRouterConnectionIssue | undefined;

  public constructor(
    private readonly usageMeter: UsageMeter | undefined,
    private readonly lmStudioClient: LmStudioClient,
    private readonly orcaRouterClient: OrcaRouterClient,
    private readonly orcaRouterCredentials: OrcaRouterCredentialStore,
    private readonly languageModelAccessInformation?: vscode.LanguageModelAccessInformation,
    private readonly ollamaClient = new OllamaClient()
  ) {
    if (this.orcaRouterCredentials.isConfigured()) {
      this.availableOrcaRouterModelOptions = createBuiltInOrcaRouterOptions();
    }
  }

  public getOllamaModelOptions(): LmStudioModelOption[] { return this.availableOllamaModelOptions; }
  public getOllamaModelsBaseUrl(): string | undefined { return this.ollamaModelsBaseUrl; }
  public getOllamaStatus(): string { return this.ollamaStatus; }
  public consumeOllamaModelKeyChange(): string | null | undefined {
    const change = this.ollamaModelKeyChange;
    this.ollamaModelKeyChange = undefined;
    return change;
  }

  public async refreshAvailableOllamaModels(baseUrl: string): Promise<LmStudioModelOption[]> {
    const revision = ++this.ollamaRefreshRevision;
    if (!vscode.workspace.isTrusted) {
      this.availableOllamaModelOptions = [];
      this.ollamaModelsBaseUrl = undefined;
      this.ollamaStatus = "ワークスペースを信頼してから Ollama に接続してください。";
      return [];
    }
    try {
      const origin = this.ollamaClient.normalizeBaseUrl(baseUrl);
      const options = await this.ollamaClient.listModels(origin);
      if (revision !== this.ollamaRefreshRevision) return [];
      this.availableOllamaModelOptions = options;
      this.ollamaModelsBaseUrl = origin;
      this.ollamaStatus = options.length
        ? `Ollama に接続しました。インストール済みモデル: ${options.length} 件。`
        : "インストール済みのOllamaモデルがありません。Ollamaでモデルをインストールしてから再度お試しください。";
      return options;
    } catch (error) {
      if (revision !== this.ollamaRefreshRevision) return [];
      console.warn("NaviCom Ollama model discovery failed", error);
      this.availableOllamaModelOptions = [];
      this.ollamaModelsBaseUrl = undefined;
      this.ollamaStatus = "Ollamaに接続できませんでした。接続先URLと、Ollamaがインストール・起動済みであることを確認してください。";
      return [];
    }
  }

  private async unloadLastOllamaModel(): Promise<void> {
    const used = this.lastUsedOllama;
    this.lastUsedOllama = undefined;
    if (!used) return;
    try { await this.ollamaClient.unloadModel(used.baseUrl, used.model); }
    catch (error) { console.warn("NaviCom Ollama model unload failed", error); }
  }

  public getState(): ConnectionState {
    return this.connectionState;
  }

  public getProviderId(): AiProviderId {
    return this.providerId;
  }

  public getConnectedModel(): ConnectedProviderModel | undefined {
    return this.connectedModel;
  }

  public getModelOptions(): CopilotModelOption[] {
    return this.availableModelOptions;
  }

  public getLmStudioModelOptions(): LmStudioModelOption[] {
    return this.availableLmStudioModelOptions;
  }

  public clearLmStudioModelOptions(): void {
    this.availableLmStudioModelOptions = [];
  }

  public getOrcaRouterModelOptions(): OrcaRouterModelOption[] {
    return this.orcaRouterCredentials.isConfigured() ? this.availableOrcaRouterModelOptions : [];
  }

  public isOrcaRouterApiKeyConfigured(): boolean {
    return this.orcaRouterCredentials.isConfigured();
  }

  public async storeOrcaRouterApiKey(apiKey: string): Promise<void> {
    await this.orcaRouterCredentials.storeApiKey(apiKey);
    this.availableOrcaRouterModelOptions = createBuiltInOrcaRouterOptions();
    this.lastOrcaRouterIssue = undefined;
  }

  public async deleteOrcaRouterApiKey(): Promise<void> {
    await this.orcaRouterCredentials.deleteApiKey();
    this.availableOrcaRouterModelOptions = [];
    this.lastOrcaRouterIssue = "missingApiKey";
    if (this.providerId === "orcaRouter") {
      this.resetToDisconnected();
      this.providerId = "orcaRouter";
      this.lastOrcaRouterIssue = "missingApiKey";
    }
  }

  public getLastLmStudioIssue(): LmStudioConnectionIssue | undefined {
    return this.lastLmStudioIssue;
  }

  public getLastCopilotIssue(): CopilotConnectionIssue | undefined {
    return this.lastCopilotIssue;
  }

  public getLastOrcaRouterIssue(): OrcaRouterConnectionIssue | undefined {
    return this.lastOrcaRouterIssue;
  }

  public consumeLmStudioModelKeyChange(): string | null | undefined {
    const value = this.lmStudioModelKeyChange;
    this.lmStudioModelKeyChange = undefined;
    return value;
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

  public async refreshAvailableLmStudioModels(baseUrl: string): Promise<LmStudioModelOption[]> {
    try {
      const models = await this.lmStudioClient.listModels(baseUrl);
      this.availableLmStudioModelOptions = this.toLmStudioModelOptions(models);
      this.lastLmStudioIssue = this.availableLmStudioModelOptions.length > 0 ? undefined : "noLoadedModel";
    } catch (error) {
      this.availableLmStudioModelOptions = [];
      this.lastLmStudioIssue = this.classifyLmStudioIssue(error);
    }
    return this.availableLmStudioModelOptions;
  }

  public async refreshAvailableOrcaRouterModels(): Promise<OrcaRouterModelOption[]> {
    const apiKey = await this.orcaRouterCredentials.getApiKey();
    if (!apiKey) {
      this.lastOrcaRouterIssue = "missingApiKey";
      this.availableOrcaRouterModelOptions = [];
      return this.availableOrcaRouterModelOptions;
    }
    try {
      const models = await this.orcaRouterClient.listModels(apiKey);
      this.availableOrcaRouterModelOptions = toOrcaRouterModelOptions(models);
      this.lastOrcaRouterIssue = undefined;
    } catch (error) {
      this.lastOrcaRouterIssue = this.classifyOrcaRouterIssue(error);
      this.availableOrcaRouterModelOptions = createBuiltInOrcaRouterOptions();
    }
    return this.availableOrcaRouterModelOptions;
  }

  public async connectAndActivate(settings: NavigatorSettings): Promise<ConnectionActivationResult> {
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
    if (this.providerId === "ollama") this.ollamaStatus = "Ollama の生成に失敗しました。接続先とモデルを確認し、再接続してください。";
    return this.connectionState;
  }

  public resetToDisconnected(): ConnectionState {
    this.copilotModel = undefined;
    this.connectedModel = undefined;
    this.lastLmStudioIssue = undefined;
    this.lastCopilotIssue = undefined;
    this.lastOrcaRouterIssue = undefined;
    this.connectionState = "disconnected";
    return this.connectionState;
  }

  private async connectInternal(settings: NavigatorSettings): Promise<ConnectionActivationResult> {
    const previous = this.createSnapshot();
    this.providerId = settings.providerId;
    this.lastCopilotIssue = undefined;
    this.lastLmStudioIssue = undefined;
    this.lastOrcaRouterIssue = undefined;
    this.lmStudioModelKeyChange = undefined;
    this.ollamaModelKeyChange = undefined;

    if (!vscode.workspace.isTrusted) {
      if (settings.providerId === "ollama") this.ollamaStatus = "ワークスペースを信頼してから Ollama に接続してください。";
      this.connectionState = "unavailable";
      return this.finishFailedActivation(previous, this.connectionState);
    }

    this.connectionState = "connecting";
    const connectionState = await (settings.providerId === "ollama"
      ? this.connectOllama(settings)
      : settings.providerId === "lmStudio"
      ? this.connectLmStudio(settings)
      : settings.providerId === "orcaRouter"
        ? this.connectOrcaRouter(settings)
        : this.connectCopilot(settings.copilotModelId));

    if (connectionState === "connected") {
      if (settings.providerId !== "ollama") await this.unloadLastOllamaModel();
      return { connectionState, activated: true };
    }

    // A successful tags response proves that this previously active model was removed.
    // Do not restore a connection that is now known to be invalid.
    if (settings.providerId === "ollama" && this.ollamaModelKeyChange === null &&
        previous.connectedModel?.providerId === "ollama" &&
        previous.connectedModel.endpoint === this.ollamaModelsBaseUrl &&
        !this.availableOllamaModelOptions.some(option => option.key === previous.connectedModel?.modelId)) {
      return { connectionState, activated: false, failureState: connectionState };
    }
    return this.finishFailedActivation(previous, connectionState);
  }

  private createSnapshot(): ConnectionSnapshot {
    return {
      connectionState: this.connectionState,
      providerId: this.providerId,
      copilotModel: this.copilotModel,
      connectedModel: this.connectedModel
    };
  }

  private finishFailedActivation(
    previous: ConnectionSnapshot,
    failureState: ConnectionState
  ): ConnectionActivationResult {
    if (previous.connectionState === "connected" && previous.connectedModel) {
      this.connectionState = previous.connectionState;
      this.providerId = previous.providerId;
      this.copilotModel = previous.copilotModel;
      this.connectedModel = previous.connectedModel;
      return {
        connectionState: previous.connectionState,
        activated: false,
        failureState,
        previousProviderId: previous.providerId
      };
    }

    return { connectionState: failureState, activated: false, failureState };
  }

  private async connectCopilot(copilotModelId?: string): Promise<ConnectionState> {
    try {
      const models = await this.fetchCopilotModels(true);
      const manualSelectableModels = this.getManualSelectableCopilotModels(models, copilotModelId);
      this.availableModelOptions = manualSelectableModels.map((model) => this.toModelOption(model));
      const automaticModel = copilotModelId ? undefined : this.selectAutoRoutingCopilotModel(models);
      const selectedModel = copilotModelId
        ? manualSelectableModels.find((model) => model.id === copilotModelId)
        : automaticModel;

      if (!selectedModel) {
        this.lastCopilotIssue = copilotModelId ? "notFound" : "autoUnavailable";
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.copilotModel = selectedModel;
      this.connectedModel = this.createCopilotModel(selectedModel);
      this.connectionState = "consent_pending";
      await this.runProbe(selectedModel);
      this.connectionState = "connected";
    } catch (error) {
      this.copilotModel = undefined;
      this.connectedModel = undefined;
      this.lastCopilotIssue = this.classifyCopilotIssue(error);
      this.connectionState = this.classifyCopilotConnectError(error);
    }
    return this.connectionState;
  }

  private async connectOllama(settings: NavigatorSettings): Promise<ConnectionState> {
    const baseUrl = settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL;
    const options = await this.refreshAvailableOllamaModels(baseUrl);
    let selected = options.find(option => option.key === settings.ollamaModelKey);
    if (!selected && settings.ollamaModelKey && this.ollamaModelsBaseUrl) {
      this.ollamaModelKeyChange = null;
      if (options.length) this.ollamaStatus = "保存されたOllamaモデルが見つかりません。モデル一覧から選び直してください。";
    } else if (!selected && options.length) {
      selected = options.length === 1 ? options[0] : (await vscode.window.showQuickPick(
        options.map(option => ({ label: option.label, option })),
        { title: "Ollama のモデルを選択", placeHolder: "インストール済みモデルを選択してください" }
      ))?.option;
      if (selected) this.ollamaModelKeyChange = selected.key;
      else this.ollamaStatus = "使用するOllamaモデルを選択してください。";
    }
    if (!selected) {
      this.connectedModel = undefined;
      this.connectionState = "unavailable";
      return this.connectionState;
    }
    const origin = this.ollamaClient.normalizeBaseUrl(baseUrl);
    const modelKey = selected.key;
    this.copilotModel = undefined;
    this.connectedModel = {
      providerId: "ollama", modelId: modelKey, modelLabel: selected.label, endpoint: origin,
      profileSource: { id: modelKey, name: selected.label, vendor: "ollama" },
      requestText: async (request, token, metadata) => {
        if (token.isCancellationRequested) throw new Error("Cancelled");
        this.lastUsedOllama = { baseUrl: origin, model: modelKey };
        return this.ollamaClient.createCompletion(origin, modelKey, request, metadata?.referencedFilePaths, token);
      }
    };
    this.connectionState = "connected";
    return this.connectionState;
  }

  private async connectLmStudio(settings: NavigatorSettings): Promise<ConnectionState> {
    try {
      const models = await this.lmStudioClient.listModels(settings.lmStudioBaseUrl);
      this.availableLmStudioModelOptions = this.toLmStudioModelOptions(models);
      const selected = await this.resolveLmStudioModel(models, settings.lmStudioModelKey);
      if (!selected) {
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      const normalizedBaseUrl = this.lmStudioClient.normalizeBaseUrl(settings.lmStudioBaseUrl);
      this.copilotModel = undefined;
      this.connectedModel = this.createLmStudioModel(normalizedBaseUrl, selected);
      this.connectionState = "connected";
    } catch (error) {
      this.connectedModel = undefined;
      this.availableLmStudioModelOptions = [];
      this.lastLmStudioIssue = this.classifyLmStudioIssue(error);
      this.connectionState = "unavailable";
    }
    return this.connectionState;
  }

  private async connectOrcaRouter(settings: NavigatorSettings): Promise<ConnectionState> {
    try {
      const apiKey = await this.orcaRouterCredentials.getApiKey();
      if (!apiKey) {
        this.lastOrcaRouterIssue = "missingApiKey";
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      const models = await this.orcaRouterClient.listModels(apiKey);
      this.availableOrcaRouterModelOptions = toOrcaRouterModelOptions(models);
      const selectedId = settings.orcaRouterModelId ?? "orcarouter/free";
      const selected = this.availableOrcaRouterModelOptions.find((model) => model.id === selectedId);
      if (!selected) {
        this.lastOrcaRouterIssue = "modelNotFound";
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.copilotModel = undefined;
      this.connectedModel = this.createOrcaRouterModel(selected);
      this.lastOrcaRouterIssue = undefined;
      this.connectionState = "connected";
    } catch (error) {
      this.connectedModel = undefined;
      this.lastOrcaRouterIssue = this.classifyOrcaRouterIssue(error);
      this.connectionState = ["quota", "keyQuota", "cycleLimit", "balanceQuota", "rateLimit"].includes(this.lastOrcaRouterIssue)
        ? "restricted"
        : "unavailable";
    }
    return this.connectionState;
  }

  private async resolveLmStudioModel(
    models: LmStudioModel[],
    savedModelKey: string | undefined
  ): Promise<LmStudioModel | undefined> {
    const saved = savedModelKey ? models.find((model) => model.key === savedModelKey) : undefined;
    if (saved?.type === "llm" && saved.loadedInstanceCount > 0) {
      return saved;
    }

    if (savedModelKey) {
      this.lmStudioModelKeyChange = null;
    }

    const loadedModels = this.getLoadedLmStudioModels(models);
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
        title: "LM Studio のモデルを選択",
        placeHolder: "使用するロード済みモデルを選択してください"
      }
    );
    if (!choice) {
      this.lastLmStudioIssue = "selectionCancelled";
      return undefined;
    }

    this.lmStudioModelKeyChange = choice.model.key;
    return choice.model;
  }

  private getLoadedLmStudioModels(models: LmStudioModel[]): LmStudioModel[] {
    return models.filter((model) => model.type === "llm" && model.loadedInstanceCount > 0);
  }

  private toLmStudioModelOptions(models: LmStudioModel[]): LmStudioModelOption[] {
    const options = new Map<string, LmStudioModelOption>();
    for (const model of this.getLoadedLmStudioModels(models)) {
      if (!options.has(model.key)) {
        options.set(model.key, { key: model.key, label: model.label });
      }
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  private createCopilotModel(model: vscode.LanguageModelChat): ConnectedProviderModel {
    return {
      providerId: "copilot",
      modelId: model.id,
      modelLabel: this.toModelLabel(model),
      profileSource: model,
      requestText: async (request, token) => {
        const response = await model.sendRequest(
          [
            vscode.LanguageModelChatMessage.User(request.systemPrompt),
            vscode.LanguageModelChatMessage.User(request.userPrompt)
          ],
          { modelOptions: { max_tokens: request.maxOutputTokens } },
          token
        );
        let text = "";
        for await (const chunk of response.text) {
          if (text.length + chunk.length > getResponseCharacterLimit(request.purpose)) {
            throw new AiResponseLimitError();
          }
          text += chunk;
        }
        return { text };
      },
      countTokens: async (text, token) => model.countTokens(text, token)
    };
  }

  private createLmStudioModel(baseUrl: string, model: LmStudioModel): ConnectedProviderModel {
    return {
      providerId: "lmStudio",
      modelId: model.key,
      modelLabel: model.label,
      profileSource: {
        id: model.key,
        name: model.label,
        vendor: "lmstudio"
      },
      requestText: async (request, cancellationToken, metadata) => {
        return this.lmStudioClient.createCompletion(
          baseUrl,
          model.key,
          request,
          metadata?.referencedFilePaths,
          cancellationToken
        );
      }
    };
  }

  private createOrcaRouterModel(model: OrcaRouterModelOption): ConnectedProviderModel {
    return {
      providerId: "orcaRouter",
      modelId: model.id,
      modelLabel: model.label,
      profileSource: {
        id: model.id,
        name: model.label,
        vendor: model.provider,
        maxInputTokens: model.contextLength,
        maxOutputTokens: model.maxCompletionTokens
      },
      requestText: async (request, cancellationToken) => {
        const currentApiKey = await this.orcaRouterCredentials.getApiKey();
        if (!currentApiKey) {
          throw new OrcaRouterError("auth", "OrcaRouter API key is not configured.");
        }
        return this.orcaRouterClient.createCompletion(currentApiKey, model.id, request, cancellationToken);
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
    return selectable
      .sort((a, b) => this.toModelLabel(a).localeCompare(this.toModelLabel(b)))
      .slice(0, MAX_PROVIDER_MODEL_COUNT);
  }

  private selectAutoRoutingCopilotModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
    return models.find((model) => model.id && this.isAutoRoutingModel(model)
      && this.languageModelAccessInformation?.canSendRequest(model) !== false);
  }

  private isAutoRoutingModel(model: vscode.LanguageModelChat): boolean {
    return normalizeModelIdentifier(`${model.id} ${model.name} ${model.family} ${model.version} ${this.toModelLabel(model)}`).includes("auto");
  }

  private toModelOption(model: vscode.LanguageModelChat): CopilotModelOption {
    return { id: model.id, label: this.toModelLabel(model), tokenLimitText: this.toTokenLimitText(model) };
  }

  private toModelLabel(model: vscode.LanguageModelChat): string {
    return normalizeProviderField(model.name || model.family || model.id);
  }

  private toModelLabelKey(model: vscode.LanguageModelChat): string {
    return normalizeModelIdentifier(this.toModelLabel(model));
  }

  private toTokenLimitText(model: vscode.LanguageModelChat): string {
    return Number.isSafeInteger(model.maxInputTokens) && model.maxInputTokens > 0
      ? `${Math.floor(model.maxInputTokens).toLocaleString()} tokens`
      : "Token limit unavailable";
  }

  private async runProbe(model: vscode.LanguageModelChat): Promise<void> {
    const configuredSeconds = vscode.workspace.getConfiguration("aiPairNavigator").get<number>("copilotProbeTimeoutSeconds");
    const timeoutSeconds = typeof configuredSeconds === "number" && Number.isFinite(configuredSeconds)
      ? Math.min(180, Math.max(15, configuredSeconds)) : COPILOT_PROBE_TIMEOUT_SECONDS;
    const tokenSource = new vscode.CancellationTokenSource();
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const prompt = "Respond with exactly: ready";
      const probe = async (): Promise<string> => {
        const response = await model.sendRequest(
          [vscode.LanguageModelChatMessage.User(prompt)],
          { modelOptions: { max_tokens: 16 } },
          tokenSource.token
        );
        let responseText = "";
        for await (const chunk of response.text) {
          if (responseText.length + chunk.length > 128) {
            tokenSource.cancel();
            throw new AiResponseLimitError("Copilot probe response exceeded the size limit.");
          }
          responseText += chunk;
        }
        return responseText;
      };
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          tokenSource.cancel();
          reject(new CopilotProbeTimeoutError());
        }, timeoutSeconds * 1000);
      });
      const text = await Promise.race([probe(), timeout]);
      await this.recordProbeUsage(model, prompt, text);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
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
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === "NoPermissions") return "disconnected";
      if (error.code === "Blocked") return "restricted";
    }
    return "unavailable";
  }

  private classifyCopilotIssue(error: unknown): CopilotConnectionIssue {
    if (error instanceof CopilotProbeTimeoutError) return "timeout";
    if (!(error instanceof vscode.LanguageModelError)) return "other";
    if (error.code === "NoPermissions") return "noPermissions";
    if (error.code === "Blocked") return "blocked";
    if (error.code === "NotFound") return "notFound";
    return "other";
  }

  private classifyLmStudioIssue(error: unknown): LmStudioConnectionIssue {
    if (this.lastLmStudioIssue) return this.lastLmStudioIssue;
    return error instanceof LmStudioError ? error.kind : "other";
  }

  private classifyOrcaRouterIssue(error: unknown): OrcaRouterConnectionIssue {
    if (this.lastOrcaRouterIssue) return this.lastOrcaRouterIssue;
    return error instanceof OrcaRouterError ? error.kind : "other";
  }
}

class CopilotProbeTimeoutError extends Error {
  public constructor() {
    super("Copilot connection probe timed out.");
    this.name = "CopilotProbeTimeoutError";
  }
}

function normalizeModelIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
