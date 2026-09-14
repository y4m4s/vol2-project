import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRoutingModeSelection,
  decideProviderRoute,
  normalizeRoutingSettings,
  executeProviderRoute
} from "../src/shared/providerRouting";

const settings = normalizeRoutingSettings({ mode: "automatic", allowedProviderIds: ["copilot", "orcaRouter"] });
const candidates = [
  { providerId: "copilot" as const, available: true, usedTokens: 10, tokenLimit: 100, maxInputTokens: 10000 },
  { providerId: "orcaRouter" as const, available: true, usedTokens: 0, tokenLimit: 100, maxInputTokens: 10000 }
];
test("legacy settings default to manual; automatic does not require local LLM", () => {
  assert.equal(normalizeRoutingSettings(undefined).mode, "manual");
  assert.equal(settings.mode, "automatic");
});
test("enabling automatic routing uses the connected provider as the initial basic provider", () => {
  const selected = applyRoutingModeSelection(
    normalizeRoutingSettings(undefined),
    "automatic",
    "orcaRouter",
    ["copilot", "orcaRouter"]
  );
  assert.equal(selected.mode, "automatic");
  assert.equal(selected.preferredProviderId, "orcaRouter");
  assert.deepEqual(selected.allowedProviderIds, ["orcaRouter"]);
});
test("turning automatic routing off and on preserves an explicitly selected basic provider", () => {
  const manual = applyRoutingModeSelection(
    normalizeRoutingSettings({
      mode: "automatic",
      allowedProviderIds: ["copilot", "orcaRouter"],
      preferredProviderId: "copilot"
    }),
    "manual",
    "orcaRouter",
    ["copilot", "orcaRouter"]
  );
  const selected = applyRoutingModeSelection(
    manual,
    "automatic",
    "orcaRouter",
    ["copilot", "orcaRouter"]
  );
  assert.equal(selected.preferredProviderId, "copilot");
  assert.deepEqual(selected.allowedProviderIds, ["copilot", "orcaRouter"]);
});
test("basic provider is preserved when it is no longer an allowed candidate", () => {
  const selected = applyRoutingModeSelection(
    normalizeRoutingSettings({
      mode: "manual",
      allowedProviderIds: ["orcaRouter"],
      preferredProviderId: "copilot"
    }),
    "automatic",
    "orcaRouter",
    ["copilot", "orcaRouter"]
  );
  assert.equal(selected.preferredProviderId, "copilot");
  assert.deepEqual(selected.allowedProviderIds, ["orcaRouter"]);
});
test("keeps current provider while eligible regardless of other cheaper candidates", () => {
  assert.equal(decideProviderRoute(settings, candidates, "copilot", 100).action, "stay");
});
test("soft limit switches to an allowed provider in automatic mode", () => {
  const nearing = [{ ...candidates[0], usedTokens: 90 }, candidates[1]];
  const automatic = decideProviderRoute(settings, nearing, "copilot", 100);
  assert.equal(automatic.action, "switch");
  assert.equal(automatic.providerId, "orcaRouter");
});
test("provider-specific soft limit cannot be bypassed by the shared limit", () => {
  const providerLimited = normalizeRoutingSettings({
    mode: "automatic",
    allowedProviderIds: ["copilot", "orcaRouter"],
    dailyProviderTokenSoftLimits: { copilot: 10, orcaRouter: 1000 }
  });
  const result = decideProviderRoute(providerLimited, [
    { ...candidates[0], usedTokens: 10, tokenLimit: 1000 },
    { ...candidates[1], tokenLimit: 1000 }
  ], "copilot", 100);
  assert.equal(result.action, "switch");
  assert.equal(result.providerId, "orcaRouter");
});
test("never selects forbidden, unavailable or too-small candidates", () => {
  for (const other of [{ ...candidates[1], available: false }, { ...candidates[1], maxInputTokens: 50 }]) {
    assert.equal(decideProviderRoute(settings, [{ ...candidates[0], available: false }, other], "copilot", 100).action, "stop");
  }
  assert.equal(decideProviderRoute({ ...settings, allowedProviderIds: ["copilot"] }, [{ ...candidates[0], available: false }, candidates[1]], "copilot", 100).action, "stop");
});
test("cloud-wide budget cannot be bypassed by switching clouds", () => {
  assert.equal(decideProviderRoute({ ...settings, dailyCloudTokenSoftLimit: 10 }, candidates, "copilot", 100).action, "stop");
});
test("local-only data never reaches clouds", () => {
  assert.equal(decideProviderRoute(settings, candidates, "copilot", 100, true).action, "stop");
});
test("automatic activation is performed once; failure does not retry", async () => {
  let activated = 0;
  const route = decideProviderRoute(settings, [{ ...candidates[0], available: false }, candidates[1]], "copilot", 100);
  assert.equal(await executeProviderRoute(route, async () => { activated++; return false; }), false);
  assert.equal(activated, 1);
});

test("removed suggestion settings migrate to manual", () => {
  assert.equal(normalizeRoutingSettings({ mode: "automaticSuggest" }).mode, "manual");
});
