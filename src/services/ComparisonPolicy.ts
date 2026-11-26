import type { GuidanceKind, SlashCommand } from "../shared/types";
import {
  LANGUAGE_CATALOG,
  LANGUAGE_FAMILY_IDS,
  type LanguageFamilyId,
  type LearningProfile,
  type ProficiencyLevel,
  languageLabel,
  toLanguageFamily
} from "../shared/learningProfile";

/**
 * 既知言語との比較で、プロファイルの背景をプロンプトへ含めるかを決める純粋ロジック（Phase 1）。
 *
 * Phase 1 で扱うのは明示的な比較要求だけ:
 *   - R2: 手動相談の質問文で、比較の語と一緒に言語を指定した場合
 *   - R3: `/compare`（引数で言語を1つ指定できる）
 * 送るプロファイルの言語は常に1つ。明示された言語を別の言語へ差し替えない。
 * 設計: docs/18-learning-profile-and-comparison.md（§5.0・§5.1 の Phase 1 部分）
 */

export interface LearnerBackground {
  compareLanguageId: LanguageFamilyId;
  compareLanguageLabel: string;
  level?: ProficiencyLevel;
  targetLanguageId?: LanguageFamilyId;
  targetLanguageLabel?: string;
  /** question: 質問文での指定、command: `/compare` の引数、auto: `/compare` の自動選択 */
  source: "question" | "command" | "auto";
}

export type ComparisonNoticeReason =
  | "no_profile"
  | "disabled"
  | "unregistered_language"
  | "multiple_languages"
  | "same_as_target"
  | "no_candidate";

export type ComparisonResolution =
  | { action: "none"; userPrompt?: string }
  | { action: "background"; background: LearnerBackground; userPrompt?: string }
  | { action: "notice"; reason: ComparisonNoticeReason; message: string };

export interface ComparisonRequest {
  profile: LearningProfile;
  kind: GuidanceKind;
  slashCommand?: SlashCommand;
  /** スラッシュコマンドを除いた入力（`/compare php この関数` なら `php この関数`） */
  userPrompt?: string;
  /** 編集中ファイルの VS Code languageId */
  activeLanguageId?: string;
}

const LEVEL_RANK: Record<ProficiencyLevel | "unspecified", number> = {
  advanced: 3,
  working: 2,
  unspecified: 1,
  basic: 0
};

// 言語名の「直後」にこれが続くとき、比較の要求とみなす（例: 「PHPでいう」「Pythonと比べて」「PHPとの違い」「PHPを比較」）。
// 直後に限るのは、「Pythonのバージョンの違い」のように、言語そのものについての質問を拾わないため。
const COMPARISON_PHRASE = /^\s*(?:を|と)?\s*(?:で(?:いう|言う)|と比べ|と比較|との?違い|の違い|みたいな|のような|に相当|風に|比較|vs\.?(?![A-Za-z]))/i;
// 前後がこれらの文字なら単語の一部とみなす（例: "Node.js" の "js"、"index.ts" の "ts"、"JavaScript" の "Java"）。
const WORD_BEFORE = "A-Za-z0-9_+#./\\\\-";
const WORD_AFTER = "A-Za-z0-9_+#";

interface LanguageMention {
  languageId: LanguageFamilyId;
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(aliases: readonly string[], flags: string): RegExp | undefined {
  if (!aliases.length) return undefined;
  const alternatives = [...aliases].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  return new RegExp(`(?<![${WORD_BEFORE}])(?:${alternatives})(?![${WORD_AFTER}])`, flags);
}

const MENTION_PATTERNS: { languageId: LanguageFamilyId; patterns: RegExp[] }[] = LANGUAGE_FAMILY_IDS.map((languageId) => {
  const entry: { aliases: readonly string[]; caseSensitiveAliases?: readonly string[] } = LANGUAGE_CATALOG[languageId];
  return {
    languageId,
    patterns: [aliasPattern(entry.aliases, "gi"), aliasPattern(entry.caseSensitiveAliases ?? [], "g")]
      .filter((pattern): pattern is RegExp => pattern !== undefined)
  };
});

/** 文中の言語への言及を、出現位置つきで列挙する。 */
export function findLanguageMentions(text: string): LanguageMention[] {
  const mentions: LanguageMention[] = [];
  for (const { languageId, patterns } of MENTION_PATTERNS) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        mentions.push({ languageId, start: match.index, end: match.index + match[0].length });
      }
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

/** トークン全体が1つの言語名・別名と一致すれば、その言語を返す（`/compare` の引数用）。 */
export function matchLanguageToken(token: string): LanguageFamilyId | undefined {
  const mention = findLanguageMentions(token).find((item) => item.start === 0 && item.end === token.length);
  return mention?.languageId;
}

/**
 * 質問文での明示的な比較要求（R2）を検出する。
 * 言語名の直後に比較の語が続く場合だけを明示要求とし、言語名が出てきただけでは数えない。
 * 学習中の言語自体への言及（「TypeScriptとPHPの違い」の TypeScript）は、指定された言語の数に含めない。
 */
export function detectExplicitComparison(text: string, targetLanguageId?: LanguageFamilyId): {
  explicit: boolean;
  languageIds: LanguageFamilyId[];
} {
  const mentions = findLanguageMentions(text);
  const explicit = mentions.some((mention) =>
    COMPARISON_PHRASE.test(text.slice(mention.end)));
  const languageIds: LanguageFamilyId[] = [];
  for (const mention of mentions) {
    if (mention.languageId !== targetLanguageId && !languageIds.includes(mention.languageId)) {
      languageIds.push(mention.languageId);
    }
  }
  return { explicit, languageIds };
}

function parseCompareArguments(userPrompt: string | undefined): { languageIds: LanguageFamilyId[]; rest?: string } {
  const tokens = userPrompt?.trim() ? userPrompt.trim().split(/\s+/) : [];
  const languageIds: LanguageFamilyId[] = [];
  let index = 0;
  for (; index < tokens.length; index++) {
    const languageId = matchLanguageToken(tokens[index]);
    if (!languageId) break;
    if (!languageIds.includes(languageId)) languageIds.push(languageId);
  }
  const rest = tokens.slice(index).join(" ").trim();
  return { languageIds, rest: rest || undefined };
}

function levelRank(level?: ProficiencyLevel): number {
  return LEVEL_RANK[level ?? "unspecified"];
}

function createBackground(
  profile: LearningProfile,
  languageId: LanguageFamilyId,
  targetLanguageId: LanguageFamilyId | undefined,
  source: LearnerBackground["source"]
): LearnerBackground {
  const known = profile.knownLanguages.find((item) => item.languageId === languageId);
  return {
    compareLanguageId: languageId,
    compareLanguageLabel: languageLabel(languageId),
    ...(known?.level ? { level: known.level } : {}),
    ...(targetLanguageId ? { targetLanguageId, targetLanguageLabel: languageLabel(targetLanguageId) } : {}),
    source
  };
}

/** 自動選択（決定順の順位4）。Phase 1 は習熟度の高い順、同点なら登録順。学習中の言語は除く。 */
export function selectComparisonLanguage(profile: LearningProfile, targetLanguageId?: LanguageFamilyId): LanguageFamilyId | undefined {
  return profile.knownLanguages
    .map((item, order) => ({ ...item, order }))
    .filter((item) => item.languageId !== targetLanguageId)
    .sort((a, b) => levelRank(b.level) - levelRank(a.level) || a.order - b.order)[0]?.languageId;
}

const NOTICE_MESSAGES = {
  no_profile: () => "学習プロファイルに経験のある言語が登録されていません。設定の「学習プロファイル」から登録すると、/compare で既知の言語と比べた説明を使えます。",
  disabled: () => "既知言語との比較はオフになっています。設定の「学習プロファイル」で「求めたときだけ」に切り替えると使えます。",
  unregistered_language: (label: string) => `${label} は学習プロファイルに登録されていません。設定の「学習プロファイル」から登録すると比較に使えます。`,
  multiple_languages: () => "比較する言語を1つだけ指定してください（例: /compare php）。",
  same_as_target: (label: string) => `${label} は学習中の言語と同じため、比較に使えません。別の言語を指定してください。`,
  no_candidate: () => "学習中の言語とは別の、経験のある言語が登録されていません。設定の「学習プロファイル」から登録してください。"
} as const;

function notice(reason: ComparisonNoticeReason, label = ""): ComparisonResolution {
  return { action: "notice", reason, message: NOTICE_MESSAGES[reason](label) };
}

/**
 * §5.0 の動作表のうち Phase 1 の範囲（off / onRequest 列の R1〜R4）を実装する。
 * suggest / auto は Phase 2 で追加するまで onRequest と同じに扱う。
 */
export function resolveComparisonRequest(request: ComparisonRequest): ComparisonResolution {
  const { profile, kind, slashCommand, userPrompt } = request;
  // 学習中の言語は、編集中のファイルの言語とみなす（カタログ外の言語なら undefined）。
  const targetLanguageId = toLanguageFamily(request.activeLanguageId);

  if (slashCommand === "compare") {
    if (!profile.knownLanguages.length) return notice("no_profile");
    if (profile.comparisonMode === "off") return notice("disabled");
    const args = parseCompareArguments(userPrompt);
    if (args.languageIds.length > 1) return notice("multiple_languages");
    const specified = args.languageIds[0];
    if (specified) {
      if (!profile.knownLanguages.some((item) => item.languageId === specified)) {
        return notice("unregistered_language", languageLabel(specified));
      }
      if (specified === targetLanguageId) return notice("same_as_target", languageLabel(specified));
      return { action: "background", background: createBackground(profile, specified, targetLanguageId, "command"), userPrompt: args.rest };
    }
    const selected = selectComparisonLanguage(profile, targetLanguageId);
    if (!selected) return notice("no_candidate");
    return { action: "background", background: createBackground(profile, selected, targetLanguageId, "auto"), userPrompt: args.rest };
  }

  // R4（他のスラッシュコマンド）と自動助言は、Phase 1 では背景を付けない。
  if (slashCommand || kind === "always") return { action: "none", userPrompt };
  if (!profile.knownLanguages.length || profile.comparisonMode === "off" || !userPrompt?.trim()) {
    return { action: "none", userPrompt };
  }

  // R2: 質問文での明示要求。登録済みの言語が1つだけ指定されたときに限り背景を付ける。
  const detected = detectExplicitComparison(userPrompt, targetLanguageId);
  if (!detected.explicit || detected.languageIds.length !== 1) return { action: "none", userPrompt };
  const [languageId] = detected.languageIds;
  if (!profile.knownLanguages.some((item) => item.languageId === languageId)) return { action: "none", userPrompt };
  return { action: "background", background: createBackground(profile, languageId, targetLanguageId, "question"), userPrompt };
}
