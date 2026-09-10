import assert from "node:assert/strict";
import test from "node:test";
import { runLive } from "../src/eval/runner";
import { hasMermaidBlock, maxBulletLines } from "../src/eval/assertions";
import { SCENARIOS, type EvalScenario } from "../src/eval/fixtures";
import { TASK_COMPLETION_SCENARIOS } from "../src/eval/taskCompletionScenarios";

test("縦並びの評価は要件達成の誤説明と未達の指摘を区別する", async () => {
  const scenario = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-vertical-five")!;
  for (const [text, passed] of [
    ["改行が含まれた出力は横一列の要件を満たしていません。末尾の改行に着目してください。", true],
    ["1行に表示しているため要件を満たしています。", false]
  ] as const) {
    const report = await runLive([scenario], async () => JSON.stringify({ kind: "advice", focus: "continue", text }));
    assert.equal(report.results[0].passed, passed);
  }
});

test("再報告の同一コード再提案は本番と同じ表示前判定を通して評価する", async () => {
  const complete = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-complete")!;
  const single = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-single")!;
  const response = JSON.stringify({ kind: "advice", focus: "continue",
    text: '「■」を5つ並べて表示させるためには、print("■" * 5)のように文字列を繰り返し表示する必要があります。' });
  const report = await runLive([complete, single], async () => response);
  assert.equal(report.results[0].passed, true);
  assert.equal(report.results[0].focus, "none");
  assert.equal(report.results[1].passed, false); // 未完成には不適切な完成コード提示として残す。
  assert.equal(report.results[1].focus, "continue");
});

test("完成済み課題への不要な確認助言を不合格にし、未完成への一律沈黙も検出する", async () => {
  const hello = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-complete-initial-read-hello-reported")!;
  const reported = await runLive([hello], async () => JSON.stringify({ kind: "advice", focus: "continue",
    text: 'print文の引数に"Hello"が正しく渡されているか確認してください。' }));
  assert.equal(reported.failed, 1);
  const complete = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-complete")!;
  for (const text of [
    "「■」を5つ並べるために、文字列の繰り返し回数を正しく指定していますか？",
    "「■」を5つ繰り返す式が正しく表示されているようです。次はこの表示を出力するためのprint文を確認してください。"
  ]) {
    const report = await runLive([complete], async () => JSON.stringify({ kind: "advice", focus: "continue", text }));
    assert.equal(report.failed, 1);
  }
  const silent = await runLive(TASK_COMPLETION_SCENARIOS, async () => '{"kind":"no_advice","focus":"none"}');
  assert.deepEqual(silent.results.filter(r => !r.passed).map(r => r.id), [
    "task-completion-single", "task-completion-incomplete-initial-read", "task-completion-wrong-count",
    "task-completion-vertical-five", "task-completion-vertical-five-initial", "task-completion-vertical-loop", "task-completion-missing-output"
  ]);
});

test("未完成へのcontinueでも行コピーや完成式を提示するヒントは不合格にする", async () => {
  const single = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-single")!;
  for (const text of ["何行かコピーして繰り返す方法はどうでしょうか。", '"■" * 5 にしてみましょう。']) {
    const report = await runLive([single], async () => JSON.stringify({ kind: "advice", focus: "continue", text }));
    assert.equal(report.failed, 1);
    assert.equal(report.results[0].checks.at(-1)!.passed, false);
  }
});

test("出力が未実装のときの一般的なprint()への言及は完成コードと判定しない", async () => {
  const missing = TASK_COMPLETION_SCENARIOS.find(s => s.id === "task-completion-missing-output")!;
  const report = await runLive([missing], async () => JSON.stringify({ kind: "advice", focus: "continue",
    text: "生成した文字列とprint()をどのようにつなげられそうでしょうか。" }));
  assert.equal(report.passed, 1);
});

test("自動評価fixtureの挿入・削除文字数が変更内容と一致する", () => {
  for (const [id, inserted, deleted] of [["automatic-review", 0, 1], ["automatic-cosmetic", 2, 0]] as const) {
    const edit = SCENARIOS.find((item) => item.id === id)!.input.automaticObservation!.lastEdit!;
    assert.equal(edit.insertedCharCount, inserted);
    assert.equal(edit.deletedCharCount, deleted);
    assert.equal(edit.afterPreview!.length - edit.beforePreview!.length, inserted - deleted);
  }
});

const scenario: EvalScenario = {
  id: "hint", description: "short hints",
  input: { kind: "manual", context: { referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] } },
  promptChecks: [], responseChecks: [maxBulletLines(3)]
};

test("JSON内の改行を復元して箇条書きを数える", async () => {
  const report = await runLive([scenario], async () => JSON.stringify({
    kind: "advice", text: Array.from({ length: 8 }, (_, i) => `- 観点${i}`).join("\n")
  }));
  assert.equal(report.failed, 1);
  assert.match(report.results[0].checks.at(-1)!.detail!, /8 bullets/);
  assert.ok(report.results[0].responseDurationMs! >= 0);
});

test("本文チェックが空でも不正JSONを合格にせず、後続シナリオを評価する", async () => {
  const report = await runLive([{ ...scenario, responseChecks: [] }, scenario], async (_messages, item) =>
    item.responseChecks!.length ? JSON.stringify({ kind: "advice", text: "- 確認の観点" }) : "not JSON");
  assert.equal(report.failed, 1);
  assert.equal(report.passed, 1);
  assert.equal(report.results[0].checks[0].detail, "invalidEnvelope");
});

test("no_adviceは常時モードだけ正常とし、本文チェックは実行しない", async () => {
  const always = { ...scenario, input: { ...scenario.input, kind: "always" as const }, responseChecks: [hasMermaidBlock()] };
  const report = await runLive([always, scenario], async () => '{"kind":"no_advice","focus":"none"}');
  assert.equal(report.results[0].passed, true);
  assert.equal(report.results[1].passed, false);
});

test("次の一手の評価をno_adviceで通過できず、focusの集計に残る", async () => {
  const report = await runLive([{ ...scenario, expectedFocus: ["continue"], input: { ...scenario.input, kind: "always" } }],
    async () => '{"kind":"no_advice","focus":"none"}');
  assert.equal(report.failed, 1);
  assert.equal(report.results[0].focus, "none");
});

test("本番同様に制御指示と参照データを分け、未依頼コードを拒否する", async () => {
  const report = await runLive([scenario], async (messages) => {
    assert.match(messages.systemPrompt, /Return only one JSON object/);
    assert.match(messages.userPrompt, /^<context>/);
    return JSON.stringify({ kind: "advice", text: "```ts\nconst answer = 42;\n```" });
  });
  assert.equal(report.failed, 1);
  assert.equal(report.results[0].checks[0].detail, "implementationCodeNotRequested");
});

test("プロバイダー失敗を記録し、残りの評価を続ける", async () => {
  let calls = 0;
  const report = await runLive([scenario, scenario], async () => {
    if (++calls === 1) throw new Error("provider failed");
    return JSON.stringify({ kind: "advice", text: "- 観点" });
  });
  assert.equal(calls, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.passed, 1);
});
