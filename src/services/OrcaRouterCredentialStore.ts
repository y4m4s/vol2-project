import type * as vscode from "vscode";

const ORCA_ROUTER_API_KEY_SECRET = "aiPairNavigator.orcaRouter.apiKey";

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
    if (!normalized.startsWith("sk-orca-") || normalized.length <= "sk-orca-".length || normalized.length > 500) {
      throw new Error("OrcaRouter API key must start with sk-orca-.");
    }
    await this.secrets.store(ORCA_ROUTER_API_KEY_SECRET, normalized);
    this.configured = true;
  }

  public async deleteApiKey(): Promise<void> {
    await this.secrets.delete(ORCA_ROUTER_API_KEY_SECRET);
    this.configured = false;
  }
}
