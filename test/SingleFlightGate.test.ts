import assert from "node:assert/strict";
import test from "node:test";
import { SingleFlightGate } from "../src/services/SingleFlightGate";

test("準備中を含め、解放されるまで後続処理を開始させない", () => {
  const gate = new SingleFlightGate();
  const releaseFirst = gate.tryAcquire();

  assert.ok(releaseFirst);
  assert.equal(gate.tryAcquire(), undefined);

  releaseFirst();
  assert.ok(gate.tryAcquire());
});

test("解放関数を複数回呼んでも、後続ガードを誤って解放しない", () => {
  const gate = new SingleFlightGate();
  const releaseFirst = gate.tryAcquire();
  assert.ok(releaseFirst);
  releaseFirst();

  const releaseSecond = gate.tryAcquire();
  assert.ok(releaseSecond);
  releaseFirst();
  assert.equal(gate.tryAcquire(), undefined);

  releaseSecond();
  assert.ok(gate.tryAcquire());
});
