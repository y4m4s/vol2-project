import assert from "node:assert/strict";
import test from "node:test";
import { runLive } from "../src/eval/runner";
import { hasMermaidBlock, maxBulletLines } from "../src/eval/assertions";
import { SCENARIOS, type EvalScenario } from "../src/eval/fixtures";

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
