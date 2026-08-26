import type * as vscode from "vscode";

const ORCA_ROUTER_API_KEY_SECRET = "aiPairNavigator.orcaRouter.apiKey";

export const ORCA_ROUTER_API_KEY_PREFIX = "sk-orca-";

/**
 * Stores the OrcaRouter API key in VS Code SecretStorage.
 *
 * The key value never touches workspaceState, the view model, conversation
 * history, or logs. The webview only learns whether a key is configured.
 */
export class OrcaRouterCredentialStore {
  private configured = false;

  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async initialize(): Promise<void> {
    this.configured = Boolean(await this.getApiKey());
  }

  public isConfigured(): boolean {
    return this.configured;
  }

  public async getApiKey(): Promise<string | undefined> {
    const value = await this.secrets.get(ORCA_ROUTER_API_KEY_SECRET);
    const normalized = value?.trim();
    return normalized || undefined;
  }

  public async storeApiKey(value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized.startsWith(ORCA_ROUTER_API_KEY_PREFIX) || normalized.length <= ORCA_ROUTER_API_KEY_PREFIX.length || normalized.length > 500) {
      throw new Error(`OrcaRouter API key must start with ${ORCA_ROUTER_API_KEY_PREFIX}.`);
    }
    await this.secrets.store(ORCA_ROUTER_API_KEY_SECRET, normalized);
    this.configured = true;
  }

  public async deleteApiKey(): Promise<void> {
    await this.secrets.delete(ORCA_ROUTER_API_KEY_SECRET);
    this.configured = false;
  }
}
