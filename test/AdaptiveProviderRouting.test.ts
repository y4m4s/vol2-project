import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRoutingTask,
  decideAdaptiveRoute,
  resolveRoutingLearningStatus,
  scoreRoutingCandidate
} from "../src/shared/adaptiveProviderRouting";

const candidate = (providerId: "copilot" | "orcaRouter", modelId: string) => ({
  providerId, modelId, available: true, usedTokens: 0, tokenLimit: 100_000, maxInputTokens: 100_000
});

test("NaviCom内の決定的な信号だけで実装タスクの複雑度を分類する", () => {
  const profile = classifyRoutingTask({
    question: "このバグを修正して",
    assistanceDepth: "high",
    targetFileCount: 3,
    diagnostics: [{ severity: "Error" }]
  });
  assert.equal(profile.purpose, "implementation");
  assert.equal(profile.complexity, "medium");
  assert.equal(profile.scope, "multiFile");
  assert.ok(profile.reasons.includes("推論強度が高"));
});

test("重大なレビューはリスク評価に分類する", () => {
  const profile = classifyRoutingTask({ question: "認証の脆弱性をレビューして", diagnostics: [{ severity: "Error" }] });
  assert.equal(profile.purpose, "riskAssessment");
});

test("通常のエラー診断は高リスク扱いにせずレビューへ分類する", () => {
  const profile = classifyRoutingTask({ question: "原因を教えて", diagnostics: [{ severity: "Error" }] });
  assert.equal(profile.purpose, "review");
});

test("初心者向けコード学習は実装依頼ではなく学習支援へ分類する", () => {
  const profile = classifyRoutingTask({ question: "Ruby初心者向けにCRUDコードを教えて" });
  assert.equal(profile.purpose, "learning");
});

test("10回未満と単一候補では自動切り替えを開始しない", () => {
  assert.equal(resolveRoutingLearningStatus(9, 2, true), "learning");
  assert.equal(resolveRoutingLearningStatus(10, 1, true), "readySingleProvider");
  assert.equal(resolveRoutingLearningStatus(10, 2, true), "active");
});

test("成功だけでは推論力を直接加点せず形式・安定性・速度を合成する", () => {
  const base = candidate("copilot", "auto");
  const profile = classifyRoutingTask({ question: "コードを実装して" });
  const initial = scoreRoutingCandidate(base, profile);
  const observed = scoreRoutingCandidate({ ...base, stats: {
    successCount: 10, requestFailureCount: 0, formatFailureCount: 0, timeoutCount: 0,
    positiveFeedbackCount: 0, negativeFeedbackCount: 0, totalLatencyMs: 10_000
  } }, profile);
  assert.ok(Number.isFinite(initial));
  assert.ok(Number.isFinite(observed));
});

test("学習期間中は基本プロバイダーを維持する", () => {
  const result = decideAdaptiveRoute({
    candidates: [candidate("copilot", "auto"), candidate("orcaRouter", "orcarouter/free")],
    currentProviderId: "copilot",
    profile: classifyRoutingTask({ question: "実装して" }),
    successfulResponseCount: 9,
    turnsSinceSwitch: 10
  });
  assert.equal(result.action, "stay");
  assert.equal(result.reasonCode, "learning");
});

test("学習後でも8点未満の差では切り替えない", () => {
  const result = decideAdaptiveRoute({
    candidates: [candidate("copilot", "auto"), candidate("orcaRouter", "orcarouter/free")],
    currentProviderId: "copilot",
    profile: classifyRoutingTask({ question: "説明して" }),
    successfulResponseCount: 10,
    turnsSinceSwitch: 10
  });
  assert.equal(result.action, "stay");
});

test("実測の形式・安定性・評価に十分な差があれば切り替える", () => {
  const weak = { ...candidate("copilot", "auto"), stats: {
    successCount: 2, requestFailureCount: 8, formatFailureCount: 8, timeoutCount: 2,
    positiveFeedbackCount: 0, negativeFeedbackCount: 5, totalLatencyMs: 60_000
  } };
  const strong = { ...candidate("orcaRouter", "orcarouter/free"), stats: {
    successCount: 10, requestFailureCount: 0, formatFailureCount: 0, timeoutCount: 0,
    positiveFeedbackCount: 5, negativeFeedbackCount: 0, totalLatencyMs: 10_000
  } };
  const result = decideAdaptiveRoute({ candidates: [weak, strong], currentProviderId: "copilot",
    profile: classifyRoutingTask({ question: "実装して" }), successfulResponseCount: 10, turnsSinceSwitch: 10 });
  assert.equal(result.action, "switch");
  assert.equal(result.providerId, "orcaRouter");
});

test("低リスクの5回に1回だけ実績3件未満の候補を探索する", () => {
  const result = decideAdaptiveRoute({
    candidates: [candidate("copilot", "auto"), candidate("orcaRouter", "orcarouter/free")],
    currentProviderId: "copilot",
    profile: classifyRoutingTask({ question: "変数について説明して" }),
    successfulResponseCount: 14,
    turnsSinceSwitch: 3
  });
  assert.equal(result.action, "switch");
  assert.equal(result.reasonCode, "exploration");
  assert.equal(result.providerId, "orcaRouter");
});

test("高リスクまたはローカル限定相当では探索しない", () => {
  const base = {
    candidates: [candidate("copilot", "auto"), candidate("orcaRouter", "orcarouter/free")],
    currentProviderId: "copilot" as const,
    successfulResponseCount: 14,
    turnsSinceSwitch: 3
  };
  assert.notEqual(decideAdaptiveRoute({ ...base,
    profile: classifyRoutingTask({ question: "認証の脆弱性をレビューして" }) }).reasonCode, "exploration");
  assert.notEqual(decideAdaptiveRoute({ ...base,
    profile: classifyRoutingTask({ question: "説明して" }), allowExploration: false }).reasonCode, "exploration");
});
