import * as vscode from "vscode";
import { NavigatorSettings } from "../shared/types";

const STORAGE_KEY = "aiPairNavigator.phase2.settings";

const DEFAULT_SETTINGS: NavigatorSettings = {
  defaultMode: "manual",
  alwaysModeEnabled: true,
  requestIntervalMs: 30000,
  idleDelayMs: 2000,
  suppressDuplicate: true,
  sendTargets: {
    activeFile: true,
    selection: true,
    diagnostics: true,
    recentEdits: true,
    relatedSymbols: true
  },
  excludedGlobs: ["**/.env", "**/dist/**", "**/build/**", "**/node_modules/**"]
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
    return {
      ...DEFAULT_SETTINGS,
      ...partial,
      sendTargets: {
        ...DEFAULT_SETTINGS.sendTargets,
        ...partial?.sendTargets
      },
      excludedGlobs: partial?.excludedGlobs?.length ? partial.excludedGlobs : DEFAULT_SETTINGS.excludedGlobs
    };
  }
}
