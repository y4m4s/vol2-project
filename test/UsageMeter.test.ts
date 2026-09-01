import assert from "node:assert/strict";
import test from "node:test";
import { UsageMeter } from "../src/services/UsageMeter";
import type { AiProviderId } from "../src/shared/types";

// vscode.Memento の最小実装。UsageMeter は get / update しか使わない。
class MemoryMemento {
  private readonly values = new Map<string, unknown>();

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }
}

function createMeter(): UsageMeter {
  return new UsageMeter(new MemoryMemento() as never);
}

async function record(meter: UsageMeter, providerId: AiProviderId, tokens: number): Promise<void> {
  await meter.record({ providerId, modelId: "test-model", inputTokens: tokens, outputTokens: 0 });
}

// 以前は Copilot 限定だったため、実費の出る OrcaRouter で常時モードを止める手段がなかった。
test("日次トークン上限はすべての接続先に適用される", async () => {
  for (const providerId of ["copilot", "orcaRouter", "lmStudio"] as const) {
    const meter = createMeter();
    assert.equal(meter.isTokenLimitExceeded(providerId, 1000), false);

    await record(meter, providerId, 999);
    assert.equal(meter.isTokenLimitExceeded(providerId, 1000), false, `${providerId} below limit`);

    await record(meter, providerId, 1);
    assert.equal(meter.isTokenLimitExceeded(providerId, 1000), true, `${providerId} at limit`);
  }
});

test("上限 0 は無制限として扱う", async () => {
  const meter = createMeter();
  await record(meter, "orcaRouter", 5_000_000);
  assert.equal(meter.isTokenLimitExceeded("orcaRouter", 0), false);
});

test("上限判定は接続先ごとに独立している", async () => {
  const meter = createMeter();
  await record(meter, "orcaRouter", 1500);

  assert.equal(meter.isTokenLimitExceeded("orcaRouter", 1000), true);
  assert.equal(meter.isTokenLimitExceeded("copilot", 1000), false);
});

test("利用量は接続先ごとに集計される", async () => {
  const meter = createMeter();
  await record(meter, "copilot", 100);
  await record(meter, "orcaRouter", 250);

  assert.equal(meter.getToday("copilot").inputTokens, 100);
  assert.equal(meter.getToday("orcaRouter").inputTokens, 250);
  assert.equal(meter.getToday().inputTokens, 350);
  assert.equal(meter.getToday().requestCount, 2);
});

test("LM Studio の記録料金は 0 にする", () => {
  assert.equal(createMeter().getRecordedCostUsd("lmStudio"), 0);
});

test("単価表で推測せず、プロバイダー料金がない場合は未取得にする", async () => {
  const meter = createMeter();
  await record(meter, "orcaRouter", 100);
  assert.equal(meter.getRecordedCostUsd("orcaRouter"), undefined);
});

test("プロバイダーが返した料金だけを集計する", async () => {
  const meter = createMeter();
  await meter.record({
    providerId: "orcaRouter",
    modelId: "dynamic-model",
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0123
  });
  assert.equal(meter.getRecordedCostUsd("orcaRouter"), 0.0123);
});
