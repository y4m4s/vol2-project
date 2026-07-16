import * as vscode from "vscode";

const LM_STUDIO_TOKEN_KEY = "aiPairNavigator.lmStudio.apiToken";

export class LmStudioSecretStore {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getToken(): Promise<string | undefined> {
    const value = await this.secrets.get(LM_STUDIO_TOKEN_KEY);
    return value?.trim() || undefined;
  }

  public async saveToken(value: string): Promise<void> {
    const token = value.trim();
    if (!token) {
      return;
    }
    await this.secrets.store(LM_STUDIO_TOKEN_KEY, token);
  }

  public async deleteToken(): Promise<void> {
    await this.secrets.delete(LM_STUDIO_TOKEN_KEY);
  }
}
