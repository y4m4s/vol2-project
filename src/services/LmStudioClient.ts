import type * as vscode from "vscode";
import { MAX_MODEL_LIST_RESPONSE_BYTES, MAX_PROVIDER_MODEL_COUNT, normalizeProviderField } from "./AiRequestPolicy";
import { OpenAICompatibleClient, OpenAICompatibleError as LmStudioError, LOCAL_MODEL_LIST_TIMEOUT_MS as LM_STUDIO_MODEL_LIST_TIMEOUT_MS } from "./OpenAICompatibleClient";
export { OpenAICompatibleError as LmStudioError, LOCAL_MODEL_LIST_TIMEOUT_MS as LM_STUDIO_MODEL_LIST_TIMEOUT_MS, LOCAL_COMPLETION_TIMEOUT_MS as LM_STUDIO_COMPLETION_TIMEOUT_MS } from "./OpenAICompatibleClient";
export type { OpenAICompatibleFailureKind as LmStudioFailureKind, OpenAICompatibleCompletion as LmStudioCompletion } from "./OpenAICompatibleClient";
export interface LmStudioModel {
  key: string;
  label: string;
  type: string;
  loadedInstanceCount: number;
}

export class LmStudioClient extends OpenAICompatibleClient {
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
      return [{ key, label, type, loadedInstanceCount }];
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
