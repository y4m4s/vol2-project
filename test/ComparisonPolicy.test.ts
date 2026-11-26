import assert from "node:assert/strict";
import test from "node:test";
import {
  assessComparison,
  detectExplicitComparison,
  matchLanguageToken,
  recentlyShownKey,
  resolveComparisonRequest,
  resolveSuggestionBackground,
  selectComparisonLanguage,
  suggestionStillApplies,
  checkSuggestionClick,
  type ComparisonEvidence,
  type ComparisonRequest
} from "../src/services/ComparisonPolicy";
import { LANGUAGE_CONCEPTS } from "../src/shared/languageConcepts";
import type { ComparisonMode } from "../src/shared/learningProfile";
import { normalizeLearningProfile, type LearningProfile } from "../src/shared/learningProfile";

function profile(partial: Partial<LearningProfile> = {}): LearningProfile {
  return normalizeLearningProfile({ knownLanguages: [], comparisonMode: "onRequest", ...partial });
}

const PHP_ONLY = profile({ knownLanguages: [{ languageId: "php", level: "advanced" }] });
// Python の方が習熟度が高いので、自動選択なら Python が選ばれる組み合わせ。
const PHP_AND_PYTHON = profile({ knownLanguages: [{ languageId: "php", level: "basic" }, { languageId: "python", level: "advanced" }] });

function resolve(partial: Partial<ComparisonRequest>) {
  return resolveComparisonRequest({ profile: PHP_ONLY, kind: "manual", activeLanguageId: "typescript", ...partial });
}

test("未設定のプロファイルでは、通常の相談に背景を付けず、/compare は案内だけにする（C6 相当）", () => {
  const empty = profile();
  assert.deepEqual(resolve({ profile: empty, userPrompt: "PHPでいう連想配列は？" }), { action: "none", userPrompt: "PHPでいう連想配列は？" });
  const command = resolve({ profile: empty, slashCommand: "compare" });
  assert.equal(command.action, "notice");
  assert.equal(command.action === "notice" && command.reason, "no_profile");
});

test("C16: off では /compare を案内だけにし、質問文の指定にも背景を付けない", () => {
  const off = profile({ knownLanguages: [{ languageId: "php" }], comparisonMode: "off" });
  const command = resolve({ profile: off, slashCommand: "compare", userPrompt: "php" });
  assert.equal(command.action === "notice" && command.reason, "disabled");
  assert.equal(resolve({ profile: off, userPrompt: "PHPでいう連想配列は？" }).action, "none");
});

test("C7: onRequest で「PHPでいう〜」は背景を付ける", () => {
  const result = resolve({ userPrompt: "PHPでいう連想配列はTSだと何？" });
  assert.equal(result.action, "background");
  assert.equal(result.action === "background" && result.background.compareLanguageId, "php");
  assert.equal(result.action === "background" && result.background.source, "question");
  assert.equal(result.action === "background" && result.background.targetLanguageId, "typescript");
});

test("C15: 言語名が出てくるだけの通常の相談には背景を付けない", () => {
  for (const userPrompt of [
    "user.name が undefined の可能性があると言われる",
    "PHPのバージョンの違いで動かない？",
    "このPHPファイルから呼ぶ API を確認したい",
    "Node.js の fs を使っている箇所を見て"
  ]) {
    assert.equal(resolve({ userPrompt }).action, "none", userPrompt);
  }
});

test("C17: 質問文で指定した言語を、習熟度による自動選択より優先する", () => {
  assert.equal(selectComparisonLanguage(PHP_AND_PYTHON, "typescript"), "python");
  const result = resolve({ profile: PHP_AND_PYTHON, userPrompt: "PHPでいう ?? はTSでも同じ？" });
  assert.equal(result.action === "background" && result.background.compareLanguageId, "php");
});

test("C18: 未登録の言語が質問で指定されたら、登録済みの別の言語を混ぜない", () => {
  const result = resolve({ userPrompt: "Rubyでいう &. はTSだと？" });
  assert.deepEqual(result, { action: "none", userPrompt: "Rubyでいう &. はTSだと？" });
});

test("C19: /compare の引数で指定した言語を使う（対応度に関わらず差し替えない）", () => {
  const result = resolve({ profile: PHP_AND_PYTHON, slashCommand: "compare", userPrompt: "php この await の扱い" });
  assert.equal(result.action, "background");
  assert.equal(result.action === "background" && result.background.compareLanguageId, "php");
  assert.equal(result.action === "background" && result.background.source, "command");
  // 言語の引数は質問文から取り除く。
  assert.equal(result.action === "background" && result.userPrompt, "この await の扱い");
});

test("引数なしの /compare は、習熟度の高い順（同点なら登録順）で1つ選ぶ", () => {
  const result = resolve({ profile: PHP_AND_PYTHON, slashCommand: "compare" });
  assert.equal(result.action === "background" && result.background.compareLanguageId, "python");
  assert.equal(result.action === "background" && result.background.source, "auto");
  assert.equal(result.action === "background" && result.userPrompt, undefined);
  const tie = profile({ knownLanguages: [{ languageId: "java" }, { languageId: "go" }] });
  assert.equal(selectComparisonLanguage(tie, "typescript"), "java");
});

test("C21: /compare に未登録の言語を指定したら、差し替えずに登録を案内する", () => {
  const result = resolve({ slashCommand: "compare", userPrompt: "ruby" });
  assert.equal(result.action, "notice");
  assert.equal(result.action === "notice" && result.reason, "unregistered_language");
  assert.match(result.action === "notice" ? result.message : "", /Ruby は学習プロファイルに登録されていません/);
});

test("C22: 複数の言語を指定した質問には背景を付けない", () => {
  assert.equal(resolve({ profile: PHP_AND_PYTHON, userPrompt: "PHPとPythonではどう書く？" }).action, "none");
  assert.equal(resolve({ profile: PHP_AND_PYTHON, userPrompt: "PythonとPHPを比較して" }).action, "none");
});

test("C23: 登録済みと未登録の言語が混在する指定にも背景を付けない", () => {
  assert.equal(resolve({ userPrompt: "PHPやRubyでいう〜はTSだと？" }).action, "none");
});

test("C24: /compare に引数を2つ以上指定したら、1つに絞るよう案内する", () => {
  const result = resolve({ profile: PHP_AND_PYTHON, slashCommand: "compare", userPrompt: "php python" });
  assert.equal(result.action === "notice" && result.reason, "multiple_languages");
});

test("学習中の言語への言及は、指定された言語の数に含めない", () => {
  const result = resolve({ userPrompt: "TypeScriptとPHPの違いを教えて" });
  assert.equal(result.action === "background" && result.background.compareLanguageId, "php");
});

test("学習中の言語と同じ言語は比較に使わない", () => {
  const tsUser = profile({ knownLanguages: [{ languageId: "typescript", level: "advanced" }] });
  const command = resolve({ profile: tsUser, slashCommand: "compare", userPrompt: "ts" });
  assert.equal(command.action === "notice" && command.reason, "same_as_target");
  const noCandidate = resolve({ profile: tsUser, slashCommand: "compare" });
  assert.equal(noCandidate.action === "notice" && noCandidate.reason, "no_candidate");
});

test("学習中の言語は編集中のファイルの言語で、カタログ外の言語なら未指定として扱う", () => {
  const react = resolve({ slashCommand: "compare", activeLanguageId: "typescriptreact" });
  assert.equal(react.action === "background" && react.background.targetLanguageId, "typescript");
  const unknownTarget = resolve({ slashCommand: "compare", activeLanguageId: "json" });
  assert.equal(unknownTarget.action === "background" && unknownTarget.background.targetLanguageId, undefined);
});

test("他のスラッシュコマンドと自動助言には背景を付けない（R4・Phase 1 の R5）", () => {
  assert.equal(resolve({ slashCommand: "hint", userPrompt: "PHPでいう〜" }).action, "none");
  assert.equal(resolve({ kind: "always", userPrompt: "PHPでいう〜" }).action, "none");
});

test("言語名の検出は単語の一部や拡張子を拾わない", () => {
  assert.equal(matchLanguageToken("php"), "php");
  assert.equal(matchLanguageToken("C++"), "cpp");
  assert.equal(matchLanguageToken("C#"), "csharp");
  assert.equal(matchLanguageToken("Go"), "go");
  assert.equal(matchLanguageToken("go"), undefined);
  assert.equal(matchLanguageToken("javascript"), "javascript");
  assert.deepEqual(detectExplicitComparison("JavaScriptでいう", "typescript").languageIds, ["javascript"]);
  assert.deepEqual(detectExplicitComparison("index.ts と Node.js を開いた", "python").languageIds, []);
  assert.equal(detectExplicitComparison("PHP vs TypeScript", "typescript").explicit, true);
});

// ---- Phase 2: 比較の適用可否（assessComparison）と動作表 ----

const NOW = Date.UTC(2026, 10, 26, 3, 0, 0);
const diag = (code: string, message: string, nearbyCode?: string): ComparisonEvidence => ({
  diagnostics: [{ source: "ts", code, message, ...(nearbyCode ? { nearbyCode } : {}) }],
  cursorLine: "",
  cursorWindow: nearbyCode ?? ""
});
const UNDEFINED_NAME = diag("18048", "'user.name' is possibly 'undefined'.", "const name = user.name.trim();");
const PYTHON_ONLY = profile({ knownLanguages: [{ languageId: "python", level: "working" }] });

function assess(partial: Partial<ComparisonRequest>) {
  return assessComparison({ profile: PHP_ONLY, activeLanguageId: "typescript", now: NOW, ...partial });
}

test("C1: possibly undefined の診断は nullability として PHP と比較できる", () => {
  const result = assess({ evidence: UNDEFINED_NAME });
  assert.equal(result.applicable, true);
  assert.equal(result.applicable && result.concept.id, "nullability");
  assert.equal(result.applicable && result.languageId, "php");
  assert.equal(result.applicable && result.counterpart.support, "partial");
});

test("C2: スペルミスなど些末な診断だけなら比較しない", () => {
  const result = assess({ evidence: diag("2552", "Cannot find name 'consol'. Did you mean 'console'?", "consol.log(value);") });
  assert.deepEqual(result, { applicable: false, reason: "trivial" });
});

test("C3・C13: 構造的型付けは、対応のない言語（PHP）を避け、対応のある言語（Python）を選ぶ", () => {
  const evidence = diag("2322", "Property 'age' is missing in type '{ name: string; }' but required in type 'User'.", "const user: User = { name: \"a\" };");
  assert.deepEqual(assess({ evidence }), { applicable: false, reason: "no_counterpart" });
  const result = assess({ profile: PHP_AND_PYTHON, evidence });
  assert.equal(result.applicable && result.concept.id, "structural_typing");
  assert.equal(result.applicable && result.languageId, "python");
});

test("C4: async 関数の外の await は、Python と比較する", () => {
  const result = assess({ profile: PYTHON_ONLY, evidence: diag("1308", "'await' expressions are only allowed within async functions and at the top levels of modules.", "const data = await fetch(url);") });
  assert.equal(result.applicable && result.concept.id, "async_promise");
  assert.equal(result.applicable && result.counterpart.support, "direct");
});

test("C5: 学習中の言語を高い習熟度で登録していれば比較しない", () => {
  const tsExpert = profile({ knownLanguages: [{ languageId: "typescript", level: "advanced" }, { languageId: "php" }] });
  assert.deepEqual(assess({ profile: tsExpert, evidence: UNDEFINED_NAME }), { applicable: false, reason: "not_learning" });
  assert.deepEqual(assess({ evidence: UNDEFINED_NAME, activeLanguageId: "json" }), { applicable: false, reason: "not_learning" });
});

test("C8: 同じ概念・言語は30分以内に繰り返さない", () => {
  const key = recentlyShownKey("typescript", "nullability", "php");
  assert.deepEqual(assess({ evidence: UNDEFINED_NAME, recentlyShown: new Map([[key, NOW - 10 * 60 * 1000]]) }), { applicable: false, reason: "recently_shown" });
  assert.equal(assess({ evidence: UNDEFINED_NAME, recentlyShown: new Map([[key, NOW - 31 * 60 * 1000]]) }).applicable, true);
});

test("C9: 「今後出さない」にした概念は出さない", () => {
  const dismissed = profile({ knownLanguages: [{ languageId: "php" }], dismissedConcepts: ["typescript:nullability"] });
  assert.deepEqual(assess({ profile: dismissed, evidence: UNDEFINED_NAME }), { applicable: false, reason: "dismissed" });
});

test("C11・C12: プリミティブ同士の型の不一致を構造的型付けとして扱わない", () => {
  for (const nearby of ["let n: number = input.value;", "let n: number = \"1\";"]) {
    const result = assess({ profile: PHP_AND_PYTHON, evidence: diag("2322", "Type 'string' is not assignable to type 'number'.", nearby) });
    assert.equal(result.applicable, false, nearby);
  }
  // primitive_types は評価で効果を確かめるまで無効
  assert.equal(LANGUAGE_CONCEPTS.find(concept => concept.id === "primitive_types")?.enabled, false);
});

test("C14: async を含むファイルを開いただけ（カーソルが無関係な行）では比較しない", () => {
  const evidence: ComparisonEvidence = { diagnostics: [], cursorLine: "const total = 1;", cursorWindow: "async function load() {\n  const total = 1;\n}" };
  assert.deepEqual(assess({ profile: PYTHON_ONLY, evidence }), { applicable: false, reason: "no_candidate" });
});

test("質問文から出た候補は、カーソル付近のコードで裏付けが取れたときだけ採用する", () => {
  const question = "このPromiseの扱いがよくわからない";
  const withCode: ComparisonEvidence = { diagnostics: [], cursorLine: "  return value;", cursorWindow: "const res = await fetch(url);\n  return value;" };
  assert.equal(assess({ profile: PYTHON_ONLY, evidence: withCode, userPrompt: question }).applicable, true);
  const withoutCode: ComparisonEvidence = { diagnostics: [], cursorLine: "  return value;", cursorWindow: "  return value;" };
  assert.deepEqual(assess({ profile: PYTHON_ONLY, evidence: withoutCode, userPrompt: question }), { applicable: false, reason: "unconfirmed" });
});

test("選択範囲のキーワードは、その位置にあること自体を裏付けとする", () => {
  const evidence: ComparisonEvidence = { diagnostics: [], selectionText: "items.filter(item => item.active).map(item => item.id)" };
  const result = assess({ evidence });
  assert.equal(result.applicable && result.concept.id, "array_methods");
});

const MODES: ComparisonMode[] = ["off", "onRequest", "suggest", "auto"];

function actionOf(mode: ComparisonMode, partial: Partial<ComparisonRequest>): string {
  const result = resolveComparisonRequest({
    profile: profile({ knownLanguages: [{ languageId: "php", level: "advanced" }], comparisonMode: mode }),
    kind: "manual", activeLanguageId: "typescript", evidence: UNDEFINED_NAME, now: NOW, ...partial
  });
  if (result.action === "background") return `background:${result.background.source}`;
  return result.action;
}

test("動作表（設計書 §5.0）: 相談の種類 × 比較モードの全セル", () => {
  const table: Array<[string, Partial<ComparisonRequest>, [string, string, string, string]]> = [
    ["R1 手動相談（明示なし）", { userPrompt: "この行で何が起きている？" }, ["none", "none", "suggest", "background:inline"]],
    ["R2 手動相談（登録済みの言語を1つ）", { userPrompt: "PHPでいう ?? は？" }, ["none", "background:question", "background:question", "background:question"]],
    ["R2 手動相談（未登録の言語）", { userPrompt: "Rubyでいう &. は？" }, ["none", "none", "none", "none"]],
    ["R3 /compare", { slashCommand: "compare" }, ["notice", "background:auto", "background:auto", "background:auto"]],
    ["R4 他のスラッシュコマンド", { slashCommand: "hint", userPrompt: "PHPでいう ?? は？" }, ["none", "none", "none", "none"]],
    ["R5 自動助言", { kind: "always" }, ["none", "none", "suggest", "background:inline"]],
    ["R5 自動助言（適用不可の証拠）", { kind: "always", evidence: diag("2552", "Cannot find name 'consol'.") }, ["none", "none", "none", "none"]]
  ];
  for (const [label, request, expected] of table) {
    assert.deepEqual(MODES.map(mode => actionOf(mode, request)), expected, label);
  }
});

test("明示要求の背景には、裏付けの取れた概念を添える（言語は差し替えない）", () => {
  const result = resolveComparisonRequest({ profile: PHP_AND_PYTHON, kind: "manual", activeLanguageId: "typescript", evidence: UNDEFINED_NAME, userPrompt: "PHPでいう ?. は？" });
  assert.equal(result.action === "background" && result.background.compareLanguageId, "php");
  assert.equal(result.action === "background" && result.background.concept?.id, "nullability");
  assert.match(result.action === "background" ? result.background.counterpart?.note ?? "" : "", /undefined/);
});

test("/compare の自動選択は、概念に対応のある言語を優先する", () => {
  const evidence = diag("2322", "Property 'age' is missing in type '{ name: string; }' but required in type 'User'.");
  const phpExpert = profile({ knownLanguages: [{ languageId: "php", level: "advanced" }, { languageId: "go", level: "basic" }] });
  const result = resolveComparisonRequest({ profile: phpExpert, kind: "manual", slashCommand: "compare", activeLanguageId: "typescript", evidence });
  assert.equal(result.action === "background" && result.background.compareLanguageId, "go");
  assert.equal(result.action === "background" && result.background.counterpart?.support, "direct");
});

test("suggest の提案には、チップの文言と固定する言語・概念を含める", () => {
  const result = resolveComparisonRequest({ profile: profile({ knownLanguages: [{ languageId: "php" }], comparisonMode: "suggest" }), kind: "always", activeLanguageId: "typescript", evidence: UNDEFINED_NAME });
  assert.equal(result.action, "suggest");
  assert.deepEqual(result.action === "suggest" && result.suggestion, { languageId: "php", conceptId: "nullability", label: "PHPと比べて「null / undefined の扱い（?. ・ ??）」を説明する" });
});

test("R8: チップのクリックでは、提案時の言語・概念をそのまま使う", () => {
  const suggestMode = profile({ knownLanguages: [{ languageId: "php" }, { languageId: "python", level: "advanced" }], comparisonMode: "suggest" });
  const result = resolveSuggestionBackground(suggestMode, { languageId: "php", conceptId: "nullability" }, "typescript");
  assert.equal(result.action === "background" && result.background.compareLanguageId, "php");
  assert.equal(result.action === "background" && result.background.source, "chip");
  assert.equal(result.action === "background" && result.background.concept?.id, "nullability");
  const removed = resolveSuggestionBackground(PYTHON_ONLY, { languageId: "php", conceptId: "nullability" }, "typescript");
  assert.equal(removed.action === "notice" && removed.reason, "unregistered_language");
  const off = resolveSuggestionBackground(profile({ knownLanguages: [{ languageId: "php" }], comparisonMode: "off" }), { languageId: "php", conceptId: "nullability" });
  assert.equal(off.action === "notice" && off.reason, "disabled");
});

test("概念カタログ: 各概念の対応には note があり、学習中の言語自体とは比べない前提になっている", () => {
  for (const concept of LANGUAGE_CONCEPTS) {
    for (const [languageId, counterpart] of Object.entries(concept.counterparts)) {
      assert.ok(counterpart && counterpart.note.length > 5, `${concept.id}:${languageId}`);
    }
  }
});

test("提案後にコードが変わったら、提案時の概念がまだ当てはまるかを確かめ直す", () => {
  assert.equal(suggestionStillApplies("typescript", UNDEFINED_NAME, "nullability"), true);
  // 診断が消え、カーソル行も無関係なコードに変わった（例: const total = 1;）
  const changed: ComparisonEvidence = { diagnostics: [], cursorLine: "const total = 1;", cursorWindow: "const total = 1;" };
  assert.equal(suggestionStillApplies("typescript", changed, "nullability"), false);
  // 除外ファイルなどで証拠がない
  assert.equal(suggestionStillApplies("typescript", { diagnostics: [] }, "nullability"), false);
  // 質問から出た候補は、提案時の質問とカーソル付近のコードで確かめ直す
  const asyncCode: ComparisonEvidence = { diagnostics: [], cursorLine: "  return value;", cursorWindow: "const res = await fetch(url);\n  return value;" };
  assert.equal(suggestionStillApplies("typescript", asyncCode, "async_promise", "このPromiseの扱いは？"), true);
  assert.equal(suggestionStillApplies("typescript", asyncCode, "async_promise"), false);
  assert.equal(suggestionStillApplies("json", UNDEFINED_NAME, "nullability"), false);
});

test("回帰: チップ表示後に対象ファイルを除外し、編集せずにクリックしたら生成しない", () => {
  // 提案時と同じ版数・同じコード（概念はまだ当てはまる）でも、現在の除外設定を優先する。
  const base = { documentVersion: 3, suggestedVersion: 3, activeLanguageId: "typescript", evidence: UNDEFINED_NAME, conceptId: "nullability" };
  assert.deepEqual(checkSuggestionClick({ ...base, fileExcluded: false }), { ok: true });
  assert.deepEqual(checkSuggestionClick({ ...base, fileExcluded: true }), { ok: false, reason: "excluded" });
  // 除外は版数の変更より先に確かめる
  assert.deepEqual(checkSuggestionClick({ ...base, documentVersion: 4, fileExcluded: true }), { ok: false, reason: "excluded" });
});

test("チップのクリック: 版数が変わり、概念が当てはまらなくなったら取り下げる", () => {
  const changed: ComparisonEvidence = { diagnostics: [], cursorLine: "const total = 1;", cursorWindow: "const total = 1;" };
  assert.deepEqual(checkSuggestionClick({ fileExcluded: false, documentVersion: 4, suggestedVersion: 3, activeLanguageId: "typescript", evidence: changed, conceptId: "nullability" }),
    { ok: false, reason: "no_longer_applies" });
  assert.deepEqual(checkSuggestionClick({ fileExcluded: false, documentVersion: 4, suggestedVersion: 3, activeLanguageId: "typescript", evidence: UNDEFINED_NAME, conceptId: "nullability" }),
    { ok: true });
});
