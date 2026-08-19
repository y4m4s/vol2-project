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
  providerId: "copilot",
  defaultMode: "manual",
  defaultAssistanceDepth: "low",
  lmStudioBaseUrl: "http://127.0.0.1:1234",
  requestIntervalMs: 60000,
  idleDelayMs: 10000,
  dailyBudgetUsd: 1.0,
  protectedExcludedGlobs: PROTECTED_EXCLUDED_GLOBS,
  excludedGlobs: []
};

const IDLE_DELAY_OPTIONS_MS = [5000, 10000, 15000] as const;
const REQUEST_INTERVAL_OPTIONS_MS = [20000, 60000, 180000] as const;
const DAILY_BUDGET_USD_OPTIONS = [0.5, 1.0, 2.0, 0] as const;

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
      providerId: this.normalizeProviderId(partial?.providerId),
      defaultMode: partial?.defaultMode ?? DEFAULT_SETTINGS.defaultMode,
      defaultAssistanceDepth: this.normalizeAssistanceDepth(partial?.defaultAssistanceDepth),
      copilotModelId: this.normalizeCopilotModelId(partial?.copilotModelId),
      lmStudioBaseUrl: this.normalizeLmStudioBaseUrl(partial?.lmStudioBaseUrl),
      lmStudioModelKey: this.normalizeLmStudioModelKey(partial?.lmStudioModelKey),
      requestIntervalMs: this.normalizeRequestIntervalMs(partial?.requestIntervalMs ?? DEFAULT_SETTINGS.requestIntervalMs),
      idleDelayMs: this.normalizeIdleDelayMs(partial?.idleDelayMs ?? DEFAULT_SETTINGS.idleDelayMs),
      dailyBudgetUsd: this.normalizeDailyBudgetUsd(partial?.dailyBudgetUsd ?? DEFAULT_SETTINGS.dailyBudgetUsd),
      protectedExcludedGlobs: PROTECTED_EXCLUDED_GLOBS,
      excludedGlobs: customExcludedGlobs
    };
  }

  private normalizeIdleDelayMs(value: number): number {
    return IDLE_DELAY_OPTIONS_MS.reduce((nearest, option) =>
      Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest
    );
  }

  private normalizeRequestIntervalMs(value: number): number {
    return REQUEST_INTERVAL_OPTIONS_MS.reduce((nearest, option) =>
      Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest
    );
  }

  private normalizeDailyBudgetUsd(value: number): number {
    return DAILY_BUDGET_USD_OPTIONS.reduce((nearest, option) =>
      Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest
    );
  }

  private normalizeAssistanceDepth(value: unknown): NavigatorSettings["defaultAssistanceDepth"] {
    return value === "high" ? "high" : DEFAULT_SETTINGS.defaultAssistanceDepth;
  }

  private normalizeCopilotModelId(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 && normalized !== "auto" ? normalized : undefined;
  }

  private normalizeProviderId(value: unknown): NavigatorSettings["providerId"] {
    return value === "lmStudio" ? "lmStudio" : "copilot";
  }

  private normalizeLmStudioBaseUrl(value: unknown): string {
    if (typeof value !== "string") {
      return DEFAULT_SETTINGS.lmStudioBaseUrl;
    }

    const normalized = value.trim().replace(/\/$/, "");
    return normalized || DEFAULT_SETTINGS.lmStudioBaseUrl;
  }

  private normalizeLmStudioModelKey(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();
    return normalized || undefined;
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
