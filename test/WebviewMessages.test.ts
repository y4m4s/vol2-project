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
  assert.equal(parseWebviewMessage(null), undefined);
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
