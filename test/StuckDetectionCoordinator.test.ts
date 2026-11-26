import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";

const diagnosticsByUri = new Map<string, unknown[]>();
const textDocuments: unknown[] = [];
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const original = loader._load;
loader._load = (id, parent, main) => id === "vscode" ? {
  window: { state: { focused: true }, onDidChangeWindowState: () => ({ dispose() {} }), activeTextEditor: undefined },
  workspace: { textDocuments, getWorkspaceFolder: (uri: { fsPath: string }) => uri.fsPath.startsWith("/workspace/") ? { name: "workspace" } : undefined },
  languages: { getDiagnostics: (uri: { toString(): string }) => diagnosticsByUri.get(uri.toString()) ?? [] },
  debug: { activeDebugSession: undefined },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }
} : original(id, parent, main);
const { StuckDetectionCoordinator } = require("../src/application/coordinators/StuckDetectionCoordinator") as typeof import("../src/application/coordinators/StuckDetectionCoordinator");
loader._load = original;

const S = 1000;

function documentAt(fsPath: string): vscode.TextDocument {
  const key = `file://${fsPath}`;
  return { uri: { scheme: "file", fsPath, toString: () => key }, languageId: "typescript" } as unknown as vscode.TextDocument;
}

function typeError(line: number): unknown {
  return {
    source: "ts", code: 2322, severity: 0,
    message: "Type 'string' is not assignable to type 'number'. secret-token-in-message",
    range: { start: { line, character: 0 }, end: { line, character: 5 } }
  };
}

function edit(document: vscode.TextDocument, line: number, inserting: boolean): vscode.TextDocumentChangeEvent {
  return {
    document,
    contentChanges: [{ range: { start: { line, character: 0 }, end: { line, character: inserting ? 0 : 3 } }, rangeLength: inserting ? 0 : 3, text: inserting ? "abc" : "" }]
  } as unknown as vscode.TextDocumentChangeEvent;
}

function setup(options: { enabled?: boolean; excluded?: boolean } = {}) {
  let excluded = options.excluded ?? false;
  const logs: Record<string, unknown>[] = [];
  let now = 0;
  const document = documentAt("/workspace/src/user.ts");
  textDocuments.length = 0;
  textDocuments.push(document);
  diagnosticsByUri.clear();
  let enabled = options.enabled ?? true;
  const coordinator = new StuckDetectionCoordinator({
    isEnabled: () => enabled,
    isExcluded: () => excluded,
    log: (entry) => logs.push(entry)
  }, () => now);
  return {
    logs, document, coordinator,
    at: (ms: number) => { now = ms; },
    setExcluded: (value: boolean) => { excluded = value; },
    setEnabled: (value: boolean) => { enabled = value; coordinator.refresh(); }
  };
}

/** 同じエラーが続き、周辺で書いては消すを繰り返し、一度消えてすぐ再発する */
function struggle(env: ReturnType<typeof setup>): void {
  const { coordinator, document, at } = env;
  diagnosticsByUri.set(document.uri.toString(), [typeError(10)]);
  at(0); coordinator.noteDiagnostics([document.uri]);
  for (let i = 0; i < 6; i++) { at((5 + i * 10) * S); coordinator.noteTextChange(edit(document, 10, i % 2 === 0)); }
  at(95 * S); coordinator.noteDiagnostics([document.uri]);
  diagnosticsByUri.set(document.uri.toString(), []);
  at(100 * S); coordinator.noteDiagnostics([document.uri]);
  diagnosticsByUri.set(document.uri.toString(), [typeError(11)]);
  at(110 * S); coordinator.noteDiagnostics([document.uri]);
}

test("つまずきの遷移を NaviCom Diagnostics に記録する。コード・メッセージ・パスは含めない", () => {
  const env = setup();
  struggle(env);
  env.coordinator.dispose();
  const assessments = env.logs.filter((entry) => entry.event === "stuck_assessment");
  assert.deepEqual(assessments.map((entry) => entry.to), ["Watching", "Struggling"]);
  assert.equal(assessments[1].topic, "diagnostic");
  assert.equal(assessments[1].code, "2322");
  assert.equal(assessments[1].language, "typescript");
  const serialized = JSON.stringify(env.logs);
  assert.doesNotMatch(serialized, /secret-token-in-message|assignable|\/workspace\/src\/user\.ts/);
});

test("つまずきの記録がオフなら、追跡も記録もしない。オフにした時点で状態を捨てる", () => {
  const off = setup({ enabled: false });
  struggle(off);
  off.coordinator.dispose();
  assert.equal(off.logs.length, 0);

  const toggled = setup();
  diagnosticsByUri.set(toggled.document.uri.toString(), [typeError(10)]);
  toggled.coordinator.noteDiagnostics([toggled.document.uri]);
  toggled.setEnabled(false);
  assert.deepEqual(toggled.logs, [{ event: "stuck_detection_toggled", enabled: false }]);
  toggled.coordinator.dispose();
});

test("除外ファイルとワークスペース外のファイルは追跡しない", () => {
  const excluded = setup({ excluded: true });
  struggle(excluded);
  excluded.coordinator.dispose();
  assert.equal(excluded.logs.length, 0);

  const outside = setup();
  const document = documentAt("/tmp/scratch.ts");
  textDocuments.push(document);
  diagnosticsByUri.set(document.uri.toString(), [typeError(1)]);
  outside.coordinator.noteDiagnostics([document.uri]);
  outside.coordinator.noteTextChange(edit(document, 1, true));
  outside.coordinator.dispose();
  assert.equal(outside.logs.length, 0);
});

test("開いていない文書の診断（ワークスペース全体の再解析）は読まない", () => {
  const env = setup();
  let reads = 0;
  const closed = { scheme: "file", fsPath: "/workspace/other.ts", toString: () => "file:///workspace/other.ts" } as unknown as vscode.Uri;
  diagnosticsByUri.set(closed.toString(), new Proxy([], { get: (target, property) => { reads++; return Reflect.get(target, property); } }));
  env.coordinator.noteDiagnostics([closed]);
  env.coordinator.dispose();
  assert.equal(reads, 0);
});

test("追跡を始めた後に除外したファイルは、タイマーからの評価でも記録せず、設定の保存で状態を捨てる", () => {
  const { coordinator, document, at, logs, setExcluded } = setup();
  diagnosticsByUri.set(document.uri.toString(), [typeError(10)]);
  at(0); coordinator.noteDiagnostics([document.uri]);
  for (let i = 0; i < 6; i++) { at((5 + i * 10) * S); coordinator.noteTextChange(edit(document, 10, i % 2 === 0)); }
  setExcluded(true);
  // 操作しないまま、持続の期限を過ぎてから評価する（タイマー・フォーカスの変化と同じ経路）
  at(95 * S);
  (coordinator as unknown as { evaluate(): void }).evaluate();
  assert.equal(logs.filter((entry) => entry.event === "stuck_assessment").length, 0);
  // 除外を戻しても、捨てた状態からは再開しない
  setExcluded(false);
  at(96 * S);
  (coordinator as unknown as { evaluate(): void }).evaluate();
  assert.equal(logs.filter((entry) => entry.event === "stuck_assessment").length, 0);
  coordinator.dispose();
});

test("設定の保存（refresh）で、除外した文書の追跡をやめる", () => {
  const { coordinator, document, at, logs, setExcluded } = setup();
  diagnosticsByUri.set(document.uri.toString(), [typeError(10)]);
  at(0); coordinator.noteDiagnostics([document.uri]);
  for (let i = 0; i < 6; i++) { at((5 + i * 10) * S); coordinator.noteTextChange(edit(document, 10, i % 2 === 0)); }
  setExcluded(true);
  coordinator.refresh();
  const tracker = (coordinator as unknown as { tracker: { snapshot(now: number): unknown[]; nextDeadline(now: number): number | undefined } }).tracker;
  assert.equal(tracker.snapshot(60 * S).length, 0);
  assert.equal(tracker.nextDeadline(60 * S), undefined);
  assert.equal(logs.length, 0);
  coordinator.dispose();
});
