import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoutingSettings } from "../src/shared/providerRouting";
import type { AiProviderId, NavigatorSettings } from "../src/shared/types";

const { ProviderRoutingCoordinator } = require("../src/application/coordinators/ProviderRoutingCoordinator") as typeof import("../src/application/coordinators/ProviderRoutingCoordinator");

function harness(used = 95) {
  let current: AiProviderId = "copilot";
  const activations: AiProviderId[] = [];
  const models = ["copilot", "orcaRouter"].map(providerId => ({ providerId, modelId: "test", profileSource: { maxInputTokens: 32000 } }));
  const coordinator = new ProviderRoutingCoordinator({ getProviderId: () => current, getState: () => "connected", getTestedModels: () => models,
    activateTestedProvider: (id: AiProviderId) => { current = id; activations.push(id); return true; }
  } as never, { getToday: (id: AiProviderId) => ({ inputTokens: id === "copilot" ? used : 0, outputTokens: 0, requestCount: 1 }), getRecordedCostUsd: () => 0 } as never);
  const settings = { dailyTokenLimit: 100, routing: normalizeRoutingSettings({ mode: "automatic", allowedProviderIds: ["copilot", "orcaRouter"], dailyProviderTokenSoftLimits: { copilot: 100, orcaRouter: 100 } }) } as NavigatorSettings;
  return { coordinator, settings, activations, current: () => current };
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
    evaluation as never
  );
  const result = await coordinator.prepare(h.settings, [], "stream", "複数ファイルを実装して", () => false,
    { assistanceDepth: "high", targetFileCount: 3 });
  assert.equal(result.ok, true);
  assert.equal(h.current(), "orcaRouter");
});
