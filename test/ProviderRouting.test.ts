import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRoutingModeSelection,
  decideProviderRoute,
  normalizeRoutingSettings,
  executeProviderRoute
} from "../src/services/ProviderRouting";

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
    "automaticSuggest",
    "orcaRouter",
    ["copilot", "orcaRouter"]
  );
  assert.equal(selected.mode, "automaticSuggest");
  assert.equal(selected.preferredProviderId, "orcaRouter");
  assert.deepEqual(selected.allowedProviderIds, ["orcaRouter"]);
});
test("switching between automatic modes preserves an explicitly selected basic provider", () => {
  const selected = applyRoutingModeSelection(
    normalizeRoutingSettings({
      mode: "automaticSuggest",
      allowedProviderIds: ["copilot", "orcaRouter"],
      preferredProviderId: "copilot"
    }),
    "automatic",
    "orcaRouter",
    ["copilot", "orcaRouter"]
  );
  assert.equal(selected.preferredProviderId, "copilot");
  assert.deepEqual(selected.allowedProviderIds, ["copilot", "orcaRouter"]);
});
test("keeps current provider while eligible regardless of other cheaper candidates", () => {
  assert.equal(decideProviderRoute(settings, candidates, "copilot", 100).action, "stay");
});
test("soft limit proposes or switches depending on mode", () => {
  const nearing = [{ ...candidates[0], usedTokens: 90 }, candidates[1]];
  const automatic = decideProviderRoute(settings, nearing, "copilot", 100);
  assert.equal(automatic.action, "switch");
  assert.equal(automatic.providerId, "orcaRouter");
  assert.equal(decideProviderRoute({ ...settings, mode: "automaticSuggest" }, nearing, "copilot", 100).action, "suggest");
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
test("proposal rejection never activates target and unavailable current cannot continue", async () => {
  let activated = 0;
  const proposal = decideProviderRoute({ ...settings, mode: "automaticSuggest" }, [{ ...candidates[0], available: false }, candidates[1]], "copilot", 100);
  const result = await executeProviderRoute(proposal, async () => false, async () => { activated++; return true; });
  assert.equal(result, false);
  assert.equal(activated, 0);
});
test("automatic activation is performed once; failure does not retry", async () => {
  let activated = 0;
  const route = decideProviderRoute(settings, [{ ...candidates[0], available: false }, candidates[1]], "copilot", 100);
  assert.equal(await executeProviderRoute(route, async () => { throw new Error("unexpected confirmation"); }, async () => { activated++; return false; }), false);
  assert.equal(activated, 1);
});
