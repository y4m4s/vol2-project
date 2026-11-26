/**
 * 学習プロファイル（既知の言語・習熟度・比較モード）の型と正規化。
 *
 * vscode に依存しない純粋ロジックなので、Extension Host・Webview・テストのどこからでも使える。
 * 設計: docs/18-learning-profile-and-comparison.md
 */

export type ProficiencyLevel = "basic" | "working" | "advanced";

/**
 * - off: 学習プロファイルを使わない（`/compare` も案内だけ）
 * - onRequest: 明示的な比較要求（`/compare`・質問文での指定）のときだけ使う
 * - suggest: 加えて、比較が役立ちそうなときに回答の後へ控えめな提案（チップ）を出す。AI は呼ばない
 * - auto: 加えて、比較が役立ちそうなときに助言の中へ短い比較を含める
 */
export type ComparisonMode = "off" | "onRequest" | "suggest" | "auto";

export interface KnownLanguage {
  /** 正規化済みの言語ファミリーID（LANGUAGE_CATALOG のキー） */
  languageId: LanguageFamilyId;
  /** 任意。未指定は「指定なし」 */
  level?: ProficiencyLevel;
}

export interface LearningProfile {
  schemaVersion: 1;
  /** 学習中の言語は設定せず、常に編集中のファイルの言語を使う（toLanguageFamily） */
  knownLanguages: KnownLanguage[];
  comparisonMode: ComparisonMode;
  /** 「この内容では今後出さない」を選んだ概念。キーは `${学習中の言語}:${概念ID}` */
  dismissedConcepts: string[];
  /**
   * つまずきの記録（Phase 3a・シャドーモード）。編集・診断の様子からつまずきの兆候を推定し、
   * NaviCom Diagnostics にだけ記録する。表示や AI への送信はしない
   */
  stuckDetectionEnabled: boolean;
}

interface LanguageCatalogEntry {
  label: string;
  /** VS Code の languageId（このファミリーに寄せるもの） */
  vscodeIds: readonly string[];
  /**
   * 質問文での言及を検出する別名。大文字小文字を区別しない。
   * 一般語と衝突しやすい別名（Go など）は caseSensitiveAliases に置く。
   */
  aliases: readonly string[];
  caseSensitiveAliases?: readonly string[];
}

/**
 * 学習プロファイルで選べる言語。VS Code の languageId をそのまま並べると json・markdown など
 * 比較の対象にならないものまで出るため、プログラミング言語だけをキュレーションしている。
 * C と C++ は別のファミリーにする（混同すると誤った類推の原因になりやすいため）。
 */
export const LANGUAGE_CATALOG = {
  javascript: { label: "JavaScript", vscodeIds: ["javascript", "javascriptreact"], aliases: ["JavaScript", "js", "ジャバスクリプト"] },
  typescript: { label: "TypeScript", vscodeIds: ["typescript", "typescriptreact"], aliases: ["TypeScript", "ts", "タイプスクリプト"] },
  python: { label: "Python", vscodeIds: ["python"], aliases: ["Python", "py", "パイソン"] },
  php: { label: "PHP", vscodeIds: ["php"], aliases: ["PHP"] },
  java: { label: "Java", vscodeIds: ["java"], aliases: ["Java"] },
  csharp: { label: "C#", vscodeIds: ["csharp"], aliases: ["C#", "csharp", "シーシャープ"] },
  cpp: { label: "C++", vscodeIds: ["cpp"], aliases: ["C++", "cpp"] },
  c: { label: "C", vscodeIds: ["c"], aliases: ["C言語"] },
  go: { label: "Go", vscodeIds: ["go"], aliases: ["Golang", "Go言語"], caseSensitiveAliases: ["Go"] },
  rust: { label: "Rust", vscodeIds: ["rust"], aliases: ["Rust"] },
  ruby: { label: "Ruby", vscodeIds: ["ruby"], aliases: ["Ruby", "ルビー"] },
  kotlin: { label: "Kotlin", vscodeIds: ["kotlin"], aliases: ["Kotlin"] },
  swift: { label: "Swift", vscodeIds: ["swift"], aliases: ["Swift"] },
  dart: { label: "Dart", vscodeIds: ["dart"], aliases: ["Dart"] },
  scala: { label: "Scala", vscodeIds: ["scala"], aliases: ["Scala"] },
  lua: { label: "Lua", vscodeIds: ["lua"], aliases: ["Lua"] },
  perl: { label: "Perl", vscodeIds: ["perl"], aliases: ["Perl"] }
} as const satisfies Record<string, LanguageCatalogEntry>;

export type LanguageFamilyId = keyof typeof LANGUAGE_CATALOG;

export const LANGUAGE_FAMILY_IDS = Object.keys(LANGUAGE_CATALOG) as LanguageFamilyId[];

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  basic: "基礎的な知識がある",
  working: "一般的な開発経験がある",
  advanced: "高度な知識・実務経験がある"
};

export const COMPARISON_MODE_LABELS: Record<ComparisonMode, string> = {
  off: "オフ",
  onRequest: "求めたときだけ",
  suggest: "控えめに提案する",
  auto: "助言に自動で含める"
};

export const AVAILABLE_COMPARISON_MODES: readonly ComparisonMode[] = ["off", "onRequest", "suggest", "auto"];

export const MAX_DISMISSED_CONCEPTS = 100;

export const MAX_KNOWN_LANGUAGES = 8;

export const DEFAULT_LEARNING_PROFILE: LearningProfile = {
  schemaVersion: 1,
  knownLanguages: [],
  comparisonMode: "onRequest",
  dismissedConcepts: [],
  stuckDetectionEnabled: true
};

export function isLanguageFamilyId(value: unknown): value is LanguageFamilyId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANGUAGE_CATALOG, value);
}

export function languageLabel(id: LanguageFamilyId): string {
  return LANGUAGE_CATALOG[id].label;
}

/** VS Code の languageId を言語ファミリーへ寄せる。カタログ外（json など）は undefined。 */
export function toLanguageFamily(vscodeLanguageId: string | undefined): LanguageFamilyId | undefined {
  if (!vscodeLanguageId) return undefined;
  const normalized = vscodeLanguageId.trim().toLowerCase();
  if (isLanguageFamilyId(normalized)) return normalized;
  return LANGUAGE_FAMILY_IDS.find((id) => (LANGUAGE_CATALOG[id].vscodeIds as readonly string[]).includes(normalized));
}

function isProficiencyLevel(value: unknown): value is ProficiencyLevel {
  return value === "basic" || value === "working" || value === "advanced";
}

function isComparisonMode(value: unknown): value is ComparisonMode {
  return value === "off" || value === "onRequest" || value === "suggest" || value === "auto";
}

/**
 * 保存値・Webview からの入力を正規化する。未知の言語・重複は捨て、件数を上限で切る。
 * 型が壊れていても例外にせず、既定値へ寄せる。
 */
export function normalizeLearningProfile(value: unknown): LearningProfile {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawLanguages = Array.isArray(source.knownLanguages) ? source.knownLanguages : [];
  const knownLanguages: KnownLanguage[] = [];
  for (const raw of rawLanguages) {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const languageId = toLanguageFamily(typeof entry.languageId === "string" ? entry.languageId : undefined);
    if (!languageId || knownLanguages.some((item) => item.languageId === languageId)) continue;
    knownLanguages.push(isProficiencyLevel(entry.level) ? { languageId, level: entry.level } : { languageId });
    if (knownLanguages.length >= MAX_KNOWN_LANGUAGES) break;
  }
  return {
    schemaVersion: 1,
    knownLanguages,
    comparisonMode: isComparisonMode(source.comparisonMode) ? source.comparisonMode : DEFAULT_LEARNING_PROFILE.comparisonMode,
    dismissedConcepts: normalizeDismissedConcepts(source.dismissedConcepts),
    stuckDetectionEnabled: typeof source.stuckDetectionEnabled === "boolean" ? source.stuckDetectionEnabled : DEFAULT_LEARNING_PROFILE.stuckDetectionEnabled
  };
}

/** 形式（`言語:概念`）に合うものだけを残し、重複を除いて新しいものを上限まで残す。 */
function normalizeDismissedConcepts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((item): item is string => typeof item === "string" && /^[a-z]+:[a-z_]+$/.test(item));
  return [...new Set(keys)].slice(-MAX_DISMISSED_CONCEPTS);
}
