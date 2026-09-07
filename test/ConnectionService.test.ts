import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type * as vscode from "vscode";
import type { NavigatorSettings } from "../src/shared/types";

let models: vscode.LanguageModelChat[] = [];
let timeoutSeconds: number | undefined;
class TokenSource {
  public token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  public cancel(): void { this.token.isCancellationRequested = true; }
  public dispose(): void {}
}
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {
  workspace: { isTrusted: true, getConfiguration: () => ({ get: () => timeoutSeconds }) },
  lm: { selectChatModels: async () => models },
  CancellationTokenSource: TokenSource,
  LanguageModelChatMessage: { User: (content: string) => ({ content }) },
  LanguageModelError: class extends Error {}
} : originalLoad(id, parent, isMain);
const { ConnectionService } = require("../src/services/ConnectionService") as typeof import("../src/services/ConnectionService");
loader._load = originalLoad;

function harness(id: string, reply: (token: vscode.CancellationToken) => Promise<string> = async () => "ready") {
  let calls = 0;
  models = [{
    id, name: id, family: id, vendor: "copilot", version: "1", maxInputTokens: 8000,
    sendRequest: async (_messages: unknown, _options: unknown, token: vscode.CancellationToken) => {
      calls++;
      return { text: (async function* () { yield await reply(token); })() };
    }
  } as unknown as vscode.LanguageModelChat];
  timeoutSeconds = undefined;
  const service = new ConnectionService(undefined, {} as never, {} as never, { isConfigured: () => false } as never);
  const settings = { providerId: "copilot" } as NavigatorSettings;
  return { service, settings, calls: () => calls };
}

test("Auto未提供時には有料モデルへ代替送信せず、明示指定で接続できる", async () => {
  const h = harness("paid-model");
  assert.equal((await h.service.connectAndActivate(h.settings)).activated, false);
  assert.equal(h.service.getLastCopilotIssue(), "autoUnavailable");
  assert.equal(h.calls(), 0);
  assert.equal((await h.service.connectAndActivate({ ...h.settings, copilotModelId: "paid-model" })).activated, true);
  assert.equal(h.calls(), 1);
});

test("Autoがある場合はAutoで接続する", async () => {
  const h = harness("auto");
  assert.equal((await h.service.connectAndActivate(h.settings)).activated, true);
  assert.equal(h.service.getConnectedModel()?.modelId, "auto");
});

test("15秒を超える接続確認も既定の60秒以内なら成功する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (text: string) => void;
  const h = harness("auto", () => new Promise((resolve) => { finish = resolve; }));
  const pending = h.service.connectAndActivate(h.settings);
  await nextTurn();
  t.mock.timers.tick(20000);
  finish("ready");
  assert.equal((await pending).activated, true);
});

test("設定した待ち時間で接続確認をキャンセルし、再送しない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let token: vscode.CancellationToken | undefined;
  const h = harness("auto", (value) => { token = value; return new Promise(() => {}); });
  timeoutSeconds = 90;
  const pending = h.service.connectAndActivate(h.settings);
  await nextTurn();
  t.mock.timers.tick(60000);
  assert.equal(token?.isCancellationRequested, false);
  t.mock.timers.tick(30000);
  assert.equal((await pending).activated, false);
  assert.equal(h.service.getLastCopilotIssue(), "timeout");
  assert.equal(token?.isCancellationRequested, true);
  assert.equal(h.calls(), 1);
});
