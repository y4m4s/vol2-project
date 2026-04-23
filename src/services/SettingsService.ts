import * as vscode from "vscode";
import { NavigatorSettings } from "../shared/types";

const STORAGE_KEY = "aiPairNavigator.phase2.settings";

const PROTECTED_EXCLUDED_GLOBS = [
  "**/.git/**",
  "**/.hg/**",
  "**/.svn/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/venv/**",
  "**/env/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/.cache/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/target/**",
  "**/bin/**",
  "**/obj/**",
  "**/.env",
  "**/.env.*",
  "**/.npmrc",
  "**/.yarnrc.yml",
  "**/.aws/**",
  "**/.azure/**",
  "**/.gcloud/**",
  "**/*secret*",
  "**/*credential*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa",
  "**/id_ed25519",
  "**/*.sqlite",
  "**/*.sqlite3",
  "**/*.db",
  "**/*.zip",
  "**/*.tar",
  "**/*.tar.gz",
  "**/*.tgz",
  "**/*.7z",
  "**/*.rar"
];

const DEFAULT_SETTINGS: NavigatorSettings = {
  defaultMode: "manual",
  requestIntervalMs: 30000,
  idleDelayMs: 2000,
  protectedExcludedGlobs: PROTECTED_EXCLUDED_GLOBS,
  excludedGlobs: []
};

export class SettingsService {
  public constructor(private readonly storage: vscode.Memento) {}

  public getSettings(): NavigatorSettings {
    const saved = this.storage.get<Partial<NavigatorSettings>>(STORAGE_KEY);
    return this.mergeSettings(saved);
  }

  public async saveSettings(settings: NavigatorSettings): Promise<NavigatorSettings> {
    const normalized = this.mergeSettings(settings);
    await this.storage.update(STORAGE_KEY, normalized);
    return normalized;
  }

  public async resetSettings(): Promise<NavigatorSettings> {
    await this.storage.update(STORAGE_KEY, undefined);
    return this.getSettings();
  }

  private mergeSettings(partial?: Partial<NavigatorSettings>): NavigatorSettings {
    const customExcludedGlobs = this.normalizeCustomExcludedGlobs(partial?.excludedGlobs ?? []);

    return {
      defaultMode: partial?.defaultMode ?? DEFAULT_SETTINGS.defaultMode,
      requestIntervalMs: partial?.requestIntervalMs ?? DEFAULT_SETTINGS.requestIntervalMs,
      idleDelayMs: partial?.idleDelayMs ?? DEFAULT_SETTINGS.idleDelayMs,
      protectedExcludedGlobs: PROTECTED_EXCLUDED_GLOBS,
      excludedGlobs: customExcludedGlobs
    };
  }

  private normalizeCustomExcludedGlobs(patterns: string[]): string[] {
    const protectedPatterns = new Set(PROTECTED_EXCLUDED_GLOBS);
    const normalized: string[] = [];

    for (const pattern of patterns) {
      const value = pattern.trim();
      if (!value || protectedPatterns.has(value) || normalized.includes(value)) {
        continue;
      }
      normalized.push(value);
    }

    return normalized;
  }
}
