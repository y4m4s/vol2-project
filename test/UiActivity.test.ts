import assert from "node:assert/strict";
import test from "node:test";
import { connectionActivityState, guidanceProgressState } from "../src/shared/uiActivity";

test("右上の接続アイコンは基本設定ではなく切り替え後の実接続先を示す", () => {
  const state = connectionActivityState({
    providerId: "copilot",
    connectionState: "connected",
    requestState: "idle",
    modelLabel: "GitHub Copilot · GPT",
    testedProviderIds: ["lmStudio", "copilot"],
    testedProviderModels: [
      { providerId: "lmStudio", modelId: "qwen", modelLabel: "LM Studio · Qwen" },
      { providerId: "copilot", modelId: "gpt", modelLabel: "GitHub Copilot · GPT" }
    ]
  });

  assert.equal(state.providerId, "copilot");
  assert.equal(state.modelLabel, "GPT");
  assert.equal(state.stateLabel, "接続中");
});

test("送信準備中は相談画面でも進行表示を出し、生成開始まで消さない", () => {
  assert.deepEqual(guidanceProgressState("preparing_guidance", "conversation"), {
    title: "送信準備中",
    message: "接続先の選択と会話履歴の整理をしています。処理は継続中です。"
  });
  assert.equal(guidanceProgressState("preparing_guidance", "main")?.title, "送信準備中");
  assert.equal(guidanceProgressState("requesting_guidance", "main")?.title, "回答を生成しています");
  assert.equal(guidanceProgressState("requesting_guidance", "conversation"), undefined);
  assert.equal(guidanceProgressState("idle", "conversation"), undefined);
});
