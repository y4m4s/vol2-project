import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import type { NavigatorController } from "../src/application/NavigatorController";
import type { NavigatorViewModel } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {} : originalLoad(id, parent, isMain);
const { NavigatorViewProvider } = require("../src/views/NavigatorViewProvider") as typeof import("../src/views/NavigatorViewProvider");
loader._load = originalLoad;

function createHarness() {
  let change = () => {};
  let payload = { requestState: "idle" } as NavigatorViewModel;
  const sent: NavigatorViewModel[] = [];
  const controller = {
    onDidChangeState: (listener: () => void) => {
      change = listener;
      return { dispose() {} };
    },
    getViewModel: () => payload
  } as unknown as NavigatorController;
  const provider = new NavigatorViewProvider({} as vscode.Uri, controller);
  Object.assign(provider, { view: { webview: {
    postMessage: async (message: { payload: NavigatorViewModel }) => {
      sent.push(message.payload);
      return true;
    }
  } } });
  return {
    provider, sent,
    update(statusMessage?: NavigatorViewModel["statusMessage"]) {
      payload = { ...payload, ...(statusMessage ? { statusMessage } : {}) };
      change();
    },
    async flush() {
      await (provider as unknown as { postQueue: Promise<void> }).postQueue;
    }
  };
}

for (const statusMessage of [
  { kind: "info" as const, text: "設定を保存しました。" },
  { kind: "info" as const, text: "回答生成を中断しました。", scope: "guidance" as const }
]) {
  test(`連続更新中も75msで通知を送信する: ${statusMessage.text}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = createHarness();
    t.after(() => h.provider.dispose());
    h.update(statusMessage);
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(25);
      h.update();
    }
    await h.flush();
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].statusMessage, statusMessage);
    assert.equal(h.sent[0].requestState, "idle");

    t.mock.timers.tick(75);
    await h.flush();
    assert.equal(h.sent.length, 2, "送信後の更新も次の枠で送信する");
  });
}

test("同時更新は最新状態に集約し、破棄後は送信しない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = createHarness();
  t.after(() => h.provider.dispose());
  h.update({ kind: "info", text: "保存中" });
  h.update({ kind: "info", text: "保存完了" });
  t.mock.timers.tick(75);
  await h.flush();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].statusMessage?.text, "保存完了");
  h.update();
  h.provider.dispose();
  t.mock.timers.tick(75);
  await h.flush();
  assert.equal(h.sent.length, 1);
});
