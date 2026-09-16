import assert from "node:assert/strict";
import test from "node:test";
import { connectionActivityState, guidanceProgressState } from "../src/shared/uiActivity";
import type { AiProviderId } from "../src/shared/types";

test("右上の接続アイコンは基本設定ではなく切り替え後の実接続先を示す", () => {
  const state = connectionActivityState({
    providerId: "copilot",
    connectionState: "connected",
    requestState: "idle",
    lmStudioServer: { state: "running", canStart: false, canStop: true },
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

test("LM Studio の起動停止確認中だけアクティブアイコンが黄色の確認表示になる", () => {
  const base = {
    connectionState: "connected" as const,
    requestState: "connecting" as const,
    modelLabel: "LM Studio · Qwen",
    testedProviderIds: ["lmStudio", "copilot"] as AiProviderId[],
    testedProviderModels: [],
    routingProviderConnection: { providerId: "copilot" as const, state: "connecting" as const, revision: 1 },
    lmStudioServer: { state: "stopping" as const, canStart: false, canStop: false }
  };
  const lmStudio = connectionActivityState({ ...base, providerId: "lmStudio" });
  assert.equal(lmStudio.isChecking, true);
  assert.equal(lmStudio.stateLabel, "接続確認中");
  assert.equal(lmStudio.stateClass, "switching");

  const copilot = connectionActivityState({
    ...base,
    providerId: "copilot",
    routingProviderConnection: { providerId: "lmStudio", state: "connecting", revision: 2 }
  });
  assert.equal(copilot.isChecking, false);
  assert.equal(copilot.stateLabel, "接続中");
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
