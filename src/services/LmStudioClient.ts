import type * as vscode from "vscode";
import { MAX_MODEL_LIST_RESPONSE_BYTES, MAX_PROVIDER_MODEL_COUNT, normalizeProviderField, type AiTextRequest } from "./AiRequestPolicy";
import { LOCAL_COMPLETION_TIMEOUT_MS, type OpenAICompatibleCompletion } from "./OpenAICompatibleClient";
import { OpenAICompatibleClient, OpenAICompatibleError as LmStudioError, LOCAL_MODEL_LIST_TIMEOUT_MS as LM_STUDIO_MODEL_LIST_TIMEOUT_MS } from "./OpenAICompatibleClient";
export { OpenAICompatibleError as LmStudioError, LOCAL_MODEL_LIST_TIMEOUT_MS as LM_STUDIO_MODEL_LIST_TIMEOUT_MS, LOCAL_COMPLETION_TIMEOUT_MS as LM_STUDIO_COMPLETION_TIMEOUT_MS } from "./OpenAICompatibleClient";
export type { OpenAICompatibleFailureKind as LmStudioFailureKind, OpenAICompatibleCompletion as LmStudioCompletion } from "./OpenAICompatibleClient";
export interface LmStudioModel {
  key: string;
  label: string;
  type: string;
  loadedInstanceCount: number;
  reasoningOptions?: string[];
}

export class LmStudioClient extends OpenAICompatibleClient {
  public override async createCompletion(baseUrl: string, modelKey: string, prompt: string | AiTextRequest,
    referencedFilePaths?: string[], cancellationToken?: vscode.CancellationToken): Promise<OpenAICompatibleCompletion> {
    if (typeof prompt === "string" || prompt.reasoningEffort === undefined) {
      return super.createCompletion(baseUrl, modelKey, prompt, referencedFilePaths, cancellationToken);
    }
    const origin = this.normalizeBaseUrl(baseUrl);
    const model = (await this.listModels(origin, cancellationToken)).find(item => item.key === modelKey);
    const options = model?.reasoningOptions ?? [];
    const reasoning = prompt.reasoningEffort === "none" ? "off" : options.includes("on") ? "on" : "high";
    if (!options.includes(reasoning)) {
      throw new LmStudioError("other", `LM StudioのモデルはThinking設定「${reasoning}」に対応していません。対応モデルを選択してください。`);
    }
    const payload = await this.requestJson(`${origin}/api/v1/chat`, {
      method: "POST", headers: this.createHeaders(),
      body: JSON.stringify({ model: modelKey, system_prompt: prompt.systemPrompt, input: prompt.userPrompt,
        reasoning, max_output_tokens: prompt.maxOutputTokens, stream: false, store: false, integrations: [] })
    }, LOCAL_COMPLETION_TIMEOUT_MS, cancellationToken);
    if (!isRecord(payload) || !Array.isArray(payload.output)) {
      throw new LmStudioError("invalidResponse", "LM Studio response did not include output.");
    }
    const messages = payload.output.filter(item => isRecord(item) && item.type === "message" && typeof item.content === "string");
    const stats = isRecord(payload.stats) ? payload.stats : {};
    const outputTokens = nonNegative(stats.total_output_tokens);
    const limited = outputTokens !== undefined && outputTokens >= prompt.maxOutputTokens;
    if (!messages.length && !limited) throw new LmStudioError("invalidResponse", "LM Studio response did not include a final message.");
    return {
      text: messages.map(item => item.content).join("\n"),
      inputTokens: nonNegative(stats.input_tokens), outputTokens,
      reasoningTokens: nonNegative(stats.reasoning_output_tokens),
      tokensPerSecond: nonNegative(stats.tokens_per_second),
      timeToFirstTokenSeconds: nonNegative(stats.time_to_first_token_seconds),
      finishReason: limited ? "length" : "stop",
      resolvedModelId: typeof payload.model_instance_id === "string" ? normalizeProviderField(payload.model_instance_id) : undefined
    };
  }

  public normalizeBaseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new LmStudioError("other", "Invalid LM Studio URL.");
    }

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const allowedHost = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
    const hasOnlyRootPath = url.pathname === "/" || url.pathname === "";

    if ((url.protocol !== "http:" && url.protocol !== "https:") || !allowedHost || !hasOnlyRootPath || url.search || url.hash) {
      throw new LmStudioError("other", "LM Studio URL must use a local host root URL.");
    }

    return url.origin;
  }

  public async listModels(
    baseUrl: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<LmStudioModel[]> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const payload = await this.requestJson(
      `${normalizedBaseUrl}/api/v1/models`,
      { method: "GET", headers: this.createHeaders() },
      LM_STUDIO_MODEL_LIST_TIMEOUT_MS,
      cancellationToken,
      MAX_MODEL_LIST_RESPONSE_BYTES
    );

    const models = isRecord(payload) && Array.isArray(payload.models) ? payload.models : undefined;
    if (!models) {
      throw new LmStudioError("invalidResponse", "LM Studio model response did not include models.");
    }

    return models.slice(0, MAX_PROVIDER_MODEL_COUNT).flatMap((value) => {
      if (!isRecord(value) || typeof value.key !== "string" || !value.key.trim()) {
        return [];
      }

      const key = normalizeProviderField(value.key);
      const type = typeof value.type === "string" ? normalizeProviderField(value.type, 100) : "unknown";
      const label = typeof value.display_name === "string" && value.display_name.trim()
        ? normalizeProviderField(value.display_name)
        : typeof value.name === "string" && value.name.trim()
          ? normalizeProviderField(value.name)
          : key;
      const loadedInstanceCount = Array.isArray(value.loaded_instances) ? value.loaded_instances.length : 0;
      const capabilities = isRecord(value.capabilities) ? value.capabilities : undefined;
      const reasoning = isRecord(capabilities?.reasoning) ? capabilities.reasoning : undefined;
      const reasoningOptions = Array.isArray(reasoning?.allowed_options)
        ? reasoning.allowed_options.filter((option): option is string => typeof option === "string" && ["off", "on", "low", "medium", "high"].includes(option)) : undefined;
      return [{ key, label, type, loadedInstanceCount, ...(reasoningOptions ? { reasoningOptions } : {}) }];
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
