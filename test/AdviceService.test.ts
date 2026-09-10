import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { ConnectedProviderModel, ConnectionService } from "../src/services/ConnectionService";
import { UsageMeter } from "../src/services/UsageMeter";
import { SingleFlightGate } from "../src/services/SingleFlightGate";
import { OrcaRouterError } from "../src/services/OrcaRouterClient";
import type { AiTextRequest } from "../src/services/AiRequestPolicy";

class TestTokenSource {
  private cancelled = false;
  private readonly listeners = new Set<(event: unknown) => unknown>();
  public readonly token;
  public constructor() {
    const source = this;
    this.token = {
      get isCancellationRequested() { return source.cancelled; },
      onCancellationRequested(listener: (event: unknown) => unknown) {
        source.listeners.add(listener);
        return { dispose: () => { source.listeners.delete(listener); } };
      }
    };
  }
  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of this.listeners) listener(undefined);
  }
  public dispose(): void { this.listeners.clear(); }
}

// Load the actual service with only the VS Code runtime primitives replaced.
// node:test isolates this file from tests of other modules.
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {
  CancellationTokenSource: TestTokenSource,
  CancellationError: class extends Error {},
  LanguageModelError: class extends Error {}
} : originalLoad(id, parent, isMain);
const { AdviceService } = require("../src/services/AdviceService") as typeof import("../src/services/AdviceService");
loader._load = originalLoad;

const input = {
  kind: "manual" as const,
  context: { referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] }
};
const answer = JSON.stringify({ kind: "advice", text: "確認の観点です。" });

function harness(options: {
  countTokens?: ConnectedProviderModel["countTokens"];
  persist?: () => Promise<void>;
  response?: string;
  responses?: string[];
  inputTokens?: number;
  outputTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  requestError?: OrcaRouterError;
  onResponse?: () => void;
  costUsd?: number;
  finishReasons?: string[];
} = {}) {
  let calls = 0;
  const requests: AiTextRequest[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  let resets = 0;
  const model: ConnectedProviderModel = {
    providerId: options.requestError ? "orcaRouter" : "copilot", modelId: "mock", modelLabel: "mock",
    profileSource: { maxInputTokens: options.maxInputTokens, maxOutputTokens: options.maxOutputTokens },
    requestText: async (request) => {
      requests.push(request);
      calls += 1;
      if (options.requestError) throw options.requestError;
      options.onResponse?.();
      return { text: options.responses?.[calls - 1] ?? options.response ?? answer, inputTokens: options.inputTokens, outputTokens: options.outputTokens, costUsd: options.costUsd,
        finishReason: options.finishReasons?.[calls - 1] };
    },
    countTokens: options.countTokens
  };
  const connection = {
    getConnectedModel: () => model,
    getState: () => "connected",
    resetToDisconnected: () => { resets += 1; },
    markRestricted: () => { resets += 1; },
    markUnavailable: () => { resets += 1; }
  } as unknown as ConnectionService;
  const meter = new UsageMeter({
    keys: () => [], get: () => undefined, update: options.persist ?? (async () => {})
  });
  return { service: new AdviceService(connection, meter, (entry) => diagnostics.push(entry)), meter, requests, diagnostics, calls: () => calls, resets: () => resets };
}

test("高強度は8192トークンを要求し、低強度は2048を維持する", async () => {
  for (const kind of ["manual", "always"] as const) {
    for (const assistanceDepth of ["low", "high"] as const) {
      const h = harness({ response: kind === "always" ? JSON.stringify({ kind: "advice", focus: "continue", text: "次の判断です。" }) : answer });
      assert.equal((await h.service.requestGuidance({ ...input, kind, assistanceDepth })).ok, true);
      assert.equal(h.requests[0].maxOutputTokens, assistanceDepth === "high" ? 8192 : 2048);
    }
  }
});

test("実サービスは既存コード再提案を再送なしで控え、利用量と内容を含まない診断を残す", async () => {
  const text = '「■」を5つ並べて表示させるためには、print("■" * 5)のように文字列を繰り返し表示する必要があります。';
  const h = harness({ response: JSON.stringify({ kind: "advice", focus: "continue", text }), inputTokens: 70, outputTokens: 20 });
  const result = await h.service.requestGuidance({ ...input, kind: "always", context: { ...input.context,
    activeFileExcerpt: 'print("■" * 5)', additionalContext: "秘密の課題: ■を5つ表示" } });
  assert.ok(result.ok && result.outcome === "no_advice");
  assert.equal(result.text, "");
  assert.equal(result.focus, "none");
  assert.equal(h.calls(), 1);
  assert.equal(result.usage?.outputTokens, 20);
  assert.equal(result.responseMetadata?.attemptCount, 1);
  assert.ok(h.diagnostics.some(item => item.event === "automatic_advice_suppressed"));
  assert.match(String(h.diagnostics.find(item => item.event === "automatic_context")?.promptHash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /秘密|print|■/);
});

test("形式修復後に出た既存コード再提案も抑制する", async () => {
  const h = harness({ responses: ["invalid JSON", JSON.stringify({ kind: "advice", focus: "continue",
    text: 'print("Hi")のように出力してください。' })] });
  const result = await h.service.requestGuidance({ ...input, kind: "always", context: { ...input.context,
    activeFileExcerpt: 'print("Hi")', additionalContext: "Hiを表示" } });
  assert.ok(result.ok && result.outcome === "no_advice");
  assert.equal(h.calls(), 2);
  assert.equal(result.responseMetadata?.attemptCount, 2);
});

test("自動回答の形式修正でもfocus契約を維持し、修正後のfocusを返す", async () => {
  const h = harness({ responses: [answer, JSON.stringify({ kind: "advice", focus: "review", text: "値が未定義になる条件を確認してください。" })] });
  const result = await h.service.requestGuidance({ ...input, kind: "always" });
  assert.ok(result.ok);
  assert.equal(result.focus, "review");
  assert.equal(h.calls(), 2);
  assert.match(JSON.stringify(h.requests[1]), /focus/);
});

test("取得できたモデル固有の出力上限を超えて要求しない", async () => {
  const h = harness({ maxOutputTokens: 4096 });
  await h.service.requestGuidance({ ...input, assistanceDepth: "high" });
  assert.equal(h.requests[0].maxOutputTokens, 4096);
});

test("length終了は形式修正を再送せず、利用量を保持し接続も維持する", async () => {
  for (const response of ["", '{"kind":"advice","text":"unfinished', answer]) {
    const h = harness({ response, finishReasons: ["length"], outputTokens: 2048, inputTokens: 5452, costUsd: 0 });
    const result = await h.service.requestGuidance({ ...input, kind: "always" });
    assert.ok(!result.ok);
    assert.match(result.message, /出力上限/);
    assert.equal(h.calls(), 1);
    assert.equal(h.resets(), 0);
    assert.equal(h.meter.getToday().outputTokens, 2048);
    assert.equal(h.diagnostics[0].finishReason, "length");
    assert.ok(!JSON.stringify(h.diagnostics).includes("unfinished"));
  }
});

test("形式修正の2回目が上限に達した場合も上限エラーを返し、3回目を送らない", async () => {
  const h = harness({ response: "invalid", finishReasons: ["stop", "length"] });
  const result = await h.service.requestGuidance({ ...input, assistanceDepth: "high" });
  assert.ok(!result.ok);
  assert.match(result.message, /出力上限/);
  assert.equal(h.calls(), 2);
  assert.deepEqual(h.requests.map((request) => request.maxOutputTokens), [8192, 8192]);
});

test("OrcaRouterのRetry-Afterは検証済み秒数だけ表示し、非対応形式は一般案内にする", async (t) => {
  t.mock.method(console, "warn", () => {});
  for (const code of ["free_rate_limited", "rate_limited"]) {
    for (const value of ["42", "0", " 0042 ", "Wed, 21 Oct 2026 07:28:00 GMT", "oops", "", "-1", "Infinity", "0x10", "1.5"]) {
      const h = harness({ requestError: new OrcaRouterError("rateLimit", "private response body", 429, code, value) });
      const result = await h.service.requestGuidance(input);
      assert.ok(!result.ok);
      assert.equal(result.connectionState, "restricted");
      if (["42", "0", " 0042 "].includes(value)) {
        assert.ok(result.message.includes(`${Number(value)}秒後に再試行してください。`));
      } else {
        assert.match(result.message, /時間を置いて再試行/);
        assert.doesNotMatch(result.message, /秒後|入力上限|private response body/);
      }
      if (code === "free_rate_limited") assert.match(result.message, /有料モデルへは切り替えていません/);
    }
  }
});

test("OrcaRouterのヘッダーなし無料制限と未知コードは既存の案内・接続分類を維持する", async (t) => {
  t.mock.method(console, "warn", () => {});
  for (const [error, expected, state] of [
    [new OrcaRouterError("rateLimit", "body", 429, "free_rate_limited"), /入力上限/, "restricted"],
    [new OrcaRouterError("quota", "body", 403, "free_quota_exhausted"), /無料モデル容量/, "restricted"],
    [new OrcaRouterError("quota", "body", 403, "new_free_quota"), /残高・無料容量・キー利用上限/, "restricted"],
    [new OrcaRouterError("other", "body", 400, "new_guardrail_code"), /入力内容またはモデル設定/, "connected"]
  ] as const) {
    const h = harness({ requestError: error });
    const result = await h.service.requestGuidance(input);
    assert.ok(!result.ok);
    assert.match(result.message, expected);
    assert.equal(result.connectionState, state);
    if (state === "connected") assert.equal(h.resets(), 0);
  }
});

test("トークン計測が停止しても1秒で概算に切り替え、計測をキャンセルする", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tokens: Array<{ isCancellationRequested: boolean }> = [];
  const h = harness({ countTokens: async (_text, token) => {
    tokens.push(token!);
    return new Promise<number>(() => {});
  } });
  const pending = h.service.requestGuidance(input);
  await nextTurn();
  assert.equal(tokens.length, 2);
  t.mock.timers.tick(1000);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.usage!.inputTokens > 0);
  assert.ok(tokens.every((token) => token.isCancellationRequested));
  assert.equal(h.calls(), 1);
});

test("計測中の中断で排他ガードを解放し、次の相談を実行できる", async () => {
  const source = new TestTokenSource();
  const gate = new SingleFlightGate();
  let rejectLate: ((error: Error) => void) | undefined;
  let counting = true;
  const h = harness({ countTokens: async () => counting
    ? new Promise<number>((_resolve, reject) => { rejectLate = reject; })
    : 5 });
  const release = gate.tryAcquire()!;
  const pending = h.service.requestGuidance(input, source.token).finally(release);
  await nextTurn();
  source.cancel();
  const result = await pending;
  assert.ok(!result.ok && result.cancelled);
  const nextRelease = gate.tryAcquire();
  assert.ok(nextRelease);
  counting = false;
  assert.equal((await h.service.requestGuidance(input)).ok, true);
  nextRelease();
  rejectLate?.(new Error("late failure"));
  await nextTurn();
  assert.equal(h.resets(), 0);
});

test("利用量の保存失敗で回答・接続・日次上限を失わない", async (t) => {
  t.mock.method(console, "warn", () => {});
  const h = harness({ inputTokens: 100, outputTokens: 20, persist: async () => { throw new Error("disk full"); } });
  const result = await h.service.requestGuidance(input);
  assert.ok(result.ok && result.text === "確認の観点です。");
  assert.equal(h.calls(), 1);
  assert.equal(h.resets(), 0);
  assert.equal(h.meter.isTokenLimitExceeded("copilot", 120), true);
});

test("応答受信直後のキャンセルでも課金情報とトークンを一度だけ記録する", async () => {
  const source = new TestTokenSource();
  const h = harness({ inputTokens: 100, outputTokens: 20, costUsd: 0.25, onResponse: () => source.cancel() });
  const result = await h.service.requestGuidance(input, source.token);
  assert.ok(!result.ok && result.cancelled);
  assert.equal(h.meter.getToday().requestCount, 1);
  assert.equal(h.meter.getToday().inputTokens, 100);
  assert.equal(h.meter.getRecordedCostUsd("copilot"), 0.25);
  assert.equal(h.calls(), 1);
});

test("応答サイズ超過で表示を拒否しても取得済みの料金を記録する", async () => {
  const h = harness({ response: "x".repeat(50001), inputTokens: 100, outputTokens: 20000, costUsd: 0.5 });
  const result = await h.service.requestGuidance(input);
  assert.ok(!result.ok);
  assert.equal(h.meter.getToday().outputTokens, 20000);
  assert.equal(h.meter.getRecordedCostUsd("copilot"), 0.5);
  assert.equal(h.calls(), 1);
});

test("OrcaRouterの予算・権限エラーで原因別の案内を表示する", async () => {
  for (const [kind, expected, state] of [
    ["keyQuota", /キーの利用上限/, "restricted"],
    ["balanceQuota", /月次予算/, "restricted"],
    ["cycleLimit", /リセット時刻/, "restricted"],
    ["modelAccess", /許可モデル一覧/, "unavailable"],
    ["forbidden", /IP許可リスト/, "unavailable"]
  ] as const) {
    const h = harness({ requestError: new OrcaRouterError(kind, "private body", 403) });
    const result = await h.service.requestGuidance(input);
    assert.ok(!result.ok);
    assert.match(result.message, expected);
    assert.equal(result.connectionState, state);
  }
});

test("利用量の保存完了を待たず回答し、返された片側の利用量を保持する", async () => {
  const h = harness({ inputTokens: 123, countTokens: async () => 7, persist: async () => new Promise<void>(() => {}) });
  const result = await h.service.requestGuidance(input);
  assert.ok(result.ok);
  assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 7, costUsd: undefined });
  assert.equal(h.meter.getToday().requestCount, 1);
});

test("長すぎる質問は送信前に拒否し接続を維持する", async () => {
  const h = harness({ maxInputTokens: 4096 });
  const result = await h.service.requestGuidance({ ...input, userPrompt: "質問".repeat(20000) });
  assert.ok(!result.ok && result.connectionState === "connected");
  assert.equal(h.calls(), 0);
  assert.equal(h.resets(), 0);
});

test("修正再生成も最終入力上限を超えたら追加送信しない", async () => {
  const h = harness({ maxInputTokens: 1000, response: "not JSON" });
  const result = await h.service.requestGuidance({ ...input, userPrompt: "質問".repeat(50) });
  assert.equal(h.calls(), 1);
  assert.ok(!result.ok && result.connectionState === "connected");
  assert.equal(h.resets(), 0);
});
