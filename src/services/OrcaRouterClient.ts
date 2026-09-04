import type * as vscode from "vscode";
import {
  AiResponseLimitError,
  AiTextRequest,
  MAX_MODEL_LIST_RESPONSE_BYTES,
  MAX_PROVIDER_MODEL_COUNT,
  MAX_PROVIDER_RESPONSE_BYTES,
  normalizeProviderField,
  readResponseTextWithLimit
} from "./AiRequestPolicy";

export const ORCA_ROUTER_BASE_URL = "https://api.orcarouter.ai/v1";
export const ORCA_ROUTER_MODEL_LIST_TIMEOUT_MS = 10_000;
export const ORCA_ROUTER_COMPLETION_TIMEOUT_MS = 120_000;
export const ORCA_ROUTER_MAX_AUTOMATIC_RETRY_DELAY_MS = 10_000;
const ORCA_ROUTER_TRANSIENT_RETRY_DELAY_MS = 400;

export type OrcaRouterFailureKind =
  | "auth"
  | "quota"
  | "rateLimit"
  | "unavailable"
  | "timeout"
  | "invalidResponse"
  | "other";

export class OrcaRouterError extends Error {
  public constructor(
    public readonly kind: OrcaRouterFailureKind,
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly retryAfter?: string
  ) {
    super(message);
    this.name = "OrcaRouterError";
  }
}

export interface OrcaRouterModel {
  id: string;
  ownedBy: string;
  supportedEndpointTypes: string[];
  contextLength?: number;
  maxCompletionTokens?: number;
  inputModalities: string[];
  outputModalities: string[];
}

export interface OrcaRouterCompletion {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  resolvedModelId?: string;
  requestId?: string;
  finishReason?: string;
  providerAttemptCount?: number;
}

interface OrcaRouterJsonResponse {
  payload: unknown;
  requestId?: string;
  resolvedModelId?: string;
  attemptCount: number;
}

type OrcaRouterRetryMode = "none" | "read" | "completion" | "freeCompletion";

/**
 * Minimal OpenAI-compatible client for the OrcaRouter gateway.
 *
 * Mirrors LmStudioClient: both speak the OpenAI /v1 chat completions shape over
 * fetch, so no OpenAI SDK dependency is needed. The base URL is pinned to the
 * OrcaRouter gateway so OrcaRouter remains a first-class named provider.
 */
export class OrcaRouterClient {
  public async listModels(
    apiKey: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<OrcaRouterModel[]> {
    const { payload } = await this.requestJson(
      `${ORCA_ROUTER_BASE_URL}/models`,
      { method: "GET", headers: this.createHeaders(apiKey) },
      ORCA_ROUTER_MODEL_LIST_TIMEOUT_MS,
      cancellationToken,
      "read",
      MAX_MODEL_LIST_RESPONSE_BYTES
    );
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : undefined;
    if (!data) {
      throw new OrcaRouterError("invalidResponse", "OrcaRouter model response did not include data.");
    }

    return data.slice(0, MAX_PROVIDER_MODEL_COUNT).flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
        return [];
      }
      const architecture = isRecord(value.architecture) ? value.architecture : undefined;
      return [{
        id: normalizeProviderField(value.id),
        ownedBy: typeof value.owned_by === "string" && value.owned_by.trim() ? normalizeProviderField(value.owned_by) : "unknown",
        supportedEndpointTypes: readStringArray(value.supported_endpoint_types),
        contextLength: readPositiveInteger(value.context_length),
        maxCompletionTokens: readPositiveInteger(value.max_completion_tokens),
        inputModalities: readStringArray(architecture?.input_modalities),
        outputModalities: readStringArray(architecture?.output_modalities)
      }];
    });
  }

  public async createCompletion(
    apiKey: string,
    modelId: string,
    prompt: string | AiTextRequest,
    cancellationToken?: vscode.CancellationToken
  ): Promise<OrcaRouterCompletion> {
    const request = normalizeTextRequest(prompt);
    const {
      payload,
      requestId,
      resolvedModelId: headerResolvedModelId,
      attemptCount: providerAttemptCount
    } = await this.requestJson(
      `${ORCA_ROUTER_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: this.createHeaders(apiKey, true),
        body: JSON.stringify({
          model: modelId,
          messages: request.systemPrompt
            ? [
                { role: "system", content: request.systemPrompt },
                { role: "user", content: request.userPrompt }
              ]
            : [{ role: "user", content: request.userPrompt }],
          stream: false,
          ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {})
        })
      },
      ORCA_ROUTER_COMPLETION_TIMEOUT_MS,
      cancellationToken,
      isFreeModel(modelId) ? "freeCompletion" : "completion",
      MAX_PROVIDER_RESPONSE_BYTES
    );

    const responseRecord = isRecord(payload) ? payload : undefined;
    const choices = responseRecord && Array.isArray(responseRecord.choices) ? responseRecord.choices : undefined;
    const firstChoice = choices?.[0];
    const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : undefined;
    const text = message ? readMessageContent(message.content) : undefined;
    if (text === undefined) {
      throw new OrcaRouterError("invalidResponse", "OrcaRouter completion response did not include text.");
    }
    const usage = responseRecord && isRecord(responseRecord.usage) ? responseRecord.usage : undefined;
    const resolvedModelId = headerResolvedModelId ?? (
      typeof responseRecord?.model === "string" && responseRecord.model.trim()
        ? normalizeProviderField(responseRecord.model)
        : undefined
    );
    const finishReason = isRecord(firstChoice) && typeof firstChoice.finish_reason === "string"
      ? normalizeProviderField(firstChoice.finish_reason, 100)
      : undefined;
    return {
      text,
      inputTokens: readNonNegativeInteger(usage?.prompt_tokens),
      outputTokens: readNonNegativeInteger(usage?.completion_tokens),
      costUsd: readNonNegativeNumber(usage?.cost_usd),
      ...(resolvedModelId ? { resolvedModelId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(finishReason ? { finishReason } : {}),
      providerAttemptCount
    };
  }

  private createHeaders(apiKey: string, includeCost = false): Record<string, string> {
    const normalized = apiKey.trim();
    if (!normalized.startsWith("sk-orca-")) {
      throw new OrcaRouterError("auth", "Invalid OrcaRouter API key.");
    }
    return {
      Authorization: `Bearer ${normalized}`,
      "Content-Type": "application/json",
      ...(includeCost ? { "X-OrcaRouter-Include-Cost": "true" } : {})
    };
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken,
    retryMode: OrcaRouterRetryMode = "none",
    maxResponseBytes = MAX_PROVIDER_RESPONSE_BYTES
  ): Promise<OrcaRouterJsonResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.requestJsonOnce(url, init, timeoutMs, cancellationToken, maxResponseBytes);
        return { ...response, attemptCount: attempt + 1 };
      } catch (error) {
        const retryDelayMs = this.resolveRetryDelay(error, retryMode, attempt, cancellationToken);
        if (retryDelayMs === undefined) {
          throw error;
        }
        await this.waitForRetry(retryDelayMs, cancellationToken);
      }
    }
  }

  private async requestJsonOnce(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken,
    maxResponseBytes = MAX_PROVIDER_RESPONSE_BYTES
  ): Promise<OrcaRouterJsonResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());
    try {
      const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
      const rawText = await readResponseTextWithLimit(response, maxResponseBytes);
      if (!response.ok) {
        const detail = readErrorDetail(rawText);
        throw new OrcaRouterError(
          classifyStatus(response.status),
          detail.message ?? `OrcaRouter request failed (${response.status}).`,
          response.status,
          detail.code,
          response.headers.get("retry-after") ?? undefined
        );
      }
      try {
        return {
          payload: JSON.parse(rawText) as unknown,
          requestId: readHeader(response.headers, "x-orca-request-id"),
          resolvedModelId: readHeader(response.headers, "x-orca-resolved-model"),
          attemptCount: 1
        };
      } catch {
        throw new OrcaRouterError("invalidResponse", "OrcaRouter returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof OrcaRouterError) {
        throw error;
      }
      if (error instanceof AiResponseLimitError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new OrcaRouterError("timeout", "OrcaRouter request timed out.");
      }
      if (error instanceof TypeError) {
        throw new OrcaRouterError("unavailable", "OrcaRouter is unreachable.");
      }
      throw new OrcaRouterError("other", "OrcaRouter request failed.");
    } finally {
      clearTimeout(timeout);
      cancellation?.dispose();
    }
  }

  private resolveRetryDelay(
    error: unknown,
    retryMode: OrcaRouterRetryMode,
    attempt: number,
    cancellationToken?: vscode.CancellationToken
  ): number | undefined {
    if (
      attempt > 0
      || retryMode === "none"
      || cancellationToken?.isCancellationRequested
      || !(error instanceof OrcaRouterError)
    ) {
      return undefined;
    }

    if (error.kind === "rateLimit" && error.retryAfter !== undefined) {
      const retryAfterSeconds = Number(error.retryAfter);
      const retryAfterMs = retryAfterSeconds * 1000;
      return Number.isFinite(retryAfterMs)
        && retryAfterMs >= 0
        && retryAfterMs <= ORCA_ROUTER_MAX_AUTOMATIC_RETRY_DELAY_MS
        ? retryAfterMs
        : undefined;
    }

    const canRetryTransient = retryMode === "read" || retryMode === "freeCompletion";
    if (!canRetryTransient) {
      return undefined;
    }
    if (
      error.kind === "invalidResponse"
      || error.kind === "unavailable"
      || error.status === 500
      || error.status === 502
      || error.status === 503
    ) {
      return ORCA_ROUTER_TRANSIENT_RETRY_DELAY_MS;
    }
    return undefined;
  }

  private async waitForRetry(
    delayMs: number,
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    if (delayMs <= 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cancellation?.dispose();
        resolve();
      }, delayMs);
      let cancellation: vscode.Disposable | undefined;
      cancellation = cancellationToken?.onCancellationRequested(() => {
        clearTimeout(timeout);
        cancellation?.dispose();
        const error = new Error("OrcaRouter retry was cancelled.");
        error.name = "AbortError";
        reject(error);
      });
    });
  }
}

function classifyStatus(status: number): OrcaRouterFailureKind {
  if (status === 401) return "auth";
  if (status === 402 || status === 403) return "quota";
  if (status === 429) return "rateLimit";
  if (status === 408 || status === 504) return "timeout";
  if (status === 425 || status === 500 || status === 502 || status === 503) return "unavailable";
  return "other";
}

function readErrorDetail(rawText: string): { message?: string; code?: string } {
  try {
    const payload = JSON.parse(rawText) as unknown;
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    return {
      message: typeof error?.message === "string" ? error.message : undefined,
      code: typeof error?.code === "string" ? error.code : undefined
    };
  } catch {
    return {};
  }
}

function readMessageContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const text = value
    .flatMap((part) => isRecord(part) && typeof part.text === "string" ? [part.text] : [])
    .join("")
    .trim();
  return text;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20)
        .map((item) => normalizeProviderField(item, 100))
    : [];
}

function normalizeTextRequest(value: string | AiTextRequest): {
  systemPrompt?: string;
  userPrompt: string;
  maxOutputTokens?: number;
} {
  return typeof value === "string"
    ? { userPrompt: value }
    : {
        systemPrompt: value.systemPrompt,
        userPrompt: value.userPrompt,
        maxOutputTokens: value.maxOutputTokens
      };
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)?.trim();
  return value ? normalizeProviderField(value) : undefined;
}

function isFreeModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized === "orcarouter/free" || normalized.endsWith("-free");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
