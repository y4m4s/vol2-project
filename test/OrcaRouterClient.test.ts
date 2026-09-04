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

test("chat completionにキーと応答時点の料金要求を付け、本文と利用量を読み取る", async () => {
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
      choices: [{ message: { content: "回答です" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 4, cost_usd: 0.00012 }
    }), {
      headers: {
        "X-Orca-Request-Id": "request-123",
        "X-Orca-Resolved-Model": "openai/gpt-resolved"
      }
    });
  };

  const result = await new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", {
    systemPrompt: "制御指示",
    userPrompt: "質問",
    purpose: "guidance",
    maxOutputTokens: 2048
  });
  assert.equal(requestedUrl, `${ORCA_ROUTER_BASE_URL}/chat/completions`);
  assert.deepEqual(requestBody, {
    model: "orcarouter/free",
    messages: [
      { role: "system", content: "制御指示" },
      { role: "user", content: "質問" }
    ],
    stream: false,
    max_tokens: 2048
  });
  assert.deepEqual(result, {
    text: "回答です",
    inputTokens: 12,
    outputTokens: 4,
    costUsd: 0.00012,
    resolvedModelId: "openai/gpt-resolved",
    requestId: "request-123",
    finishReason: "stop",
    providerAttemptCount: 1
  });
});

test("応答ヘッダーと利用量の異常値を境界で正規化する", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: "回答" }, finish_reason: "f".repeat(150) }],
    usage: { prompt_tokens: 1.5, completion_tokens: 3, cost_usd: Number.MAX_VALUE }
  }), {
    headers: {
      "X-Orca-Request-Id": "r".repeat(600),
      "X-Orca-Resolved-Model": "m".repeat(600)
    }
  });

  const result = await new OrcaRouterClient().createCompletion("sk-orca-test", "openai/test", "質問");
  assert.equal(result.requestId?.length, 500);
  assert.equal(result.resolvedModelId?.length, 500);
  assert.equal(result.finishReason?.length, 100);
  assert.equal(result.inputTokens, undefined);
  assert.equal(result.outputTokens, 3);
  assert.equal(result.costUsd, undefined);
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
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response(JSON.stringify({
      error: { message: "free limit reached", code: "free_rate_limited" }
    }), { status: 429, headers: { "Retry-After": "42" } });
  };

  await assert.rejects(
    () => new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", "質問"),
    (error: unknown) => error instanceof OrcaRouterError &&
      error.kind === "rateLimit" && error.code === "free_rate_limited" && error.retryAfter === "42"
  );
  assert.equal(callCount, 1);
});

test("短いRetry-Afterなら1回だけ待って再試行する", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({
        error: { message: "free limit reached", code: "free_rate_limited" }
      }), { status: 429, headers: { "Retry-After": "0" } });
    }
    return new Response(JSON.stringify({
      model: "deepseek/test-free",
      choices: [{ message: { content: "再試行後の回答" }, finish_reason: "stop" }]
    }));
  };

  const result = await new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", {
    systemPrompt: "制御指示",
    userPrompt: "質問",
    purpose: "guidance",
    maxOutputTokens: 2048
  });
  assert.equal(callCount, 2);
  assert.equal(result.text, "再試行後の回答");
  assert.equal(result.providerAttemptCount, 2);
});

test("有料モデルの一時障害は重複課金を避けるため自動再試行しない", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503 });
  };

  await assert.rejects(
    () => new OrcaRouterClient().createCompletion("sk-orca-test", "openai/gpt-test", "質問"),
    (error: unknown) => error instanceof OrcaRouterError && error.kind === "unavailable"
  );
  assert.equal(callCount, 1);
});

test("無料モデルの一時障害は短い待機後に1回だけ再試行する", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: "復旧後の回答" } }]
    }));
  };

  const result = await new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", {
    systemPrompt: "制御指示",
    userPrompt: "質問",
    purpose: "guidance",
    maxOutputTokens: 2048
  });
  assert.equal(callCount, 2);
  assert.equal(result.text, "復旧後の回答");
  assert.equal(result.providerAttemptCount, 2);
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
