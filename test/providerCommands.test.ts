import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderCommand } from "../src/shared/providerCommands";

test("既知のプロバイダ切替コマンドを解析する", () => {
  assert.equal(parseProviderCommand("/provider-CP"), "copilot");
  assert.equal(parseProviderCommand("  /provider-lm  "), "lmStudio");
  assert.equal(parseProviderCommand("/provider-Oll"), "ollama");
  assert.equal(parseProviderCommand("/provider-orca"), "orcaRouter");
});

test("未知の入力は undefined を返す", () => {
  assert.equal(parseProviderCommand("/provider-unknown"), undefined);
  assert.equal(parseProviderCommand("/next"), undefined);
  assert.equal(parseProviderCommand(undefined), undefined);
  assert.equal(parseProviderCommand(""), undefined);
});
