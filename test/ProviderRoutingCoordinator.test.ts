import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoutingSettings } from "../src/shared/providerRouting";
import type { AiProviderId, NavigatorSettings } from "../src/shared/types";

const { ProviderRoutingCoordinator } = require("../src/application/coordinators/ProviderRoutingCoordinator") as typeof import("../src/application/coordinators/ProviderRoutingCoordinator");

function harness(used = 95) {
  let current: AiProviderId = "copilot";
  const activations: AiProviderId[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  const models = ["copilot", "orcaRouter"].map(providerId => ({ providerId, modelId: "test", profileSource: { maxInputTokens: 32000 } }));
  const coordinator = new ProviderRoutingCoordinator({ getProviderId: () => current, getState: () => "connected", getTestedModels: () => models,
    activateTestedProvider: (id: AiProviderId) => { current = id; activations.push(id); return true; }
  } as never, { getToday: (id: AiProviderId) => ({ inputTokens: id === "copilot" ? used : 0, outputTokens: 0, requestCount: 1 }), getRecordedCostUsd: () => 0 } as never,
  undefined, undefined, entry => diagnostics.push(entry));
  const settings = { dailyTokenLimit: 100, routing: normalizeRoutingSettings({ mode: "automatic", allowedProviderIds: ["copilot", "orcaRouter"], dailyProviderTokenSoftLimits: { copilot: 100, orcaRouter: 100 } }) } as NavigatorSettings;
  return { coordinator, settings, activations, diagnostics, current: () => current };
}
test("automatic switches without asking and does not bounce back", async () => {
  const h = harness();
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.deepEqual(h.activations, ["orcaRouter"]);
});
test("automatic routing uses the shared NaviCom usage guard", async () => {
  const h = harness(60);
  h.settings.dailyTokenLimit = 50;
  h.settings.routing!.dailyProviderTokenSoftLimits.copilot = 1_000_000;
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.deepEqual(h.activations, ["orcaRouter"]);
});
test("Diagnosticsに候補除外理由と切り替え開始・完了を記録する", async () => {
  const h = harness();
  await h.coordinator.prepare(h.settings, [], "stream", "変数について教えて");
  const evaluated = h.diagnostics.find(entry => entry.event === "provider_route_evaluated");
  assert.equal(evaluated?.reasonCode, "fallback");
  assert.equal(evaluated?.currentProviderId, "copilot");
  assert.equal(evaluated?.selectedProviderId, "orcaRouter");
  const copilot = (evaluated?.candidates as Array<{ providerId: string; exclusionReasons: string[] }>)[0];
  assert.equal(copilot.providerId, "copilot");
  assert.deepEqual(copilot.exclusionReasons, ["providerTokenLimit", "providerSoftLimit"]);
  assert.deepEqual(h.diagnostics.map(entry => entry.event), [
    "provider_route_evaluated",
    "provider_switch_started",
    "provider_switch_completed"
  ]);
});
test("configured default is selected for a new conversation", async () => {
  const h = harness(0);
  h.settings.routing!.preferredProviderId = "orcaRouter";
  await h.coordinator.prepare(h.settings, [], "new");
  assert.equal(h.current(), "orcaRouter");
});
test("candidate外の基本プロバイダーは新しい相談でも使用しない", async () => {
  const h = harness(0);
  h.settings.routing!.allowedProviderIds = ["copilot"];
  h.settings.routing!.preferredProviderId = "orcaRouter";
  await h.coordinator.prepare(h.settings, [], "new");
  assert.equal(h.current(), "copilot");
  assert.deepEqual(h.activations, []);
});

test("one-time override returns to the conversation provider on the following request", async () => {
  const h = harness(0);
  await h.coordinator.prepare(h.settings, [], "stream");
  h.coordinator.selectOnce("stream", "orcaRouter");
  await h.coordinator.prepare(h.settings, [], "stream");
  assert.equal(h.current(), "orcaRouter");
  await h.coordinator.prepare(h.settings, [], "stream");
  assert.equal(h.current(), "copilot");
});

test("forget removes cached routing state for one or all conversations", async () => {
  const h = harness(0);
  await h.coordinator.setPreference("first", { mode: "manual", providerId: "copilot" });
  await h.coordinator.setPreference("second", { mode: "automatic", providerId: "orcaRouter" });
  h.coordinator.forget("first");
  assert.equal(h.coordinator.preference("first"), undefined);
  assert.equal(h.coordinator.preference("second")?.providerId, "orcaRouter");
  h.coordinator.forget();
  assert.equal(h.coordinator.preference("second"), undefined);
});

test("10回学習後はNaviComの評価差で接続先を切り替える", async () => {
  const h = harness(0);
  const diagnostics: Array<Record<string, unknown>> = [];
  const weak = { successCount: 2, requestFailureCount: 8, formatFailureCount: 8, timeoutCount: 2,
    positiveFeedbackCount: 0, negativeFeedbackCount: 5, totalLatencyMs: 60_000 };
  const strong = { successCount: 10, requestFailureCount: 0, formatFailureCount: 0, timeoutCount: 0,
    positiveFeedbackCount: 5, negativeFeedbackCount: 0, totalLatencyMs: 10_000 };
  const evaluation = {
    getSuccessfulResponseCount: () => 10,
    getStats: ({ providerId }: { providerId: AiProviderId }) => providerId === "copilot" ? weak : strong,
    recordDecision: async () => {}
  };
  const coordinator = new ProviderRoutingCoordinator(
    (h.coordinator as unknown as { connection: object }).connection as never,
    (h.coordinator as unknown as { usage: object }).usage as never,
    undefined,
    evaluation as never,
    entry => diagnostics.push(entry)
  );
  const result = await coordinator.prepare(h.settings, [], "stream", "複数ファイルを実装して", () => false,
    { assistanceDepth: "high", targetFileCount: 3 });
  assert.equal(result.ok, true);
  assert.equal(h.current(), "orcaRouter");
  const evaluated = diagnostics.find(entry => entry.event === "provider_route_evaluated");
  assert.equal(evaluated?.reasonCode, "taskFit");
  const adaptive = evaluated?.adaptive as {
    switchScoreThreshold: number;
    currentAdjustedScore: number;
    bestProviderId: string;
    candidateScores: Array<{ providerId: string; observedAttemptCount: number }>;
  };
  assert.equal(adaptive.switchScoreThreshold, 8);
  assert.equal(adaptive.bestProviderId, "orcaRouter");
  assert.equal(adaptive.candidateScores.find(item => item.providerId === "copilot")?.observedAttemptCount, 10);
  assert.ok(Number.isFinite(adaptive.currentAdjustedScore));
});
