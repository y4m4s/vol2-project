import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { LearningSupportCoordinator, interventionKey, INTERVENTION_COOLDOWN_MS, type LearningSupportRuntime } from "../src/application/coordinators/LearningSupportCoordinator";
import type { StuckTopicSnapshot } from "../src/services/StuckSignalTracker";

const topic = (id = "occ-1"): StuckTopicSnapshot => ({ documentKey: "file:///workspace/a.ts", topicId: id,
  kind: "diagnostic", state: "Struggling", score: 6, groups: ["A", "C"], durationMs: 100_000, lineStart: 10, lineEnd: 10 });

function harness() {
  let now = 1000;
  const runtime: LearningSupportRuntime = { enabled: true, mode: "manual", connected: true, requestIdle: true,
    composerActive: false, paused: false, focused: true, documentKey: topic().documentKey,
    editorIdleMs: 20_000, idleDelayMs: 10_000, requestIntervalMs: 20_000 };
  const offers: (StuckTopicSnapshot | undefined)[] = [], requests: string[] = [], cancelled: string[] = [];
  const coordinator = new LearningSupportCoordinator({ runtime: () => runtime,
    requestReevaluation: value => { requests.push(interventionKey(value)); return true; },
    cancelReevaluation: key => cancelled.push(key), showSuggestion: value => offers.push(value), log: () => {} }, () => now);
  return { coordinator, runtime, offers, requests, cancelled, at: (value: number) => { now = value; },
    update: (values = [topic()], known = values.map(interventionKey)) => coordinator.update(values, known) };
}

test("manual は提案だけ。完了後は同じ論題に再介入せず、別の論題も10分空ける", t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  h.update(); h.coordinator.refresh(); assert.equal(h.offers.filter(Boolean).length, 1); assert.equal(h.requests.length, 0);
  const key = interventionKey(topic()); assert.ok(h.coordinator.begin(key)); h.coordinator.finish(key, "advice");
  const second = topic("occ-2"); h.update([topic(), second]); assert.equal(h.offers.filter(Boolean).length, 1);
  h.at(1001 + INTERVENTION_COOLDOWN_MS); h.coordinator.refresh();
  assert.equal(h.offers.at(-1)?.topicId, "occ-2");
});

test("支援オフ・入力中・リクエスト中・非フォーカスでは新しい提案を出さない", t => {
  for (const field of ["enabled", "requestIdle", "focused"] as const) {
    const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime[field] = false; h.update(); assert.equal(h.offers.length, 0);
    h.runtime[field] = true; h.coordinator.refresh(); assert.equal(h.offers.filter(Boolean).length, 1);
  }
  const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.composerActive = true; h.update(); assert.equal(h.offers.length, 0);
  h.runtime.composerActive = false; h.coordinator.refresh(); assert.equal(h.offers.filter(Boolean).length, 1);
});

test("解消・除外・別ファイルへの移動で提案を取り下げ、元の文書へ戻れば再評価する", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.update();
  h.runtime.documentKey = "file:///workspace/b.ts"; h.coordinator.refresh(); assert.equal(h.offers.at(-1), undefined);
  h.runtime.documentKey = topic().documentKey; h.coordinator.refresh(); assert.equal(h.offers.at(-1)?.topicId, "occ-1");
  h.update([], []); assert.equal(h.offers.at(-1), undefined); assert.equal(h.coordinator.getTopic(interventionKey(topic())), undefined);
});

test("墓標の期限内の再発では、介入済みの記録を維持する", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); const key = interventionKey(topic()); h.update();
  h.coordinator.begin(key); h.coordinator.finish(key, "no_advice"); h.update([], [key]);
  h.at(1001 + INTERVENTION_COOLDOWN_MS); h.update(); assert.equal(h.offers.at(-1), undefined);
  h.update([], []); h.update([topic("occ-new")]); assert.equal(h.offers.at(-1)?.topicId, "occ-new");
});

test("自動再判定は一時停止・切断中に予約せず、破棄された予約は解除後に再予約する", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.mode = "always"; h.runtime.paused = true; h.update();
  assert.equal(h.requests.length, 0); h.runtime.paused = false; h.runtime.connected = false; h.coordinator.refresh(); assert.equal(h.requests.length, 0);
  h.runtime.connected = true; h.coordinator.refresh(); assert.equal(h.requests.length, 1);
  h.coordinator.dropped(interventionKey(topic())); h.coordinator.refresh(); assert.equal(h.requests.length, 2);
  assert.ok(h.coordinator.begin(interventionKey(topic()))); assert.equal(h.coordinator.begin(interventionKey(topic())), undefined);
});

test("通信エラーは初回と再試行1回で打ち切り、陳腐化も2回まで", t => {
  for (const outcome of ["error", "stale"] as const) {
    const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.mode = "always"; h.update(); const key = interventionKey(topic());
    h.coordinator.begin(key); h.coordinator.finish(key, outcome); assert.equal(h.requests.length, 1);
    h.at(21_001); h.coordinator.refresh(); assert.equal(h.requests.length, 2);
    h.coordinator.begin(key); h.coordinator.finish(key, outcome); h.at(42_002); h.coordinator.refresh(); assert.equal(h.requests.length, 2);
  }
});

test("却下・キャンセルした論題は再提案しない", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.update(); h.coordinator.dismiss(interventionKey(topic()));
  h.at(1_000_000); h.coordinator.refresh(); assert.equal(h.offers.filter(Boolean).length, 1);
});

test("支援をオフにしてから戻したとき、未処理の論題は再び提案できる", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.update();
  h.runtime.enabled = false; h.coordinator.refresh(); assert.equal(h.offers.at(-1), undefined);
  h.runtime.enabled = true; h.coordinator.refresh(); assert.equal(h.offers.at(-1)?.topicId, "occ-1");
});

test("複数の論題を先に予約せず、生成完了の通知前にidleへ戻っても次の介入を始めない", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.mode = "always";
  const second = topic("occ-2"); h.update([topic(), second]); h.coordinator.refresh(); assert.equal(h.requests.length, 1);
  h.coordinator.begin(interventionKey(topic()));
  h.runtime.requestIdle = false; h.coordinator.refresh(); h.runtime.requestIdle = true; h.coordinator.refresh();
  assert.equal(h.requests.length, 1);
  h.coordinator.finish(interventionKey(topic()), "advice"); h.coordinator.refresh(); assert.equal(h.requests.length, 1);
  h.at(1001 + INTERVENTION_COOLDOWN_MS); h.coordinator.refresh(); assert.equal(h.requests.length, 2);
});

test("文脈収集中の再キューは、生成の試行にも生成後の陳腐化回数にも数えない", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.mode = "always"; h.update();
  const key = interventionKey(topic());
  for (let i = 0; i < 3; i++) { assert.ok(h.coordinator.begin(key)); h.coordinator.deferPreparation(key, true); }
  assert.ok(h.coordinator.begin(key)); h.coordinator.finish(key, "error"); h.at(21_001); h.coordinator.refresh();
  assert.equal(h.requests.length, 2); assert.ok(h.coordinator.begin(key)); h.coordinator.finish(key, "error");
  h.at(42_002); h.coordinator.refresh(); assert.equal(h.requests.length, 2);
});

const loader = Module as unknown as { _load(id: string, parent: unknown, main: boolean): unknown };
const originalLoad = loader._load;
class Emitter<T> {
  private listeners: ((value: T) => void)[] = [];
  public event = (listener: (value: T) => void) => { this.listeners.push(listener); return { dispose() {} }; };
  public fire(value: T): void { for (const listener of this.listeners) listener(value); }
  public dispose(): void {}
}
loader._load = (id, parent, main) => id === "vscode" ? { EventEmitter: Emitter } : originalLoad(id, parent, main);
const { AdviceScheduler } = require("../src/services/AdviceScheduler") as typeof import("../src/services/AdviceScheduler");
loader._load = originalLoad;

test("常時モードを一時停止してから必要時へ切り替えても、ローカル提案を表示する", t => {
  const scheduler = new AdviceScheduler(); t.after(() => scheduler.dispose());
  const settings = { idleDelayMs: 100, requestIntervalMs: 1000 };
  scheduler.configure(settings, { mode: "always", connectionState: "connected", requestState: "idle" });
  scheduler.togglePaused();
  const h = harness(); t.after(() => h.coordinator.dispose());
  h.runtime.mode = "always"; h.runtime.paused = scheduler.getState().paused;
  h.update(); assert.equal(h.offers.length, 0); assert.equal(h.requests.length, 0);
  scheduler.configure(settings, { mode: "manual", connectionState: "connected", requestState: "idle" });
  h.runtime.mode = "manual"; h.runtime.paused = scheduler.getState().paused;
  assert.equal(h.runtime.paused, true, "常時モードの停止状態が残る手順を再現する");
  h.coordinator.refresh();
  assert.equal(h.offers.at(-1)?.topicId, "occ-1");
  assert.equal(h.requests.length, 0, "必要時モードでは自動生成を予約しない");
});

test("再判定予約は入力中フラグ・操作時刻を変更せず、既存のアイドルとクールダウンを待つ", t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const scheduler = new AdviceScheduler(); t.after(() => scheduler.dispose());
  scheduler.configure({ idleDelayMs: 100, requestIntervalMs: 1000 }, { mode: "always", connectionState: "connected", requestState: "idle" });
  let count = 0; scheduler.onDidTriggerAdvice(() => count++);
  scheduler.handleActivity("text_edit"); scheduler.setComposerActive(true);
  const activity = scheduler.getTriggerSnapshot().idleDurationMs;
  assert.equal(scheduler.requestReevaluation("topic"), true); assert.equal(scheduler.isComposerActive(), true);
  assert.equal(scheduler.getTriggerSnapshot().idleDurationMs, activity);
  t.mock.timers.tick(2000); assert.equal(count, 0);
  scheduler.setComposerActive(false); t.mock.timers.tick(99); assert.equal(count, 0); t.mock.timers.tick(1); assert.equal(count, 1);
  scheduler.notifyAdviceCompleted(); scheduler.requestReevaluation("topic-2");
  t.mock.timers.tick(999); assert.equal(count, 1); t.mock.timers.tick(1); assert.equal(count, 2);
});

test("生成中に予約した再判定は完了まで保持し、一時停止で破棄を通知する", t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const scheduler = new AdviceScheduler(); t.after(() => scheduler.dispose());
  const settings = { idleDelayMs: 100, requestIntervalMs: 1000 };
  scheduler.configure(settings, { mode: "always", connectionState: "connected", requestState: "requesting_guidance" });
  let count = 0; const dropped: string[] = [];
  scheduler.onDidTriggerAdvice(() => count++); scheduler.onDidDropReevaluation(key => dropped.push(key));
  scheduler.requestReevaluation("topic"); t.mock.timers.tick(2000); assert.equal(count, 0);
  scheduler.configure(settings, { mode: "always", connectionState: "connected", requestState: "idle" }); assert.equal(count, 1);
  scheduler.requestReevaluation("next"); scheduler.togglePaused(); assert.deepEqual(dropped, ["next"]);
  assert.equal(scheduler.requestReevaluation("paused"), false);
});

test("中断ボタン: 予約だけの論題は完了にせず、通常の間隔の後に予約し直す。生成中の論題だけ完了にする", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.mode = "always"; h.update();
  const key = interventionKey(topic());
  assert.deepEqual(h.requests, [key]);
  // 別の相談を中断した（つまずきの論題は予約されただけで、まだ生成していない）
  h.coordinator.cancelActive();
  assert.deepEqual(h.cancelled, [key]);
  h.coordinator.refresh(); assert.equal(h.requests.length, 1, "間隔を空けずに予約し直さない");
  h.at(1000 + h.runtime.requestIntervalMs); h.coordinator.refresh();
  assert.equal(h.requests.length, 2, "完了扱いにせず、再び予約する");
  // 生成中に中断したら完了（同じ論題には再介入しない）
  assert.ok(h.coordinator.begin(key)); h.coordinator.cancelActive();
  h.at(10_000_000); h.coordinator.refresh(); assert.equal(h.requests.length, 2);
});

test("送信前に止めたもの（skipped）は試行に数えず、送る文脈がないもの（nothing_to_send）は間隔を空けずに完了する", t => {
  const h = harness(); t.after(() => h.coordinator.dispose()); h.runtime.mode = "always";
  const first = topic(), second = topic("occ-2"), key = interventionKey(first);
  h.update([first]);
  for (let i = 0; i < 3; i++) {
    assert.ok(h.coordinator.begin(key), `skipped の後も再び始められる（${i + 1}回目）`);
    h.coordinator.finish(key, "skipped");
    h.at(1000 + (i + 1) * h.runtime.requestIntervalMs); h.coordinator.refresh();
  }
  assert.ok(h.coordinator.begin(key)); h.coordinator.finish(key, "nothing_to_send");
  assert.equal(h.coordinator.begin(key), undefined, "同じ論題は完了");
  const before = h.requests.length;
  h.update([first, second]);
  assert.equal(h.requests.at(-1), interventionKey(second), "論題をまたぐ10分の間隔を空けない");
  assert.equal(h.requests.length, before + 1);
});
