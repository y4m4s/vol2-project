import type * as vscode from "vscode";
import { DEFAULT_LEARNING_PROFILE, LearningProfile, MAX_DISMISSED_CONCEPTS, normalizeLearningProfile } from "../shared/learningProfile";

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
    return saved === undefined ? normalizeLearningProfile(DEFAULT_LEARNING_PROFILE) : normalizeLearningProfile(saved);
  }

  /**
   * 渡された項目だけを置き換える。設定画面は dismissedConcepts を送らないことがあるので、
   * 省略された項目は保存済みの値を引き継ぐ（「今後出さない」を設定の保存で消さないため）。
   */
  public async saveProfile(profile: unknown): Promise<LearningProfile> {
    const partial = profile && typeof profile === "object" ? profile as Partial<LearningProfile> : {};
    const current = this.getProfile();
    const normalized = normalizeLearningProfile({
      ...current,
      ...partial,
      dismissedConcepts: partial.dismissedConcepts ?? current.dismissedConcepts
    });
    await this.storage.update(LEARNING_PROFILE_STORAGE_KEY, normalized);
    return normalized;
  }

  /** 「この内容では今後出さない」。キーは `${学習中の言語}:${概念ID}` */
  public async dismissConcept(key: string): Promise<LearningProfile> {
    const current = this.getProfile();
    if (current.dismissedConcepts.includes(key)) return current;
    return this.saveProfile({ ...current, dismissedConcepts: [...current.dismissedConcepts, key].slice(-MAX_DISMISSED_CONCEPTS) });
  }

  public async resetProfile(): Promise<LearningProfile> {
    await this.storage.update(LEARNING_PROFILE_STORAGE_KEY, undefined);
    return this.getProfile();
  }
}
