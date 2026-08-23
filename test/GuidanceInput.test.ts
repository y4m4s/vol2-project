import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAdditionalContext,
  parseSlashInput,
  resolveEffectiveAssistanceDepth,
  resolveNextProjectScope,
  resolveUserEntryText
} from "../src/application/GuidanceInput";

test("既知のスラッシュコマンドと deep スコープを解析する", () => {
  assert.deepEqual(parseSlashInput("  /next deep 依存関係も確認して  "), {
    slashCommand: "next",
    slashCommandScope: "deep",
    userPrompt: "依存関係も確認して"
  });
  assert.deepEqual(parseSlashInput("/FLOW"), {
    slashCommand: "flow",
    slashCommandScope: "standard",
    userPrompt: undefined
  });
});

test("未知のコマンドは通常のユーザー入力として保持する", () => {
  assert.deepEqual(parseSlashInput(" /unknown foo "), {
    userPrompt: "/unknown foo"
  });
});

test("常時モードと深さ固定スキルの優先順位を適用する", () => {
  assert.equal(resolveEffectiveAssistanceDepth("always", "high", "flow"), "low");
  assert.equal(resolveEffectiveAssistanceDepth("manual", "low", "flow"), "high");
  assert.equal(resolveEffectiveAssistanceDepth("manual", "low", "hint"), "low");
});

test("プロジェクト文脈の収集範囲を深さとスコープから決める", () => {
  assert.equal(resolveNextProjectScope("low", "standard"), "project-lite");
  assert.equal(resolveNextProjectScope("high", "standard"), "project");
  assert.equal(resolveNextProjectScope("low", "deep"), "deep");
});

test("追加文脈を正規化し上限文字数で切る", () => {
  assert.equal(normalizeAdditionalContext("  one\r\ntwo  "), "one\ntwo");
  assert.equal(normalizeAdditionalContext("   "), undefined);
  const normalized = normalizeAdditionalContext("a".repeat(4001));
  assert.equal(normalized?.length, 4003);
  assert.equal(normalized?.endsWith("..."), true);
});

test("会話履歴用のユーザー表示文を決める", () => {
  assert.equal(resolveUserEntryText("context"), "この箇所を相談");
  assert.equal(resolveUserEntryText("manual", undefined, "next", "deep"), "次に何をすればよいか広めに整理してください");
  assert.equal(resolveUserEntryText("always", "自動入力"), undefined);
});
