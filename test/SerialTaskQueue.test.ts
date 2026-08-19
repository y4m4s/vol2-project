import assert from "node:assert/strict";
import test from "node:test";
import { SerialTaskQueue } from "../src/services/SerialTaskQueue";

test("非同期タスクを登録順に実行する", async () => {
  const queue = new SerialTaskQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = queue.run(async () => {
    events.push("second");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second"]);
});

test("先行タスクの失敗後も後続タスクを実行する", async () => {
  const queue = new SerialTaskQueue();
  const failed = queue.run(async () => {
    throw new Error("expected");
  });
  const recovered = queue.run(async () => "ok");

  await assert.rejects(failed, /expected/);
  assert.equal(await recovered, "ok");
});
