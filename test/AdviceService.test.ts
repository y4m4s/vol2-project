import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { ConnectedProviderModel, ConnectionService } from "../src/services/ConnectionService";
import { UsageMeter } from "../src/services/UsageMeter";
import { SingleFlightGate } from "../src/services/SingleFlightGate";

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
  inputTokens?: number;
  outputTokens?: number;
  maxInputTokens?: number;
} = {}) {
  let calls = 0;
  let resets = 0;
  const model: ConnectedProviderModel = {
    providerId: "copilot", modelId: "mock", modelLabel: "mock",
    profileSource: { maxInputTokens: options.maxInputTokens },
    requestText: async () => {
      calls += 1;
      return { text: options.response ?? answer, inputTokens: options.inputTokens, outputTokens: options.outputTokens };
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
  return { service: new AdviceService(connection, meter), meter, calls: () => calls, resets: () => resets };
}

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
