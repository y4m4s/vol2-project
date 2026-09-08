import type * as vscode from "vscode";
import { MAX_MODEL_LIST_RESPONSE_BYTES, MAX_PROVIDER_MODEL_COUNT } from "./AiRequestPolicy";
import { OpenAICompatibleClient, OpenAICompatibleError } from "./OpenAICompatibleClient";
import type { LmStudioModelOption } from "../shared/types";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export class OllamaClient extends OpenAICompatibleClient {
  public constructor() { super("Ollama"); }

  public normalizeBaseUrl(value: string): string {
    let url: URL;
    try { url = new URL(value.trim()); }
    catch { throw new OpenAICompatibleError("other", "Invalid Ollama URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new OpenAICompatibleError("other", "Ollama URL must be an HTTP(S) root URL without credentials.");
    }
    return url.origin;
  }

  public async listModels(baseUrl: string, token?: vscode.CancellationToken): Promise<LmStudioModelOption[]> {
    const payload = await this.requestJson(`${this.normalizeBaseUrl(baseUrl)}/api/tags`,
      { method: "GET" }, 5000, token, MAX_MODEL_LIST_RESPONSE_BYTES);
    if (!payload || typeof payload !== "object" || !("models" in payload) || !Array.isArray(payload.models)) {
      throw new OpenAICompatibleError("invalidResponse", "Ollama model response did not include models.");
    }
    const names = new Set<string>();
    for (const model of payload.models.slice(0, MAX_PROVIDER_MODEL_COUNT)) {
      const name: unknown = model?.name ?? model?.model;
      // Keep the exact identifier; never silently truncate it into another model name.
      if (typeof name === "string" && name.trim() && name.length <= 500 && !/[\x00-\x1f\x7f]/.test(name)) names.add(name);
    }
    return [...names].map(key => ({ key, label: key }));
  }

  public async unloadModel(baseUrl: string, model: string): Promise<void> {
    await this.requestJson(`${this.normalizeBaseUrl(baseUrl)}/api/generate`, {
      method: "POST", headers: this.createHeaders(),
      body: JSON.stringify({ model, keep_alive: 0, stream: false })
    }, 2000);
  }
}
