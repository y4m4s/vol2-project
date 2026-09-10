import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type * as vscode from "vscode";
import { OllamaClient } from "../src/services/OllamaClient";
import { OpenAICompatibleError } from "../src/services/OpenAICompatibleClient";
import { AiResponseLimitError } from "../src/services/AiRequestPolicy";
import { SettingsService } from "../src/services/SettingsService";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const client = new OllamaClient();
const endpoint = "http://localhost:11434";

function cancellation() {
  let listener = () => {};
  let disposed = false;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (callback: () => void) => {
      listener = callback;
      return { dispose: () => { disposed = true; } };
    }
  } as vscode.CancellationToken;
  return { token, cancel: () => { (token as { isCancellationRequested: boolean }).isCancellationRequested = true; listener(); }, disposed: () => disposed };
}

test("Ollama tagsは名前を維持し、重複・不正なモデルを除外する", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `${endpoint}/api/tags`);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    return Response.json({ models: [{ name: "qwen3:8b" }, { name: "qwen3:8b" }, { model: "gemma3:4b" }, null, {}, { name: "" }, { name: "x".repeat(501) }] });
  };
  assert.deepEqual(await client.listModels(endpoint), [
    { key: "qwen3:8b", label: "qwen3:8b" }, { key: "gemma3:4b", label: "gemma3:4b" }
  ]);
});

test("Ollamaモデルなしと不正な応答を区別する", async () => {
  globalThis.fetch = async () => Response.json({ models: [] });
  assert.deepEqual(await client.listModels(endpoint), []);
  for (const payload of [{}, { models: {} }, null]) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(client.listModels(endpoint), (error: unknown) => error instanceof OpenAICompatibleError && error.kind === "invalidResponse");
  }
  globalThis.fetch = async () => new Response("not json");
  await assert.rejects(client.listModels(endpoint), OpenAICompatibleError);
});

test("Ollamaの接続失敗、モデルロード失敗、認証、タイムアウトを分類する", async () => {
  for (const [status, kind] of [[404, "other"], [500, "other"], [401, "auth"], [504, "timeout"]] as const) {
    globalThis.fetch = async () => Response.json({ error: "internal detail" }, { status });
    await assert.rejects(client.createCompletion(endpoint, "qwen3:8b", "質問"), (error: unknown) => error instanceof OpenAICompatibleError && error.kind === kind);
  }
  globalThis.fetch = async () => { throw new TypeError("ECONNREFUSED"); };
  await assert.rejects(client.listModels(endpoint), (error: unknown) => error instanceof OpenAICompatibleError && error.kind === "unreachable");
});

test("Ollamaの生成でsystem prompt、コード・追加文脈、参照メタデータと上限を保持する", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `${endpoint}/v1/chat/completions`);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: "qwen3:8b", messages: [{ role: "system", content: "制御指示" }, { role: "user", content: "コードと追加コンテキスト" }],
      stream: false, max_tokens: 2048, navicom_referenced_files: ["src/main.ts"], reasoning_effort: "none"
    });
    return Response.json({ model: "qwen3:8b", choices: [{ message: { content: "回答" }, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 5 } });
  };
  const result = await client.createCompletion(endpoint, "qwen3:8b", {
    systemPrompt: "制御指示", userPrompt: "コードと追加コンテキスト", purpose: "guidance", maxOutputTokens: 2048
  }, ["src/main.ts"]);
  assert.equal(result.text, "回答");
  assert.equal(result.inputTokens, 30);
  assert.equal(result.outputTokens, 5);
});

test("Ollamaの高設定はThinkingを有効にし、低設定へ戻すと無効にする", async () => {
  for (const reasoningEffort of ["high", "none"] as const) {
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).reasoning_effort, reasoningEffort);
      return Response.json({ choices: [{ message: { content: "回答", reasoning: "内部推論" } }] });
    };
    const result = await client.createCompletion(endpoint, "qwen3:8b", {
      systemPrompt: "指示", userPrompt: "入力", purpose: "guidance", reasoningEffort, maxOutputTokens: 8192
    });
    assert.equal(result.text, "回答");
  }
});

test("Ollamaのナレッジ生成・明示指定のない形式修正ではThinkingを無効にする", async () => {
  for (const purpose of ["knowledge", "flowRepair"] as const) {
    const maxOutputTokens = purpose === "knowledge" ? 2048 : 3072;
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "qwen3:8b",
        messages: [{ role: "system", content: "指示" }, { role: "user", content: "入力" }],
        stream: false, max_tokens: maxOutputTokens, reasoning_effort: "none"
      });
      return Response.json({ choices: [{ message: { content: "回答", reasoning: "表示しない推論" } }] });
    };
    const result = await client.createCompletion(endpoint, "qwen3:8b", {
      systemPrompt: "指示", userPrompt: "入力", purpose, maxOutputTokens
    });
    assert.equal(result.text, "回答");
  }
});

test("Ollama生成中のキャンセルでHTTPを中断しリスナーを破棄する", async () => {
  const source = cancellation();
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const pending = client.createCompletion(endpoint, "model", "質問", undefined, source.token);
  source.cancel();
  await assert.rejects(pending);
  assert.equal(source.disposed(), true);
});

test("開始前にキャンセル済みならHTTP signalも既に中断されている", async () => {
  const source = cancellation(); source.cancel();
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new Error("aborted");
  };
  await assert.rejects(client.createCompletion(endpoint, "model", "質問", undefined, source.token));
});

test("受信途中の切断と応答サイズ上限を処理する", async () => {
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("connection closed")); } }));
  await assert.rejects(client.createCompletion(endpoint, "model", "質問"), OpenAICompatibleError);
  globalThis.fetch = async () => new Response("{}", { headers: { "content-length": "9999999" } });
  await assert.rejects(client.listModels(endpoint), AiResponseLimitError);
});

test("OllamaのURLは別ホスト・ポートを許可し、認証情報やパスを拒否する", () => {
  assert.equal(client.normalizeBaseUrl(" http://other-host:11435/ "), "http://other-host:11435");
  for (const value of ["file:///etc", "http://user:pass@localhost:11434", `${endpoint}/v1`, `${endpoint}?x=1`, `${endpoint}#x`, "bad"]) {
    assert.throws(() => client.normalizeBaseUrl(value), OpenAICompatibleError);
  }
});

test("アンロードはNative HTTP APIへ対象モデルとkeep_alive:0だけを指定する", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `${endpoint}/api/generate`);
    assert.deepEqual(JSON.parse(String(init?.body)), { model: "qwen3:8b", keep_alive: 0, stream: false });
    return Response.json({ done: true });
  };
  await client.unloadModel(endpoint, "qwen3:8b");
});

test("アンロードの応答が停止しても2秒で中断する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const pending = client.unloadModel(endpoint, "model");
  t.mock.timers.tick(2000);
  await assert.rejects(pending, (error: unknown) => error instanceof OpenAICompatibleError && error.kind === "timeout");
});

test("Ollamaの設定は既定値と保存・再構築後の復元に対応する", async () => {
  const values = new Map<string, unknown>();
  const storage = { keys: () => [...values.keys()], get: (key: string) => values.get(key), update: async (key: string, value: unknown) => { values.set(key, value); } } as vscode.Memento;
  const settings = new SettingsService(storage);
  assert.equal(settings.getSettings().ollamaBaseUrl, endpoint);
  await settings.saveSettings({ ...settings.getSettings(), providerId: "ollama", ollamaBaseUrl: "http://server:11435/", ollamaModelKey: "qwen3:8b" });
  const restored = new SettingsService(storage).getSettings();
  assert.equal(restored.providerId, "ollama");
  assert.equal(restored.ollamaBaseUrl, "http://server:11435");
  assert.equal(restored.ollamaModelKey, "qwen3:8b");
});
