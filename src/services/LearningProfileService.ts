import type * as vscode from "vscode";
import { DEFAULT_LEARNING_PROFILE, LearningProfile, normalizeLearningProfile } from "../shared/learningProfile";

/**
 * 学習プロファイルはユーザーの属性なので、ワークスペース単位の設定（SettingsService は
 * workspaceState）ではなく globalState に独立したキーで保存する。
 * Settings Sync の対象にはしない（setKeysForSync を呼ばない）。
 */
export const LEARNING_PROFILE_STORAGE_KEY = "aiPairNavigator.learningProfile.v1";

export class LearningProfileService {
  public constructor(private readonly storage: Pick<vscode.Memento, "get" | "update">) {}

  public getProfile(): LearningProfile {
    const saved = this.storage.get<unknown>(LEARNING_PROFILE_STORAGE_KEY);
    return saved === undefined ? { ...DEFAULT_LEARNING_PROFILE, knownLanguages: [] } : normalizeLearningProfile(saved);
  }

  public async saveProfile(profile: unknown): Promise<LearningProfile> {
    const normalized = normalizeLearningProfile(profile);
    await this.storage.update(LEARNING_PROFILE_STORAGE_KEY, normalized);
    return normalized;
  }

  public async resetProfile(): Promise<LearningProfile> {
    await this.storage.update(LEARNING_PROFILE_STORAGE_KEY, undefined);
    return this.getProfile();
  }
}
