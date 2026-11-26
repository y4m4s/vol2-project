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
import {
  LANGUAGE_CONCEPTS,
  TRIVIAL_DIAGNOSTIC_CODES,
  findConcept,
  type ConceptCounterpart,
  type LanguageConcept
} from "../shared/languageConcepts";

/**
 * 既知言語との比較で、プロファイルの背景をプロンプトへ含めるか・比較を提案するかを決める純粋ロジック。
 *
 * - assessComparison(): 比較が内容的に成り立つか（モードを見ない）
 * - resolveComparisonRequest(): 相談の種類 × 比較モード × 明示要求の動作表。モードを判定する唯一の場所
 * - resolveSuggestionBackground(): 提案チップ（R8）をクリックしたときの背景
 * 送るプロファイルの言語は常に1つ。明示された言語を別の言語へ差し替えない。
 * 設計: docs/learning-support-design.md §5.0・§5.1、仕様: docs/18-learning-profile-and-comparison.md
 */

/** 診断1件の、ローカルだけで使う証拠。プロンプトには入れない（周辺のコードも送らない）。 */
export interface DiagnosticEvidence {
  source?: string;
  /** 正規化済みのコード（例 "2322"）。Diagnostic.code の target（URL）は捨てる */
  code?: string;
  message: string;
  /** 診断の範囲の前後2行のコード（ローカルの裏付けにだけ使う） */
  nearbyCode?: string;
}

export interface ComparisonEvidence {
  diagnostics: DiagnosticEvidence[];
  /** 選択範囲のテキスト */
  selectionText?: string;
  /** カーソルのある行 */
  cursorLine?: string;
  /** カーソルの前後数行（質問から出た候補の裏付けに使う） */
  cursorWindow?: string;
}

export const EMPTY_COMPARISON_EVIDENCE: ComparisonEvidence = { diagnostics: [] };

/** 同じ概念・言語の比較を再び出さない期間（設計書 H-13） */
export const RECENTLY_SHOWN_WINDOW_MS = 30 * 60 * 1000;

export interface LearnerBackground {
  compareLanguageId: LanguageFamilyId;
  compareLanguageLabel: string;
  level?: ProficiencyLevel;
  targetLanguageId?: LanguageFamilyId;
  targetLanguageLabel?: string;
  /** 着目する概念（裏付けが取れたときだけ） */
  concept?: { id: string; label: string };
  /** 概念について、比較に使う言語との対応 */
  counterpart?: ConceptCounterpart;
  /**
   * question: 質問文での指定、command: `/compare` の引数、auto: `/compare` の自動選択、
   * chip: 提案チップのクリック、inline: auto モードで助言に短く含める
   */
  source: "question" | "command" | "auto" | "chip" | "inline";
}

/** 比較を提案するときの内容（チップの文言と、クリック時に固定する言語・概念） */
export interface ComparisonSuggestionCandidate {
  languageId: LanguageFamilyId;
  conceptId: string;
  label: string;
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
  /** 背景は送らず、回答の後に比較チップを出す（suggest モード） */
  | { action: "suggest"; suggestion: ComparisonSuggestionCandidate; userPrompt?: string }
  | { action: "notice"; reason: ComparisonNoticeReason; message: string };

export interface ComparisonRequest {
  profile: LearningProfile;
  kind: GuidanceKind;
  slashCommand?: SlashCommand;
  /** スラッシュコマンドを除いた入力（`/compare php この関数` なら `php この関数`） */
  userPrompt?: string;
  /** 編集中ファイルの VS Code languageId */
  activeLanguageId?: string;
  /** ローカルの証拠（診断・選択・カーソル）。なければ概念を特定しない */
  evidence?: ComparisonEvidence;
  /** `${target}:${concept}:${language}` → 最後に提示した時刻 */
  recentlyShown?: ReadonlyMap<string, number>;
  now?: number;
}

export type ComparisonAssessment =
  | { applicable: false; reason: "no_profile" | "not_learning" | "no_candidate" | "unconfirmed" | "trivial" | "dismissed" | "no_counterpart" | "recently_shown" }
  | { applicable: true; languageId: LanguageFamilyId; concept: LanguageConcept; counterpart: ConceptCounterpart };

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

const SUPPORT_RANK: Record<ConceptCounterpart["support"], number> = { direct: 2, partial: 1, none: 0 };

export function recentlyShownKey(target: LanguageFamilyId | undefined, conceptId: string, languageId: LanguageFamilyId): string {
  return `${target ?? "unknown"}:${conceptId}:${languageId}`;
}

export function dismissedConceptKey(target: LanguageFamilyId | undefined, conceptId: string): string {
  return `${target ?? "unknown"}:${conceptId}`;
}

function createBackground(
  profile: LearningProfile,
  languageId: LanguageFamilyId,
  targetLanguageId: LanguageFamilyId | undefined,
  source: LearnerBackground["source"],
  concept?: LanguageConcept
): LearnerBackground {
  const known = profile.knownLanguages.find((item) => item.languageId === languageId);
  const counterpart = concept?.counterparts[languageId];
  return {
    compareLanguageId: languageId,
    compareLanguageLabel: languageLabel(languageId),
    ...(known?.level ? { level: known.level } : {}),
    ...(targetLanguageId ? { targetLanguageId, targetLanguageLabel: languageLabel(targetLanguageId) } : {}),
    ...(concept ? { concept: { id: concept.id, label: concept.label } } : {}),
    ...(counterpart ? { counterpart } : {}),
    source
  };
}

/** 自動選択（決定順の順位4）の、概念を使わない部分。習熟度の高い順、同点なら登録順。学習中の言語は除く。 */
export function selectComparisonLanguage(profile: LearningProfile, targetLanguageId?: LanguageFamilyId): LanguageFamilyId | undefined {
  return profile.knownLanguages
    .map((item, order) => ({ ...item, order }))
    .filter((item) => item.languageId !== targetLanguageId)
    .sort((a, b) => levelRank(b.level) - levelRank(a.level) || a.order - b.order)[0]?.languageId;
}

/** 概念に対応のある言語を、対応度（direct > partial）→ 習熟度 → 登録順で選ぶ。対応なし（none・未収録）は除く。 */
function selectCounterpartLanguage(
  profile: LearningProfile,
  concept: LanguageConcept,
  targetLanguageId: LanguageFamilyId | undefined,
  excluded: (languageId: LanguageFamilyId) => boolean = () => false
): LanguageFamilyId | undefined {
  return profile.knownLanguages
    .map((item, order) => ({ ...item, order, support: concept.counterparts[item.languageId]?.support ?? "none" }))
    .filter((item) => item.languageId !== targetLanguageId && item.support !== "none" && !excluded(item.languageId))
    .sort((a, b) => SUPPORT_RANK[b.support] - SUPPORT_RANK[a.support] || levelRank(b.level) - levelRank(a.level) || a.order - b.order)[0]
    ?.languageId;
}

interface ConceptDetection {
  /** 裏付けの取れた概念（候補の出た順） */
  confirmed: LanguageConcept[];
  /** 候補は出たが裏付けがなかった */
  unconfirmed: boolean;
  /** 診断はあったが、すべて些末なもの */
  trivialOnly: boolean;
}

function isTypeScriptDiagnostic(diagnostic: DiagnosticEvidence): boolean {
  return !diagnostic.source || /^(?:ts|typescript|js|javascript)$/i.test(diagnostic.source);
}

/**
 * 証拠から概念を検出する。候補の根拠とは別の種類の証拠で裏付けが取れたものだけを confirmed にする。
 *   - 診断コード → メッセージの形、または周辺のコード
 *   - 選択範囲・カーソル行のキーワード → その位置にあること自体を裏付けとする
 *   - 質問文の語 → カーソル付近のコードのキーワード、または同じ概念の診断
 */
export function detectConcepts(target: LanguageFamilyId, evidence: ComparisonEvidence, question?: string): ConceptDetection {
  const concepts = LANGUAGE_CONCEPTS.filter((concept) => concept.enabled && concept.targets.includes(target));
  const confirmed: LanguageConcept[] = [];
  let unconfirmed = false;
  const relevant = evidence.diagnostics.filter(isTypeScriptDiagnostic);
  const nonTrivial = relevant.filter((diagnostic) => !diagnostic.code || !TRIVIAL_DIAGNOSTIC_CODES.has(diagnostic.code));
  const focusCode = [evidence.selectionText, evidence.cursorLine].filter(Boolean).join("\n");
  const windowCode = [evidence.selectionText, evidence.cursorWindow ?? evidence.cursorLine].filter(Boolean).join("\n");

  for (const concept of concepts) {
    let candidate = false;
    let corroborated = false;
    for (const diagnostic of nonTrivial) {
      if (!diagnostic.code || !concept.diagnosticCodes.includes(diagnostic.code)) continue;
      if (concept.messageExclude?.test(diagnostic.message)) continue;
      candidate = true;
      if (concept.messagePattern?.test(diagnostic.message) || (diagnostic.nearbyCode && concept.nearbyPattern?.test(diagnostic.nearbyCode))) {
        corroborated = true;
      }
    }
    if (concept.codePattern && focusCode && concept.codePattern.test(focusCode)) {
      candidate = true;
      corroborated = true;
    }
    if (question && concept.questionPattern?.test(question)) {
      candidate = true;
      if (concept.codePattern?.test(windowCode)) corroborated = true;
    }
    if (corroborated) confirmed.push(concept);
    else if (candidate) unconfirmed = true;
  }
  return { confirmed, unconfirmed, trivialOnly: relevant.length > 0 && nonTrivial.length === 0 };
}

/**
 * 比較が内容的に成り立つかを判定する（設計書 §5.1 の手順 1〜9）。モードは見ない。
 * 明示要求（質問文・/compare・チップ）ではこの判定を使わず、言語の決定順に従う。
 */
export function assessComparison(request: Pick<ComparisonRequest, "profile" | "activeLanguageId" | "evidence" | "recentlyShown" | "now" | "userPrompt">): ComparisonAssessment {
  const { profile } = request;
  if (!profile.knownLanguages.length) return { applicable: false, reason: "no_profile" };
  const target = toLanguageFamily(request.activeLanguageId);
  // 学習中の言語を高い習熟度で登録している場合は、すでに詳しい言語なので比較しない。
  if (!target || profile.knownLanguages.some((item) => item.languageId === target && item.level === "advanced")) {
    return { applicable: false, reason: "not_learning" };
  }
  const detection = detectConcepts(target, request.evidence ?? EMPTY_COMPARISON_EVIDENCE, request.userPrompt);
  if (!detection.confirmed.length) {
    return { applicable: false, reason: detection.unconfirmed ? "unconfirmed" : detection.trivialOnly ? "trivial" : "no_candidate" };
  }
  const now = request.now ?? Date.now();
  const recent = (concept: LanguageConcept, languageId: LanguageFamilyId): boolean => {
    const shownAt = request.recentlyShown?.get(recentlyShownKey(target, concept.id, languageId));
    return shownAt !== undefined && now - shownAt < RECENTLY_SHOWN_WINDOW_MS;
  };
  let reason: "dismissed" | "no_counterpart" | "recently_shown" = "dismissed";
  for (const concept of detection.confirmed) {
    if (profile.dismissedConcepts.includes(dismissedConceptKey(target, concept.id))) continue;
    const anyCounterpart = selectCounterpartLanguage(profile, concept, target);
    if (!anyCounterpart) {
      reason = "no_counterpart";
      continue;
    }
    const languageId = selectCounterpartLanguage(profile, concept, target, (id) => recent(concept, id));
    if (!languageId) {
      reason = "recently_shown";
      continue;
    }
    return { applicable: true, languageId, concept, counterpart: concept.counterparts[languageId]! };
  }
  return { applicable: false, reason };
}

/** 明示要求で、言語が決まっているときに添える概念（裏付けのある最初の概念）。 */
function explicitConcept(target: LanguageFamilyId | undefined, evidence: ComparisonEvidence | undefined, question?: string): LanguageConcept | undefined {
  return target ? detectConcepts(target, evidence ?? EMPTY_COMPARISON_EVIDENCE, question).confirmed[0] : undefined;
}

const NOTICE_MESSAGES = {
  no_profile: () => "学習プロファイルに経験のある言語が登録されていません。設定の「学習プロファイル」から登録すると、/compare で既知の言語と比べた説明を使えます。",
  disabled: () => "既知言語との比較はオフになっています。設定の「学習プロファイル」で「求めたときだけ」などに切り替えると使えます。",
  unregistered_language: (label: string) => `${label} は学習プロファイルに登録されていません。設定の「学習プロファイル」から登録すると比較に使えます。`,
  multiple_languages: () => "比較する言語を1つだけ指定してください（例: /compare php）。",
  same_as_target: (label: string) => `${label} は学習中の言語と同じため、比較に使えません。別の言語を指定してください。`,
  no_candidate: () => "学習中の言語とは別の、経験のある言語が登録されていません。設定の「学習プロファイル」から登録してください。"
} as const;

function notice(reason: ComparisonNoticeReason, label = ""): ComparisonResolution {
  return { action: "notice", reason, message: NOTICE_MESSAGES[reason](label) };
}

function suggestionLabel(languageId: LanguageFamilyId, concept: LanguageConcept): string {
  return `${languageLabel(languageId)}と比べて「${concept.label}」を説明する`;
}

/**
 * 相談の種類 × 比較モード × 明示要求の動作表（設計書 §5.0）。モードを判定する唯一の場所。
 *
 * | 相談の種類                         | off  | onRequest | suggest          | auto            |
 * |------------------------------------|------|-----------|------------------|-----------------|
 * | R1 手動相談（明示なし）            | なし | なし      | 適用可ならチップ | 適用可なら背景  |
 * | R2 手動相談（登録済みの言語を1つ） | なし | 背景      | 背景             | 背景            |
 * | R3 /compare                        | 案内 | 背景      | 背景             | 背景            |
 * | R4 他のスラッシュコマンド          | なし | なし      | なし             | なし            |
 * | R5 自動助言                        | なし | なし      | 適用可ならチップ | 適用可なら背景  |
 * R8（チップのクリック）は resolveSuggestionBackground() で扱う。
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
    const concept = explicitConcept(targetLanguageId, request.evidence, args.rest);
    const specified = args.languageIds[0];
    if (specified) {
      if (!profile.knownLanguages.some((item) => item.languageId === specified)) {
        return notice("unregistered_language", languageLabel(specified));
      }
      if (specified === targetLanguageId) return notice("same_as_target", languageLabel(specified));
      return { action: "background", background: createBackground(profile, specified, targetLanguageId, "command", concept), userPrompt: args.rest };
    }
    const selected = (concept && selectCounterpartLanguage(profile, concept, targetLanguageId)) ?? selectComparisonLanguage(profile, targetLanguageId);
    if (!selected) return notice("no_candidate");
    return { action: "background", background: createBackground(profile, selected, targetLanguageId, "auto", concept), userPrompt: args.rest };
  }

  // R4: 他のスラッシュコマンドには付けない。
  if (slashCommand) return { action: "none", userPrompt };
  if (!profile.knownLanguages.length || profile.comparisonMode === "off") return { action: "none", userPrompt };

  if (kind !== "always" && userPrompt?.trim()) {
    const detected = detectExplicitComparison(userPrompt, targetLanguageId);
    if (detected.explicit) {
      // R2: 登録済みの言語が1つだけ指定されたときに限り背景を付ける。
      // 未登録の言語や複数の言語が指定されたときは、どのモードでも別の言語を混ぜない。
      const [languageId] = detected.languageIds;
      if (detected.languageIds.length !== 1 || !profile.knownLanguages.some((item) => item.languageId === languageId)) {
        return { action: "none", userPrompt };
      }
      const concept = explicitConcept(targetLanguageId, request.evidence, userPrompt);
      return { action: "background", background: createBackground(profile, languageId, targetLanguageId, "question", concept), userPrompt };
    }
  }

  // R1・R5: 明示要求のない相談と自動助言。onRequest では何もしない。
  if (profile.comparisonMode === "onRequest") return { action: "none", userPrompt };
  const assessment = assessComparison({ ...request, userPrompt: kind === "always" ? undefined : userPrompt });
  if (!assessment.applicable) return { action: "none", userPrompt };
  if (profile.comparisonMode === "suggest") {
    return {
      action: "suggest",
      suggestion: { languageId: assessment.languageId, conceptId: assessment.concept.id, label: suggestionLabel(assessment.languageId, assessment.concept) },
      userPrompt
    };
  }
  return {
    action: "background",
    background: createBackground(profile, assessment.languageId, targetLanguageId, "inline", assessment.concept),
    userPrompt
  };
}

/**
 * 提案の後に文書が変わったとき、提案時の概念がまだ当てはまるかを、提案時と同じ規則（候補＋裏付け）で確かめる。
 * 当てはまらなければ（修正済み・別のコードに変わった・除外ファイルで証拠がない）提案を取り下げる。
 */
export function suggestionStillApplies(
  activeLanguageId: string | undefined,
  evidence: ComparisonEvidence,
  conceptId: string,
  question?: string
): boolean {
  const target = toLanguageFamily(activeLanguageId);
  return target !== undefined && detectConcepts(target, evidence, question).confirmed.some((concept) => concept.id === conceptId);
}

export type SuggestionClickCheck =
  | { ok: true }
  | { ok: false; reason: "excluded" | "no_longer_applies" };

/**
 * 提案チップをクリックしたときの再検証（生成の前に必ず通す）。
 * 1. 現在の除外設定で対象ファイルが除外されていれば、版数に関係なく取り下げる
 *    （チップ表示後に除外パターンへ追加し、編集せずに押した場合も含む）
 * 2. 提案の後に文書が変わっていれば、提案時の概念がまだ当てはまるかを確かめ直す
 */
export function checkSuggestionClick(input: {
  fileExcluded: boolean;
  documentVersion: number;
  suggestedVersion: number;
  activeLanguageId?: string;
  evidence: ComparisonEvidence;
  conceptId: string;
  question?: string;
}): SuggestionClickCheck {
  if (input.fileExcluded) return { ok: false, reason: "excluded" };
  if (input.documentVersion !== input.suggestedVersion &&
    !suggestionStillApplies(input.activeLanguageId, input.evidence, input.conceptId, input.question)) {
    return { ok: false, reason: "no_longer_applies" };
  }
  return { ok: true };
}

/**
 * R8: 提案チップをクリックしたときの背景。言語と概念は提案時に固定したものを使い、再計算しない。
 * プロファイルから言語が外された・比較がオフになった場合は案内を返す。
 */
export function resolveSuggestionBackground(
  profile: LearningProfile,
  suggestion: { languageId: LanguageFamilyId; conceptId: string },
  activeLanguageId?: string
): ComparisonResolution {
  if (profile.comparisonMode === "off") return notice("disabled");
  if (!profile.knownLanguages.some((item) => item.languageId === suggestion.languageId)) {
    return notice("unregistered_language", languageLabel(suggestion.languageId));
  }
  const target = toLanguageFamily(activeLanguageId);
  return { action: "background", background: createBackground(profile, suggestion.languageId, target, "chip", findConcept(suggestion.conceptId)) };
}
