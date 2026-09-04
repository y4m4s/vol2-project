import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { LmStudioClient, LmStudioError } from "../src/services/LmStudioClient";
import { AiResponseLimitError } from "../src/services/AiRequestPolicy";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("モデル一覧を正規化しロード状態を保持する", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    models: [
      { key: "qwen@test", display_name: "Qwen", type: "llm", loaded_instances: [{ id: "one" }] },
      { key: "embed@test", name: "Embed", type: "embedding", loaded_instances: [] }
    ]
  }));

  const models = await new LmStudioClient().listModels("http://127.0.0.1:1234");
  assert.deepEqual(models, [
    { key: "qwen@test", label: "Qwen", type: "llm", loadedInstanceCount: 1 },
    { key: "embed@test", label: "Embed", type: "embedding", loadedInstanceCount: 0 }
  ]);
});

test("認証エラーをauthとして分類する", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 401 });

  await assert.rejects(
    () => new LmStudioClient().listModels("http://localhost:1234"),
    (error: unknown) => error instanceof LmStudioError && error.kind === "auth" && error.status === 401
  );
});

test("chat completion本文とusageを読み取る", async () => {
  let requestBody: unknown;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      model: "qwen/resolved",
      choices: [{ message: { content: "回答です" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 4 }
    }));
  };

  const result = await new LmStudioClient().createCompletion(
    "http://127.0.0.1:1234",
    "qwen@test",
    {
      systemPrompt: "制御指示",
      userPrompt: "質問",
      purpose: "guidance",
      maxOutputTokens: 2048
    },
    ["src/example.ts"]
  );

  assert.deepEqual(result, {
    text: "回答です",
    inputTokens: 12,
    outputTokens: 4,
    resolvedModelId: "qwen/resolved",
    finishReason: "stop"
  });
  assert.deepEqual(requestBody, {
    model: "qwen@test",
    messages: [
      { role: "system", content: "制御指示" },
      { role: "user", content: "質問" }
    ],
    stream: false,
    max_tokens: 2048,
    navicom_referenced_files: ["src/example.ts"]
  });
});

test("Content-Lengthが受信上限を超える応答を拒否する", async () => {
  globalThis.fetch = async () => new Response("{}", {
    headers: { "Content-Length": "9999999" }
  });
  await assert.rejects(
    () => new LmStudioClient().listModels("http://127.0.0.1:1234"),
    (error: unknown) => error instanceof AiResponseLimitError
  );
});

test("応答メタデータを保存可能な長さと安全な数値へ制限する", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    model: "m".repeat(600),
    choices: [{ message: { content: "回答" }, finish_reason: "f".repeat(150) }],
    usage: { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 2 }
  }));

  const result = await new LmStudioClient().createCompletion(
    "http://127.0.0.1:1234",
    "model",
    "質問"
  );
  assert.equal(result.resolvedModelId?.length, 500);
  assert.equal(result.finishReason?.length, 100);
  assert.equal(result.inputTokens, undefined);
  assert.equal(result.outputTokens, 2);
});

test("ローカルルート以外のURLを拒否する", () => {
  const client = new LmStudioClient();
  assert.throws(() => client.normalizeBaseUrl("https://example.com:1234"), LmStudioError);
  assert.throws(() => client.normalizeBaseUrl("http://127.0.0.1:1234/v1"), LmStudioError);
});
