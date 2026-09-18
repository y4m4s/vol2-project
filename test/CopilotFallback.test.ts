import assert from "node:assert/strict";
import test from "node:test";
import { canFallbackToTestedCopilot } from "../src/shared/copilotFallback";
import type { ConversationEntry, NavigatorSettings } from "../src/shared/types";

const settings = {
  routing: { mode: "automatic", allowedProviderIds: ["lmStudio", "copilot"] }
} as NavigatorSettings;

test("Copilot は自動候補で接続確認済みかつ会話がクラウド送信可能な場合だけ復帰する", () => {
  assert.equal(canFallbackToTestedCopilot(settings, [], true), true);
  assert.equal(canFallbackToTestedCopilot(settings, [], false), false);
  assert.equal(canFallbackToTestedCopilot({ ...settings, routing: { ...settings.routing!, allowedProviderIds: ["lmStudio"] } }, [], true), false);
  assert.equal(canFallbackToTestedCopilot({ ...settings, routing: { ...settings.routing!, mode: "manual" } }, [], true), false);
  assert.equal(canFallbackToTestedCopilot(settings, [{ transmissionClass: "localOnly" } as ConversationEntry], true), false);
  assert.equal(canFallbackToTestedCopilot(settings, [{ providerId: "lmStudio" } as ConversationEntry], true), false);
  assert.equal(canFallbackToTestedCopilot(settings, [{ transmissionClass: "cloudAllowed" } as ConversationEntry], true), true);
});
