import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type * as vscode from "vscode";
import type { NavigatorSettings } from "../src/shared/types";

let models: vscode.LanguageModelChat[] = [];
let trusted = true;
let timeoutSeconds: number | undefined;
class TokenSource {
  public token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  public cancel(): void { this.token.isCancellationRequested = true; }
  public dispose(): void {}
}
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {
  workspace: { get isTrusted() { return trusted; }, getConfiguration: () => ({ get: () => timeoutSeconds }) },
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


function ollamaHarness() {
  const { settings } = harness("auto");
  let available = [{ key: "qwen3:8b", label: "qwen3:8b" }];
  const unloaded: string[] = [];
  let failUnload = false;
  const service = new ConnectionService(undefined, {} as never, {} as never,
    { isConfigured: () => false } as never, undefined, {
      normalizeBaseUrl: (url: string) => new URL(url).origin,
      listModels: async () => available,
      createCompletion: async () => ({ text: "回答" }),
      unloadModel: async (url: string, model: string) => {
        unloaded.push(`${url}/${model}`);
        if (failUnload) throw new Error("unload failed");
      }
    } as never);
  const ollamaSettings = { ...settings, providerId: "ollama", ollamaBaseUrl: "http://localhost:11434", ollamaModelKey: "qwen3:8b" } as NavigatorSettings;
  const generate = () => service.getConnectedModel()!.requestText({ systemPrompt: "system", userPrompt: "user", purpose: "guidance", maxOutputTokens: 128 }, new TokenSource().token as vscode.CancellationToken);
  return { service, settings, ollamaSettings, unloaded, generate,
    setModels: (models: typeof available) => { available = models; },
    failUnload: () => { failUnload = true; }
  };
}

test("Ollamaから切り替えると最後に使用したモデルだけをアンロードする", async () => {
  const h = ollamaHarness();
  assert.equal((await h.service.connectAndActivate(h.ollamaSettings)).activated, true);
  assert.equal(h.service.getConnectedModel()?.providerId, "ollama");
  await h.generate();
  assert.equal((await h.service.connectAndActivate(h.settings)).activated, true);
  assert.deepEqual(h.unloaded, ["http://localhost:11434/qwen3:8b"]);
  assert.equal(h.service.getProviderId(), "copilot");
  assert.equal((await h.service.connectAndActivate(h.ollamaSettings)).activated, true);
  assert.equal((await h.generate()).text, "回答");
});

test("Ollamaに接続しただけならモデルをアンロードしない", async () => {
  const h = ollamaHarness();
  await h.service.connectAndActivate(h.ollamaSettings);
  await h.service.connectAndActivate(h.settings);
  assert.deepEqual(h.unloaded, []);
});

test("アンロード失敗でも別プロバイダーへの切り替えが成功する", async (t) => {
  t.mock.method(console, "warn", () => {});
  const h = ollamaHarness(); h.failUnload();
  await h.service.connectAndActivate(h.ollamaSettings);
  await h.generate();
  assert.equal((await h.service.connectAndActivate(h.settings)).activated, true);
  assert.equal(h.service.getProviderId(), "copilot");
  assert.equal(h.unloaded.length, 1);
});

test("切り替え先の接続失敗でOllamaを復元した場合はアンロードしない", async () => {
  const h = ollamaHarness();
  await h.service.connectAndActivate(h.ollamaSettings); await h.generate();
  const result = await h.service.connectAndActivate({ ...h.settings, copilotModelId: "missing-model" });
  assert.equal(result.activated, false);
  assert.equal(h.service.getProviderId(), "ollama");
  assert.equal(h.unloaded.length, 0);
});

test("Ollamaの保存済みモデル削除時は自動代替せず選び直す", async () => {
  const h = ollamaHarness();
  h.setModels([{ key: "other-model", label: "other-model" }]);
  assert.equal((await h.service.connectAndActivate(h.ollamaSettings)).activated, false);
  assert.equal(h.service.consumeOllamaModelKeyChange(), null);
  assert.match(h.service.getOllamaStatus(), /選び直/);
  assert.equal(h.service.getConnectedModel(), undefined);
});

test("モデルなしを通知し、未選択で1件ならモデル選択を保存用に返す", async () => {
  const h = ollamaHarness(); h.setModels([]);
  assert.equal((await h.service.connectAndActivate(h.ollamaSettings)).activated, false);
  assert.match(h.service.getOllamaStatus(), /モデルがありません/);
  h.setModels([{ key: "model", label: "model" }]);
  assert.equal((await h.service.connectAndActivate({ ...h.ollamaSettings, ollamaModelKey: undefined })).activated, true);
  assert.equal(h.service.consumeOllamaModelKeyChange(), "model");
});


test("接続済みOllamaモデルの削除確認後は無効な接続を復元しない", async () => {
  const h = ollamaHarness();
  await h.service.connectAndActivate(h.ollamaSettings);
  h.setModels([]);
  const result = await h.service.connectAndActivate(h.ollamaSettings);
  assert.equal(result.activated, false);
  assert.equal(h.service.getState(), "unavailable");
  assert.equal(h.service.getConnectedModel(), undefined);
});


test("非信頼ワークスペースではOllamaへモデル取得も接続も行わない", async () => {
  const h = ollamaHarness();
  trusted = false;
  try {
    assert.deepEqual(await h.service.refreshAvailableOllamaModels("http://localhost:11434"), []);
    assert.equal((await h.service.connectAndActivate(h.ollamaSettings)).activated, false);
    assert.match(h.service.getOllamaStatus(), /信頼/);
  } finally { trusted = true; }
});

test("Ollama一覧の更新失敗で古いモデル候補を消し、詳細をログに分離する", async (t) => {
  t.mock.method(console, "warn", () => {});
  let fail = false;
  const service = new ConnectionService(undefined, {} as never, {} as never, { isConfigured: () => false } as never, undefined, {
    normalizeBaseUrl: (url: string) => url,
    listModels: async () => {
      if (fail) throw new Error("internal connection detail");
      return [{ key: "model", label: "model" }];
    }
  } as never);
  assert.equal((await service.refreshAvailableOllamaModels("http://localhost:11434")).length, 1);
  fail = true;
  assert.deepEqual(await service.refreshAvailableOllamaModels("http://localhost:11434"), []);
  assert.equal(service.getOllamaModelsBaseUrl(), undefined);
  assert.match(service.getOllamaStatus(), /接続できません/);
  assert.doesNotMatch(service.getOllamaStatus(), /internal/);
});
