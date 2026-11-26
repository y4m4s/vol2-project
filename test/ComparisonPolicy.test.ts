import assert from "node:assert/strict";
import test from "node:test";
import {
  detectExplicitComparison,
  matchLanguageToken,
  resolveComparisonRequest,
  selectComparisonLanguage,
  type ComparisonRequest
} from "../src/services/ComparisonPolicy";
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
