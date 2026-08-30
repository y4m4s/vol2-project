import assert from "node:assert/strict";
import test from "node:test";
import { parseWebviewMessage } from "../src/shared/messages";

test("accepts a bounded ask message", () => {
  assert.deepEqual(parseWebviewMessage({ type: "ask", text: "help", additionalContext: "src/app.ts" }), {
    type: "ask",
    text: "help",
    additionalContext: "src/app.ts"
  });
});

test("rejects oversized and malformed webview messages", () => {
  assert.equal(parseWebviewMessage({ type: "ask", text: "x".repeat(20_001) }), undefined);
  assert.equal(parseWebviewMessage({ type: "navigate", screen: "admin" }), undefined);
  assert.equal(parseWebviewMessage({ type: "rateAdvice", id: "entry", rating: "maybe" }), undefined);
  assert.equal(parseWebviewMessage({ type: "submitFeedback", reasons: [], comment: "" }), undefined);
  assert.equal(parseWebviewMessage({ type: "submitFeedback", reasons: ["unknown"], comment: "" }), undefined);
  assert.equal(parseWebviewMessage({ type: "submitFeedback", reasons: ["too_long"], comment: "x".repeat(1_001) }), undefined);
  assert.equal(parseWebviewMessage(null), undefined);
});

test("Good／Bad共通のフィードバック理由を受け入れる", () => {
  assert.deepEqual(
    parseWebviewMessage({ type: "submitFeedback", reasons: ["concise", "other"], comment: "補足" }),
    { type: "submitFeedback", reasons: ["concise", "other"], comment: "補足" }
  );
  assert.deepEqual(parseWebviewMessage({ type: "cancelFeedback" }), { type: "cancelFeedback" });
});

test("validates token guard settings at the execution boundary", () => {
  const valid = {
    type: "saveSettings",
    payload: {
      providerId: "copilot",
      defaultMode: "manual",
      defaultAssistanceDepth: "low",
      idleDelaySec: 10,
      requestIntervalSec: 60,
      dailyTokenLimit: 100_000,
      excludeGlobs: ""
    }
  };
  assert.deepEqual(parseWebviewMessage(valid), valid);
  assert.equal(parseWebviewMessage({ ...valid, payload: { ...valid.payload, dailyTokenLimit: Number.NaN } }), undefined);
});

test("accepts OrcaRouter settings and bounds API keys", () => {
  const settings = {
    type: "saveSettings",
    payload: {
      providerId: "orcaRouter",
      defaultMode: "manual",
      defaultAssistanceDepth: "low",
      orcaRouterModelId: "orcarouter/free",
      idleDelaySec: 10,
      requestIntervalSec: 60,
      dailyTokenLimit: 100_000,
      excludeGlobs: ""
    }
  };
  assert.deepEqual(parseWebviewMessage(settings), settings);
  assert.deepEqual(parseWebviewMessage({ type: "setOrcaRouterApiKey", apiKey: "sk-orca-test" }), {
    type: "setOrcaRouterApiKey",
    apiKey: "sk-orca-test"
  });
  assert.equal(parseWebviewMessage({ type: "setOrcaRouterApiKey", apiKey: "x".repeat(501) }), undefined);
});

test("送信計画の更新とワークスペース相対の参照ファイルを受け入れる", () => {
  assert.deepEqual(parseWebviewMessage({ type: "refreshRequestPlan" }), { type: "refreshRequestPlan" });
  assert.deepEqual(
    parseWebviewMessage({ type: "openReferencedFile", path: "src/services/AdviceService.ts", line: 42 }),
    { type: "openReferencedFile", path: "src/services/AdviceService.ts", line: 42 }
  );
  assert.equal(parseWebviewMessage({ type: "openReferencedFile", path: "" }), undefined);
  assert.equal(parseWebviewMessage({ type: "openReferencedFile", path: "src/app.ts", line: 0 }), undefined);
  assert.equal(parseWebviewMessage({ type: "openReferencedFile", path: "x".repeat(2_001) }), undefined);
});
