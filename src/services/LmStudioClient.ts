import type * as vscode from "vscode";

export const LM_STUDIO_MODEL_LIST_TIMEOUT_MS = 5_000;
export const LM_STUDIO_COMPLETION_TIMEOUT_MS = 120_000;

export type LmStudioFailureKind = "auth" | "unreachable" | "timeout" | "invalidResponse" | "other";

export class LmStudioError extends Error {
  public constructor(
    public readonly kind: LmStudioFailureKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "LmStudioError";
  }
}

export interface LmStudioModel {
  key: string;
  label: string;
  type: string;
  loadedInstanceCount: number;
}

export interface LmStudioCompletion {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export class LmStudioClient {
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
      cancellationToken
    );

    const models = isRecord(payload) && Array.isArray(payload.models) ? payload.models : undefined;
    if (!models) {
      throw new LmStudioError("invalidResponse", "LM Studio model response did not include models.");
    }

    return models.flatMap((value) => {
      if (!isRecord(value) || typeof value.key !== "string" || !value.key.trim()) {
        return [];
      }

      const key = value.key.trim();
      const type = typeof value.type === "string" ? value.type : "unknown";
      const label = typeof value.display_name === "string" && value.display_name.trim()
        ? value.display_name.trim()
        : typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : key;
      const loadedInstanceCount = Array.isArray(value.loaded_instances) ? value.loaded_instances.length : 0;
      return [{ key, label, type, loadedInstanceCount }];
    });
  }

  public async createCompletion(
    baseUrl: string,
    modelKey: string,
    prompt: string,
    referencedFilePaths?: string[],
    cancellationToken?: vscode.CancellationToken
  ): Promise<LmStudioCompletion> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const payload = await this.requestJson(
      `${normalizedBaseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.createHeaders(),
        body: JSON.stringify({
          model: modelKey,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          ...(referencedFilePaths ? { navicom_referenced_files: referencedFilePaths } : {})
        })
      },
      LM_STUDIO_COMPLETION_TIMEOUT_MS,
      cancellationToken
    );

    const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : undefined;
    const firstChoice = choices?.[0];
    const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : undefined;
    const text = message ? this.readMessageContent(message.content) : undefined;
    if (!text) {
      throw new LmStudioError("invalidResponse", "LM Studio completion response did not include text.");
    }

    const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
    return {
      text,
      inputTokens: readNonNegativeInteger(usage?.prompt_tokens),
      outputTokens: readNonNegativeInteger(usage?.completion_tokens)
    };
  }

  private createHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const rawText = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new LmStudioError("auth", "LM Studio authentication failed.", response.status);
        }
        if (response.status === 408 || response.status === 504) {
          throw new LmStudioError("timeout", "LM Studio request timed out.", response.status);
        }
        throw new LmStudioError("other", `LM Studio request failed (${response.status}).`, response.status);
      }

      try {
        return JSON.parse(rawText) as unknown;
      } catch {
        throw new LmStudioError("invalidResponse", "LM Studio returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof LmStudioError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new LmStudioError("timeout", "LM Studio request timed out.");
      }
      if (error instanceof TypeError) {
        throw new LmStudioError("unreachable", "LM Studio server is unreachable.");
      }
      throw new LmStudioError("other", "LM Studio request failed.");
    } finally {
      clearTimeout(timeout);
      cancellation?.dispose();
    }
  }

  private readMessageContent(value: unknown): string | undefined {
    if (typeof value === "string") {
      return value.trim() || undefined;
    }
    if (!Array.isArray(value)) {
      return undefined;
    }

    const text = value
      .flatMap((part) => isRecord(part) && typeof part.text === "string" ? [part.text] : [])
      .join("")
      .trim();
    return text || undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
