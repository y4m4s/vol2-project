import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { normalizeRoutingSettings } from "../src/services/ProviderRouting";
import type { AiProviderId, NavigatorSettings } from "../src/shared/types";

let confirm: () => Promise<string | undefined> = async () => undefined;
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const original = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? { window: { showInformationMessage: () => confirm() } } : original(id, parent, isMain);
const { ProviderRoutingCoordinator } = require("../src/application/coordinators/ProviderRoutingCoordinator") as typeof import("../src/application/coordinators/ProviderRoutingCoordinator");
loader._load = original;

function harness(mode: "automatic" | "automaticSuggest", used = 95) {
  let current: AiProviderId = "copilot";
  const activations: AiProviderId[] = [];
  const models = ["copilot", "orcaRouter"].map(providerId => ({ providerId, modelId: "test", profileSource: { maxInputTokens: 32000 } }));
  const coordinator = new ProviderRoutingCoordinator({ getProviderId: () => current, getState: () => "connected", getTestedModels: () => models,
    activateTestedProvider: (id: AiProviderId) => { current = id; activations.push(id); return true; }
  } as never, { getToday: (id: AiProviderId) => ({ inputTokens: id === "copilot" ? used : 0, outputTokens: 0, requestCount: 1 }), getRecordedCostUsd: () => 0 } as never);
  const settings = { dailyTokenLimit: 100, routing: normalizeRoutingSettings({ mode, allowedProviderIds: ["copilot", "orcaRouter"], dailyProviderTokenSoftLimits: { copilot: 100, orcaRouter: 100 } }) } as NavigatorSettings;
  return { coordinator, settings, activations, current: () => current };
}
test("suggestion waits for approval before activation", async () => {
  const h = harness("automaticSuggest");
  let resolve!: (value: string) => void;
  confirm = () => new Promise(r => { resolve = r; });
  const pending = h.coordinator.prepare(h.settings, [], "stream");
  assert.deepEqual(h.activations, []);
  resolve("切り替える");
  assert.equal((await pending).ok, true);
  assert.deepEqual(h.activations, ["orcaRouter"]);
});
test("dismissal cancels sending; pin keeps the provider on later requests", async () => {
  const h = harness("automaticSuggest");
  confirm = async () => undefined;
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, false);
  confirm = async () => "この相談では維持";
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  confirm = async () => { throw new Error("must not ask again"); };
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.equal(h.current(), "copilot");
});
test("automatic switches without asking and does not bounce back", async () => {
  const h = harness("automatic");
  confirm = async () => { throw new Error("unexpected approval"); };
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.deepEqual(h.activations, ["orcaRouter"]);
});
test("automatic routing uses the shared NaviCom usage guard", async () => {
  const h = harness("automatic", 60);
  h.settings.dailyTokenLimit = 50;
  h.settings.routing!.dailyProviderTokenSoftLimits.copilot = 1_000_000;
  confirm = async () => { throw new Error("unexpected approval"); };
  assert.equal((await h.coordinator.prepare(h.settings, [], "stream")).ok, true);
  assert.deepEqual(h.activations, ["orcaRouter"]);
});
test("configured default is selected for a new conversation", async () => {
  const h = harness("automatic", 0);
  h.settings.routing!.preferredProviderId = "orcaRouter";
  await h.coordinator.prepare(h.settings, [], "new");
  assert.equal(h.current(), "orcaRouter");
});

test("one-time override returns to the conversation provider on the following request", async () => {
  const h = harness("automatic", 0);
  await h.coordinator.prepare(h.settings, [], "stream");
  h.coordinator.selectOnce("stream", "orcaRouter");
  await h.coordinator.prepare(h.settings, [], "stream");
  assert.equal(h.current(), "orcaRouter");
  await h.coordinator.prepare(h.settings, [], "stream");
  assert.equal(h.current(), "copilot");
});
