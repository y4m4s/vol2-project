import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ORCA_ROUTER_BASE_URL, OrcaRouterClient, OrcaRouterError } from "../src/services/OrcaRouterClient";

const originalFetch = globalThis.fetch;

test("推論中に上限へ達し本文がnullでも終了理由と利用量を保持する", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: null, reasoning_content: "private reasoning" }, finish_reason: "length" }],
    usage: { prompt_tokens: 5452, completion_tokens: 2048, cost_usd: 0 }
  }));
  const result = await new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", "question");
  assert.equal(result.text, "");
  assert.equal(result.finishReason, "length");
  assert.equal(result.outputTokens, 2048);
  assert.equal(result.costUsd, 0);
  assert.ok(!JSON.stringify(result).includes("private reasoning"));
});

test("403を残高・キー上限・期間予算・モデル権限・IP制限に分類し再送しない", async () => {
  for (const [code, message, kind] of [
    ["insufficient_user_quota", "balance", "balanceQuota"],
    ["pre_consume_token_quota_failed", "token quota is not enough", "keyQuota"],
    ["insufficient_user_quota", "token cycle spend limit reached, resets at 2026-09-08", "cycleLimit"],
    ["access_denied", "token cycle spend limit reached, resets at 2026-09-08", "cycleLimit"],
    ["", "This token has no access to model openai/test", "modelAccess"],
    ["access_denied", "IP denied", "forbidden"],
    ["unknown", "unknown", "forbidden"]
  ] as const) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code, message } }), { status: 403 });
    };
    await assert.rejects(() => new OrcaRouterClient().createCompletion("sk-orca-test", "openai/test", "question"),
      (error: unknown) => error instanceof OrcaRouterError && error.kind === kind);
    assert.equal(calls, 1);
  }
});

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

test("非対応Retry-Afterでは自動再試行せず応答受信時に警告する", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const value of ["", "-1", "0x0", "1.5", "Wed, 21 Oct 2026 07:28:00 GMT", "invalid"]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code: "free_rate_limited" } }), {
        status: 429, headers: { "Retry-After": value }
      });
    };
    await assert.rejects(() => new OrcaRouterClient().createCompletion("sk-orca-test", "orcarouter/free", "質問"), OrcaRouterError);
    assert.equal(calls, 1);
  }
  assert.equal(warn.mock.callCount(), 6);
});

test("モデル一覧の未知freeエラーも既存の通信経路で検知する", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "free_capacity_empty", message: "private body" }
  }), { status: 403 });
  await assert.rejects(() => new OrcaRouterClient().listModels("sk-orca-test"), OrcaRouterError);
  assert.equal(warn.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(warn.mock.calls[0].arguments), /private body|sk-orca-test/);
});
