import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ORCA_ROUTER_BASE_URL, OrcaRouterClient, OrcaRouterError } from "../src/services/OrcaRouterClient";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("モデル一覧の能力メタデータを正規化する", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-orca-test");
    return new Response(JSON.stringify({
      object: "list",
      data: [{
        id: "openai/gpt-test",
        owned_by: "openai",
        supported_endpoint_types: ["openai"],
        context_length: 128000,
        max_completion_tokens: 8192,
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }
      }]
    }));
  };

  const models = await new OrcaRouterClient().listModels("sk-orca-test");
  assert.equal(requestedUrl, `${ORCA_ROUTER_BASE_URL}/models`);
  assert.deepEqual(models, [{
    id: "openai/gpt-test",
    ownedBy: "openai",
    supportedEndpointTypes: ["openai"],
    contextLength: 128000,
    maxCompletionTokens: 8192,
    inputModalities: ["text", "image"],
    outputModalities: ["text"]
  }]);
});

test("chat completionにはキーと実コスト要求を付け、ローカルパスは送らない", async () => {
  let requestedUrl = "";
  let requestBody: unknown;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer sk-orca-test");
    assert.equal(headers.get("x-orcarouter-include-cost"), "true");
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      model: "openai/gpt-test",
      choices: [{ message: { content: "回答です" } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, cost_usd: 0.00012 }
    }));
  };

  const result = await new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", "質問");
  assert.equal(requestedUrl, `${ORCA_ROUTER_BASE_URL}/chat/completions`);
  assert.deepEqual(requestBody, {
    model: "orcarouter/free",
    messages: [{ role: "user", content: "質問" }],
    stream: false
  });
  assert.deepEqual(result, {
    text: "回答です",
    inputTokens: 12,
    outputTokens: 4,
    costUsd: 0.00012,
    resolvedModelId: "openai/gpt-test"
  });
});

test("APIエラーのcodeと分類を保持する", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: "free capacity exhausted", code: "free_quota_exhausted" }
  }), { status: 403 });

  await assert.rejects(
    () => new OrcaRouterClient().listModels("sk-orca-test"),
    (error: unknown) => error instanceof OrcaRouterError &&
      error.kind === "quota" && error.status === 403 && error.code === "free_quota_exhausted"
  );
});

test("無料枠の429でRetry-Afterを保持する", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: "free limit reached", code: "free_rate_limited" }
  }), { status: 429, headers: { "Retry-After": "42" } });

  await assert.rejects(
    () => new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", "質問"),
    (error: unknown) => error instanceof OrcaRouterError &&
      error.kind === "rateLimit" && error.code === "free_rate_limited" && error.retryAfter === "42"
  );
});

test("OrcaRouter形式でないキーは通信前に拒否する", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}");
  };
  await assert.rejects(() => new OrcaRouterClient().listModels("not-a-key"), OrcaRouterError);
  assert.equal(called, false);
});
