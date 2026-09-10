import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import type { AutoAdviceTriggerEvent } from "../src/services/AdviceScheduler";
import { createAutomaticFingerprint } from "../src/application/GuidanceInput";
import { automaticGuidanceLabel, getAutoAdviceWaitStatus } from "../src/shared/automaticGuidance";

class Emitter<T> {
  private listeners: ((value: T) => void)[] = [];
  public event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((item) => item !== listener); } };
  };
  public fire(value: T): void { for (const listener of this.listeners) listener(value); }
  public dispose(): void { this.listeners = []; }
}
class Position {
  public constructor(public line: number, public character: number) {}
}
class Range {
  public constructor(public start: Position, public end: Position) {}
}
const windowMock: { activeTextEditor?: vscode.TextEditor } = {};
let diagnostics: vscode.Diagnostic[] = [];
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, main) => id === "vscode" ? {
  EventEmitter: Emitter, Position, Range, window: windowMock,
  workspace: { getWorkspaceFolder: () => ({ name: "repo" }) },
  languages: { getDiagnostics: () => diagnostics },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }
} : originalLoad(id, parent, main);
const { AdviceScheduler } = require("../src/services/AdviceScheduler") as typeof import("../src/services/AdviceScheduler");
const { ContextCollector } = require("../src/services/ContextCollector") as typeof import("../src/services/ContextCollector");
const { ConversationStore } = require("../src/services/ConversationStore") as typeof import("../src/services/ConversationStore");
loader._load = originalLoad;

test("編集と診断更新を集約し、カーソル操作で待機し、発火・停止後は破棄する", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const scheduler = new AdviceScheduler();
  const events: AutoAdviceTriggerEvent[] = [];
  scheduler.onDidTriggerAdvice((event) => events.push(event));
  scheduler.configure({ idleDelayMs: 100, requestIntervalMs: 0 }, { mode: "always", connectionState: "connected", requestState: "idle" });
  scheduler.handleActivity("text_edit");
  t.mock.timers.tick(10);
  scheduler.handleActivity("diagnostics_change");
  scheduler.handleActivity("text_edit");
  assert.deepEqual(scheduler.getTriggerSnapshot().signals.map((x) => x.reason), ["diagnostics_change", "text_edit"]);
  t.mock.timers.tick(90);
  scheduler.handleCursorActivity();
  t.mock.timers.tick(20);
  assert.equal(events.length, 0);
  t.mock.timers.tick(80);
  assert.equal(events.length, 1);
  assert.equal(events[0].idleDurationMs, 100);
  assert.equal(events[0].signals.length, 2);
  assert.equal(scheduler.getTriggerSnapshot().signals.length, 0);
  scheduler.handleActivity("text_edit");
  scheduler.handleActivity("editor_change");
  assert.deepEqual(scheduler.getTriggerSnapshot().signals.map((x) => x.reason), ["editor_change"]);
  scheduler.togglePaused();
  scheduler.handleActivity("text_edit");
  assert.equal(scheduler.getTriggerSnapshot().signals.length, 0);
  scheduler.togglePaused();
  scheduler.handleActivity("selection_change");
  scheduler.cancelPending();
  t.mock.timers.tick(200);
  assert.equal(events.length, 1);
  scheduler.handleActivity("text_edit");
  scheduler.configure({ idleDelayMs: 100, requestIntervalMs: 0 }, { mode: "always", connectionState: "disconnected", requestState: "idle" });
  assert.equal(scheduler.getTriggerSnapshot().signals.length, 0);
  scheduler.dispose();
});

test("再予約は新しいイベント・一時停止・手動モード・チャット入力を尊重する", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const scheduler = new AdviceScheduler();
  t.after(() => scheduler.dispose());
  const settings = { idleDelayMs: 100, requestIntervalMs: 0 };
  const state = { mode: "always" as const, connectionState: "connected" as const, requestState: "idle" as const };
  const event = { signals: [{ reason: "text_edit" as const, occurredAt: 1000 }], idleDurationMs: 100 };
  scheduler.configure(settings, state);
  scheduler.handleActivity("editor_change");
  scheduler.requeueStaleTrigger(event);
  assert.deepEqual(scheduler.getTriggerSnapshot().signals.map((signal) => signal.reason), ["editor_change"]);
  scheduler.togglePaused();
  scheduler.requeueStaleTrigger(event);
  assert.equal(scheduler.getTriggerSnapshot().signals.length, 0);
  scheduler.togglePaused();
  scheduler.configure(settings, { ...state, mode: "manual" });
  scheduler.requeueStaleTrigger(event);
  assert.equal(scheduler.getTriggerSnapshot().signals.length, 0);
  scheduler.configure(settings, state);
  scheduler.setComposerActive(true);
  let fired = 0;
  scheduler.onDidTriggerAdvice(() => { fired++; });
  scheduler.requeueStaleTrigger(event);
  t.mock.timers.tick(500);
  assert.equal(fired, 0);
  scheduler.setComposerActive(false);
  t.mock.timers.tick(100);
  assert.equal(fired, 1);
});

test("インターバルと入力待ちを独立して進め、遅い期限で発火する", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const scheduler = new AdviceScheduler();
  t.after(() => scheduler.dispose());
  const events: AutoAdviceTriggerEvent[] = [];
  scheduler.onDidTriggerAdvice((event) => events.push(event));
  scheduler.configure(
    { idleDelayMs: 100, requestIntervalMs: 1000 },
    { mode: "always", connectionState: "connected", requestState: "idle" }
  );

  scheduler.handleActivity("text_edit");
  t.mock.timers.tick(100);
  assert.equal(events.length, 1);

  scheduler.handleActivity("text_edit");
  scheduler.setComposerActive(true);
  t.mock.timers.tick(600);
  assert.equal(scheduler.getState().cooldownRemainingMs, 400, "入力中もインターバルは進む");

  scheduler.setComposerActive(false);
  const resumed = scheduler.getState();
  assert.equal(resumed.idleRemainingMs, 100);
  assert.equal(resumed.cooldownRemainingMs, 400);
  assert.deepEqual(getAutoAdviceWaitStatus(resumed), { kind: "cooldown", remainingMs: 400 });

  t.mock.timers.tick(399);
  assert.equal(events.length, 1);
  t.mock.timers.tick(1);
  assert.equal(events.length, 2);
});

test("自動助言の表示は実際に発火を止める遅い待ち時間を優先する", () => {
  assert.deepEqual(
    getAutoAdviceWaitStatus({ waitingForIdle: true, idleRemainingMs: 10000, cooldownRemainingMs: 45000 }),
    { kind: "cooldown", remainingMs: 45000 }
  );
  assert.deepEqual(
    getAutoAdviceWaitStatus({ waitingForIdle: true, idleRemainingMs: 10000, cooldownRemainingMs: 3000 }),
    { kind: "idle", remainingMs: 10000 }
  );
});

function editorFor(text: string, line: number, column: number): vscode.TextEditor {
  const lines = text.split("\n");
  const offsetAt = (p: Position) => lines.slice(0, p.line).reduce((n, s) => n + s.length + 1, 0) + p.character;
  const point = new Position(line, column);
  return {
    document: { uri: { scheme: "file", fsPath: "/repo/app.ts", toString: () => "file:///repo/app.ts" },
      version: 1, lineCount: lines.length, languageId: "typescript", offsetAt,
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range?: Range) => range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text },
    selection: { isEmpty: true, active: point, anchor: point, start: point, end: point }
  } as unknown as vscode.TextEditor;
}

test("カーソル位置・差分・診断増減を取得し、マーカー衝突と巨大行を制限する", () => {
  const collector = new ContextCollector();
  const point = { line: 0, character: 0 };
  diagnostics = [{ severity: 1, message: "old", range: { start: point, end: point } }] as vscode.Diagnostic[];
  windowMock.activeTextEditor = editorFor("return value", 0, 7);
  collector.primeDocument(windowMock.activeTextEditor.document);
  diagnostics = [{ severity: 0, message: "new", range: { start: point, end: point } }] as vscode.Diagnostic[];
  collector.captureDocumentChange({ document: windowMock.activeTextEditor.document, contentChanges: [
    { range: { start: { line: 0, character: 7 }, end: { line: 0, character: 12 } }, rangeOffset: 7, rangeLength: 5, text: "items.\n" }
  ] } as unknown as vscode.TextDocumentChangeEvent);
  windowMock.activeTextEditor = editorFor("return items.\n", 1, 0);
  const event = { signals: [{ reason: "text_edit" as const, occurredAt: 10 }], idleDurationMs: 10000 };
  const result = collector.collectAutomaticObservation(event)!;
  assert.deepEqual(result.cursor, { line: 2, column: 1 });
  assert.equal(result.lastEdit?.beforePreview, "value");
  assert.equal(result.lastEdit?.cursorDistanceLines, 0);
  assert.equal(result.lastEdit?.changedLineCount, 2);
  assert.equal(result.lastEdit?.deletedCharCount, 5);
  assert.equal(result.diagnostics?.added[0].message, "new");
  assert.equal(result.diagnostics?.resolvedCount, 1);
  collector.resetAutomaticDiagnosticsBaseline();
  assert.equal(collector.collectAutomaticObservation(event)?.diagnostics?.added.length, 0);
  windowMock.activeTextEditor = editorFor("a".repeat(5000) + "<<<NAVICOM_CURSOR>>>" + "b".repeat(5000), 0, 5000);
  const bounded = collector.collectAutomaticObservation(event)!;
  assert.ok(bounded.cursorExcerpt!.length < 2900);
  assert.equal(bounded.cursorExcerpt!.split("<<<NAVICOM_CURSOR>>>").length - 1, 1);
  collector.releaseDocument(windowMock.activeTextEditor.document.uri);
  assert.equal(collector.collectAutomaticObservation(event)?.lastEdit, undefined);
  windowMock.activeTextEditor = undefined;
  assert.equal(collector.collectAutomaticObservation(event), undefined);
});

test("指紋は時間と前回focusに依存せず、カーソル位置の変化を検出する", () => {
  const context = { activeFileExcerpt: "code", referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] };
  const observation = { triggerReasons: ["text_edit" as const], idleDurationMs: 10000, selectionPresent: false, cursor: { line: 1, column: 1 } };
  const first = createAutomaticFingerprint(context, "low", observation);
  assert.equal(first, createAutomaticFingerprint(context, "low", { ...observation, idleDurationMs: 20000, previousFocus: "continue" }));
  assert.notEqual(first, createAutomaticFingerprint(context, "low", { ...observation, cursor: { line: 2, column: 1 } }));
});

test("既存DBにfocus列を追加し、旧履歴と新しいfocusをSQLiteで往復する", async () => {
  const init = require("sql.js");
  const sql = await init();
  const db = new sql.Database();
  const store = new ConversationStore({} as vscode.Uri);
  Object.assign(store, { db, persist: async () => {} });
  const migrate = () => (store as unknown as { migrate(): void }).migrate();
  migrate();
  // Recreate the previous schema shape, then exercise the additive migration.
  db.run("ALTER TABLE conversation_entries DROP COLUMN automatic_focus");
  db.run("INSERT INTO conversation_streams (id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?)",
    ["legacy-stream", "旧履歴", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", 1]);
  db.run("INSERT INTO conversation_entries (id, stream_id, entry_order, role, text, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["legacy-entry", "legacy-stream", 0, "assistant", "移行前の助言", "2026-09-01T00:00:00Z", "always"]);
  migrate();
  migrate();
  const legacy = store.get("legacy-stream")!;
  assert.equal(legacy.entries[0].id, "legacy-entry");
  assert.equal(legacy.entries[0].text, "移行前の助言");
  assert.equal(legacy.entries[0].focus, undefined);
  assert.equal(automaticGuidanceLabel(legacy.entries[0].focus), "NaviCom（自動）");
  const stream = await store.createStream("test");
  const entries = [undefined, "continue", "review", "explain", "overview"] as const;
  await store.saveStream({ ...stream, entries: entries.map((focus, i) => ({
    id: `entry-${i}`, role: "assistant", kind: "always", text: "助言", focus, createdAt: stream.createdAt
  })) });
  const restored = store.get(stream.id)!;
  assert.deepEqual(restored.entries.map((entry) => entry.focus), entries);
  assert.equal(automaticGuidanceLabel(restored.entries[0].focus), "NaviCom（自動）");
  assert.equal(automaticGuidanceLabel(restored.entries[1].focus), "NaviCom（自動・次の一手）");
  store.dispose();
});
