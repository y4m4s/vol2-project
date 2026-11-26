import assert from "node:assert/strict";
import test from "node:test";
import {
  STUCK_HEURISTICS,
  StuckSignalTracker,
  diagnosticKindKey,
  tokenizeQuestion,
  type StuckDiagnosticInput,
  type StuckEditInput,
  type StuckEvent
} from "../src/services/StuckSignalTracker";

const DOC = "file:///workspace/user.ts";
const FOCUSED = { focused: true, debugging: false };
const S = 1000;
const KIND = diagnosticKindKey("ts", "2322", "Type 'string' is not assignable to type 'number'.");

function error(line: number, kindKey = KIND, code = "2322"): StuckDiagnosticInput {
  return { kindKey, code, severity: "error", startLine: line, endLine: line };
}

/** 1行の中での小さな変更（挿入または削除） */
function typing(line: number, inserted: number, deleted: number): StuckEditInput {
  return { startLine: line, endLine: line, insertedLineCount: 0, insertedChars: inserted, deletedChars: deleted };
}

function transitions(events: StuckEvent[]) {
  return events.filter((event): event is Extract<StuckEvent, { type: "transition" }> => event.type === "transition");
}

/** 同じ行で、挿入と削除を交互に繰り返す（正味の変化はほぼない） */
function backAndForth(tracker: StuckSignalTracker, line: number, startAt: number, count: number): void {
  for (let i = 0; i < count; i++) tracker.noteEdit(DOC, [typing(line, i % 2 === 0 ? 3 : 0, i % 2 === 0 ? 0 : 3)], startAt + i * 10 * S);
}

test("S1: 持続・往復・再発がそろうと Struggling になる", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  // 5秒〜55秒に6回の往復（挿入3文字と削除3文字を交互に）。95秒時点では停滞（45秒）に達していない
  backAndForth(tracker, 10, 5 * S, 6);
  const watching = transitions(tracker.evaluate(95 * S, FOCUSED));
  assert.equal(watching.at(-1)?.to, "Watching");
  assert.deepEqual(watching.at(-1)?.groups, ["A", "C"]);
  // 一度消えて、すぐに同じ近くへ再発
  tracker.noteDiagnostics(DOC, [], 100 * S);
  tracker.noteDiagnostics(DOC, [error(11)], 110 * S);
  const struggling = transitions(tracker.evaluate(111 * S, FOCUSED));
  assert.equal(struggling.at(-1)?.to, "Struggling");
  assert.equal(struggling.at(-1)?.kind, "diagnostic");
  assert.equal(struggling.at(-1)?.code, "2322");
});

test("S2: ファイル名の変更などの一括変更の直後は、往復に数えない", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  tracker.noteBulkChange(0);
  backAndForth(tracker, 10, 5 * S, 6);
  const events = transitions(tracker.evaluate(95 * S, FOCUSED));
  // A（持続）だけなので Calm のまま（3点に届かない）
  assert.equal(events.length, 0);
});

test("S3: 貼り付け（大きな変更）は、周辺の編集にも往復にも数えない", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  for (let i = 0; i < 5; i++) {
    tracker.noteEdit(DOC, [{ startLine: 10, endLine: 10, insertedLineCount: 40, insertedChars: 2000, deletedChars: 0 }], (5 + i * 10) * S);
  }
  assert.equal(transitions(tracker.evaluate(120 * S, FOCUSED)).length, 0);
});

test("S4: ウィンドウにフォーカスがない・デバッグ中は、停滞を加点しない", () => {
  const withIdle = new StuckSignalTracker();
  withIdle.noteDiagnostics(DOC, [error(10)], 0);
  backAndForth(withIdle, 10, 5 * S, 2);
  // 周辺の編集2回 → A。その後 45 秒以上操作なし
  const focused = transitions(withIdle.evaluate(100 * S, FOCUSED));
  assert.equal(focused.at(-1)?.to, "Watching");
  assert.ok(focused.at(-1)?.groups.includes("E"));
  for (const environment of [{ focused: false, debugging: false }, { focused: true, debugging: true }]) {
    const tracker = new StuckSignalTracker();
    tracker.noteDiagnostics(DOC, [error(10)], 0);
    backAndForth(tracker, 10, 5 * S, 2);
    assert.equal(transitions(tracker.evaluate(100 * S, environment)).length, 0);
  }
});

test("S5: 消えて60秒再出現しなければ Resolved。墓標は消滅から3分で消える", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  tracker.noteDiagnostics(DOC, [], 30 * S);
  assert.equal(tracker.evaluate(80 * S, FOCUSED).some((event) => event.type === "resolved"), false);
  const resolved = tracker.evaluate(91 * S, FOCUSED).find((event) => event.type === "resolved");
  assert.ok(resolved);
  assert.equal(tracker.hasTombstone(DOC, resolved.topicId), true);
  tracker.evaluate(30 * S + STUCK_HEURISTICS.recurrenceWindowMs + 1, FOCUSED);
  assert.equal(tracker.hasTombstone(DOC, resolved.topicId), false);
});

test("S6: 90秒に満たないエラー（書きかけ）は持続とみなさない", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  backAndForth(tracker, 10, 1 * S, 3);
  assert.equal(tracker.snapshot(60 * S)[0].score, 0);
  tracker.evaluate(60 * S, FOCUSED);
  assert.equal(tracker.snapshot(60 * S)[0].score, 0);
});

test("S7: 質問の反復だけ（＋停滞）では群が1つなので Struggling にならない", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  tracker.noteActivity(DOC, 5 * S);
  tracker.noteQuestion(DOC, "この型エラーはどうして出るの？", 10 * S);
  tracker.noteQuestion(DOC, "この型エラーがどうして出るのか知りたい", 20 * S);
  const events = transitions(tracker.evaluate(80 * S, FOCUSED));
  assert.equal(events.at(-1)?.to, "Watching");
  assert.deepEqual(events.at(-1)?.groups, ["D", "E"]);
  assert.equal(transitions(tracker.evaluate(200 * S, FOCUSED)).some((event) => event.to === "Struggling"), false);
});

test("S10: 同じ種類の診断が2か所あっても、片方の解決はその発生だけに作用する", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10), error(40)], 0);
  const [first, second] = tracker.snapshot(0).map((topic) => topic.topicId);
  tracker.noteDiagnostics(DOC, [error(40)], 30 * S);
  const resolved = tracker.evaluate(91 * S, FOCUSED).filter((event) => event.type === "resolved");
  assert.deepEqual(resolved.map((event) => event.topicId), [first]);
  assert.deepEqual(tracker.snapshot(91 * S).map((topic) => topic.topicId), [second]);
});

test("S12: 上に行を挿入して診断の位置がずれても、同じ発生として追随する", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  const [id] = tracker.snapshot(0).map((topic) => topic.topicId);
  tracker.noteEdit(DOC, [{ startLine: 0, endLine: 0, insertedLineCount: 5, insertedChars: 60, deletedChars: 0 }], 5 * S);
  tracker.noteDiagnostics(DOC, [error(15)], 6 * S);
  assert.deepEqual(tracker.snapshot(6 * S).map((topic) => topic.topicId), [id]);
  assert.equal(tracker.snapshot(6 * S)[0].durationMs, 6 * S);
});

test("S13: 診断のない編集の往復だけでは Struggling にならない（r2: 削除比率で二重加点しない）", () => {
  const tracker = new StuckSignalTracker();
  backAndForth(tracker, 20, 0, 8);
  const events = transitions(tracker.evaluate(75 * S, FOCUSED));
  assert.equal(events.some((event) => event.to === "Struggling"), false);
});

test("S19: 消えてから3分以内の再発は、墓標から同じ発生として復元する", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  const [id] = tracker.snapshot(0).map((topic) => topic.topicId);
  tracker.noteDiagnostics(DOC, [], 10 * S);
  tracker.evaluate(71 * S, FOCUSED); // Resolved（墓標へ）
  const events = tracker.noteDiagnostics(DOC, [error(11)], 130 * S);
  assert.deepEqual(events.map((event) => event.type === "reopened" && event.topicId), [id]);
  assert.equal(tracker.snapshot(130 * S)[0].topicId, id);
  assert.ok(tracker.snapshot(130 * S)[0].score >= 1.9);
});

test("S20: 消えてから3分を過ぎた再出現は、新しい発生になる", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  const [id] = tracker.snapshot(0).map((topic) => topic.topicId);
  tracker.noteDiagnostics(DOC, [], 10 * S);
  tracker.evaluate(71 * S, FOCUSED);
  tracker.evaluate(200 * S, FOCUSED);
  const events = tracker.noteDiagnostics(DOC, [error(10)], 250 * S);
  assert.equal(events.length, 0);
  assert.notEqual(tracker.snapshot(250 * S)[0].topicId, id);
  assert.equal(tracker.snapshot(250 * S)[0].score, 0);
});

test("診断が上限を超えても、追跡中の発生は入れ替えない（同じ一覧を繰り返し受け取っても ID と持続時間を保つ）", () => {
  const tracker = new StuckSignalTracker();
  const limit = STUCK_HEURISTICS.maxOccurrencesPerDocument;
  const many = Array.from({ length: 50 }, (_, i) => error(i * 10, diagnosticKindKey("ts", String(1000 + i), `kind ${i}`), String(1000 + i)));
  tracker.noteDiagnostics(DOC, many, 0);
  const first = tracker.snapshot(0).map((item) => item.topicId);
  assert.equal(first.length, limit);
  tracker.noteDiagnostics(DOC, many, 30 * S);
  tracker.noteDiagnostics(DOC, many, 60 * S);
  const later = tracker.snapshot(60 * S);
  assert.deepEqual(later.map((item) => item.topicId), first);
  assert.ok(later.every((item) => item.durationMs === 60 * S));
  // 追跡中のものが解決して枠が空けば、残りの診断を受け入れる
  const remaining = many.slice(5);
  tracker.noteDiagnostics(DOC, remaining, 70 * S);
  tracker.evaluate(131 * S, FOCUSED);
  tracker.noteDiagnostics(DOC, remaining, 132 * S);
  const refilled = tracker.snapshot(132 * S);
  assert.equal(refilled.length, limit);
  assert.equal(refilled.filter((item) => !first.includes(item.topicId)).length, 5);
});

test("周辺の編集は持続の判定に必要な回数だけ数え、長く編集しても溜まらない", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  for (let i = 0; i < 50_000; i++) tracker.noteEdit(DOC, [typing(10, 1, 0)], i);
  type Internals = { documents: Map<string, { occurrences: Map<string, { nearbyEdits: number }> }> };
  const occurrence = [...(tracker as unknown as Internals).documents.get(DOC)!.occurrences.values()][0];
  assert.equal(occurrence.nearbyEdits, STUCK_HEURISTICS.persistentMinEditsNearby);
  // 持続（A）は従来どおり成立する
  tracker.evaluate(95 * S, FOCUSED);
  assert.ok(tracker.snapshot(95 * S)[0].score >= STUCK_HEURISTICS.persistentPoints - 0.5);
});

test("警告・情報の診断は追跡しない（エラーだけ）", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [{ ...error(10), severity: "warning" }], 0);
  assert.equal(tracker.snapshot(0).length, 0);
});

test("次の期限: 追跡するものがなければタイマーを張らない。あれば最も早い期限", () => {
  const tracker = new StuckSignalTracker();
  assert.equal(tracker.nextDeadline(0), undefined);
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  assert.equal(tracker.nextDeadline(0), STUCK_HEURISTICS.persistentAfterMs);
  tracker.noteDiagnostics(DOC, [], 10 * S);
  assert.equal(tracker.nextDeadline(10 * S), 10 * S + STUCK_HEURISTICS.resolveAfterMs);
});

test("スコアは時間で減衰し、状態はヒステリシス付きで戻る", () => {
  const tracker = new StuckSignalTracker();
  tracker.noteDiagnostics(DOC, [error(10)], 0);
  backAndForth(tracker, 10, 5 * S, 6);
  assert.equal(transitions(tracker.evaluate(95 * S, FOCUSED)).at(-1)?.to, "Watching");
  // 往復の窓（2分）が過ぎ、A も半減期を重ねると Calm に戻る
  const later = transitions(tracker.evaluate(95 * S + 20 * 60 * S, { focused: false, debugging: false }));
  assert.equal(later.at(-1)?.to, "Calm");
});

test("診断の種類キーは位置・引用部・数値を含めず、メッセージ本文も残さない", () => {
  const a = diagnosticKindKey("ts", "2322", "Type 'string' is not assignable to type 'number'.");
  const b = diagnosticKindKey("ts", "2322", "Type 'boolean' is not assignable to type 'Date'.");
  assert.equal(a, b);
  assert.doesNotMatch(a, /assignable/);
  assert.notEqual(a, diagnosticKindKey("ts", "2345", "Type 'string' is not assignable to type 'number'."));
});

test("質問のトークンは日本語を2文字ずつに分け、上限で切る", () => {
  const tokens = tokenizeQuestion("Promiseの扱い");
  assert.ok(tokens.has("promise"));
  assert.ok(tokens.has("扱い"));
  assert.ok(tokenizeQuestion("あ".repeat(500) + "い".repeat(500)).size <= STUCK_HEURISTICS.questionMaxTokens);
});

test("処理量: 編集・診断の更新は軽い（1万回の通知と評価）", () => {
  const tracker = new StuckSignalTracker();
  const diagnostics = Array.from({ length: 20 }, (_, index) => error(index * 5));
  const startedAt = performance.now();
  for (let i = 0; i < 10_000; i++) {
    tracker.noteEdit(DOC, [typing(i % 100, 1, 0)], i * 50);
    if (i % 10 === 0) tracker.noteDiagnostics(DOC, diagnostics, i * 50);
    if (i % 100 === 0) tracker.evaluate(i * 50, FOCUSED);
  }
  const perEventMs = (performance.now() - startedAt) / 10_000;
  assert.ok(perEventMs < 1, `per event ${perEventMs.toFixed(3)}ms`);
});
