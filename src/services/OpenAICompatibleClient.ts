import type * as vscode from "vscode";
import {
  AiResponseLimitError,
  AiTextRequest,
  MAX_PROVIDER_RESPONSE_BYTES,
  normalizeProviderField,
  readResponseTextWithLimit
} from "./AiRequestPolicy";

export const LOCAL_MODEL_LIST_TIMEOUT_MS = 5_000;
export const LOCAL_COMPLETION_TIMEOUT_MS = 120_000;

export type OpenAICompatibleFailureKind = "auth" | "unreachable" | "timeout" | "invalidResponse" | "other";

export class OpenAICompatibleError extends Error {
  public constructor(
    public readonly kind: OpenAICompatibleFailureKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "OpenAICompatibleError";
  }
}

export interface OpenAICompatibleCompletion {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  resolvedModelId?: string;
  finishReason?: string;
}

export abstract class OpenAICompatibleClient {
  public constructor(protected readonly providerName = "LM Studio") {}

  public abstract normalizeBaseUrl(value: string): string;

  public async createCompletion(
    baseUrl: string,
    modelKey: string,
    prompt: string | AiTextRequest,
    referencedFilePaths?: string[],
    cancellationToken?: vscode.CancellationToken
  ): Promise<OpenAICompatibleCompletion> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const request = normalizeTextRequest(prompt);
    const payload = await this.requestJson(
      `${normalizedBaseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.createHeaders(),
        body: JSON.stringify({
          model: modelKey,
          messages: request.systemPrompt
            ? [
                { role: "system", content: request.systemPrompt },
                { role: "user", content: request.userPrompt }
              ]
            : [{ role: "user", content: request.userPrompt }],
          stream: false,
          ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
          ...(referencedFilePaths ? { navicom_referenced_files: referencedFilePaths } : {})
        })
      },
      LOCAL_COMPLETION_TIMEOUT_MS,
      cancellationToken,
      MAX_PROVIDER_RESPONSE_BYTES
    );

    const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : undefined;
    const firstChoice = choices?.[0];
    const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : undefined;
    const text = message ? this.readMessageContent(message.content) : undefined;
    if (text === undefined) {
      throw new OpenAICompatibleError("invalidResponse", `${this.providerName} completion response did not include text.`);
    }

    const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
    const resolvedModelId = isRecord(payload) && typeof payload.model === "string" && payload.model.trim()
      ? normalizeProviderField(payload.model)
      : undefined;
    const finishReason = isRecord(firstChoice) && typeof firstChoice.finish_reason === "string"
      ? normalizeProviderField(firstChoice.finish_reason, 100)
      : undefined;
    return {
      text,
      inputTokens: readNonNegativeInteger(usage?.prompt_tokens),
      outputTokens: readNonNegativeInteger(usage?.completion_tokens),
      ...(resolvedModelId ? { resolvedModelId } : {}),
      ...(finishReason ? { finishReason } : {})
    };
  }

  protected createHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  protected async requestJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken,
    maxResponseBytes = MAX_PROVIDER_RESPONSE_BYTES
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (cancellationToken?.isCancellationRequested) controller.abort();
    const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());

    try {
      // 設定された送信先から別のホストへプロンプトを転送しない。
      const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
      const rawText = await readResponseTextWithLimit(response, maxResponseBytes);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new OpenAICompatibleError("auth", `${this.providerName} authentication failed.`, response.status);
        }
        if (response.status === 408 || response.status === 504) {
          throw new OpenAICompatibleError("timeout", `${this.providerName} request timed out.`, response.status);
        }
        throw new OpenAICompatibleError("other", `${this.providerName} request failed (${response.status}).`, response.status);
      }

      try {
        return JSON.parse(rawText) as unknown;
      } catch {
        throw new OpenAICompatibleError("invalidResponse", `${this.providerName} returned invalid JSON.`);
      }
    } catch (error) {
      if (error instanceof OpenAICompatibleError) {
        throw error;
      }
      if (error instanceof AiResponseLimitError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new OpenAICompatibleError("timeout", `${this.providerName} request timed out.`);
      }
      if (error instanceof TypeError) {
        throw new OpenAICompatibleError("unreachable", `${this.providerName} server is unreachable.`);
      }
      throw new OpenAICompatibleError("other", `${this.providerName} request failed.`);
    } finally {
      clearTimeout(timeout);
      cancellation?.dispose();
    }
  }

  private readMessageContent(value: unknown): string | undefined {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
