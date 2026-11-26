/**
 * つまずきの兆候を、論題（診断の発生・編集の領域）ごとに追跡する純粋ロジック（Phase 3a）。
 *
 * - vscode に依存せず、時刻は呼び出し側から渡す（テストで時計を注入できる）
 * - コード本文・診断メッセージは保持しない。保持するのは行番号・件数・時刻と、診断の「種類」を表すキーだけ
 * - Phase 3a はシャドーモード: 判定結果（状態の遷移）を返すだけで、表示や介入はしない
 *
 * 設計: docs/learning-support-design.md §4（r3）、仕様: docs/19-stuck-detection-shadow-mode.md
 * 数値はすべて検証用の仮設定（STUCK_HEURISTICS）。シャドーモードの記録で校正する。
 */

export const STUCK_HEURISTICS = {
  /** A: 同じ発生がこの時間以上続き、その間に周辺で編集が minEditsNearby 回以上あれば持続とみなす（H-1） */
  persistentAfterMs: 90_000,
  persistentMinEditsNearby: 2,
  persistentPoints: 2,
  /** 「周辺の編集」とみなす行の幅（診断の範囲の前後） */
  nearbyLines: 5,
  /** B: 再発1回あたりの点（H-2）。再発の時間窓は消滅した時刻から数える */
  recurrencePoints: 2,
  recurrenceWindowMs: 180_000,
  /** A と B は「同じ診断が直らない」という1つの事実なので、上限を共有する */
  diagnosticGroupCap: 4,
  /** 発生の対応付けの許容距離（H-14） */
  matchDistanceLines: 3,
  /** 対応先のない発生を Resolved にするまでの期間（H-15） */
  resolveAfterMs: 60_000,
  /** C: 編集の往復（H-3・H-4） */
  churnWindowMs: 120_000,
  churnMinEdits: 4,
  churnMaxNetRatio: 0.2,
  churnMinAlternations: 2,
  churnHighAlternations: 4,
  churnBucketLines: 10,
  /** D: 質問の反復（H-5） */
  questionWindowMs: 600_000,
  questionSimilarity: 0.5,
  questionPoints: 2,
  questionMaxTokens: 40,
  /** E: エラーがある状態での停滞（H-6）。群の数には数えない */
  idleAfterMs: 45_000,
  idlePoints: 1,
  /** 状態の閾値（H-7・H-8・H-9）とヒステリシス */
  possibleScore: 3,
  likelyScore: 5,
  likelyMinGroups: 2,
  hysteresis: 1,
  /** スコアの半減期（H-10） */
  halfLifeMs: 300_000,
  /** 貼り付け・生成とみなす1回の変更（チャーン・周辺編集に数えない） */
  pasteChars: 500,
  pasteLines: 30,
  /** ファイル名の変更・複数ファイルの一括変更の後、チャーンを数えない期間 */
  bulkChangePauseMs: 60_000,
  /** 文書あたりに追跡する発生・墓標の上限 */
  maxOccurrencesPerDocument: 20,
  maxTombstonesPerDocument: 20,
  /** 状態が Calm 以外の論題があるときの再評価の間隔（減衰による状態の変化を拾う） */
  reevaluateIntervalMs: 60_000
} as const;

export type StuckState = "Calm" | "Watching" | "Struggling";
/** A: 診断の持続、B: 診断の再発、C: 編集の往復、D: 質問の反復、E: 停滞（加点のみ・群に数えない） */
export type StuckEvidenceGroup = "A" | "B" | "C" | "D" | "E";

export interface StuckDiagnosticInput {
  /** 診断の種類（source・code・メッセージの形から作ったキー）。位置は含めない */
  kindKey: string;
  code?: string;
  severity: "error" | "warning" | "info";
  startLine: number;
  endLine: number;
}

export interface StuckEditInput {
  /** 変更前の範囲（0始まり） */
  startLine: number;
  endLine: number;
  /** 挿入したテキストの行数（改行の数） */
  insertedLineCount: number;
  insertedChars: number;
  deletedChars: number;
}

export interface StuckEnvironment {
  /** VS Code のウィンドウにフォーカスがあるか */
  focused: boolean;
  /** デバッグ中か */
  debugging: boolean;
}

export interface StuckTopicSnapshot {
  documentKey: string;
  topicId: string;
  kind: "diagnostic" | "region";
  state: StuckState;
  score: number;
  groups: StuckEvidenceGroup[];
  code?: string;
  /** 論題が始まってからの時間 */
  durationMs: number;
  /** 現在の追随後の範囲（0始まり）。介入の文脈確認に使う */
  lineStart?: number;
  lineEnd?: number;
}

export type StuckEvent =
  | ({ type: "transition"; from: StuckState; to: StuckState } & StuckTopicSnapshot)
  | { type: "resolved"; documentKey: string; topicId: string; code?: string; durationMs: number; lastState: StuckState }
  | { type: "reopened"; documentKey: string; topicId: string; code?: string };

interface ScoreEvent {
  group: "A" | "B";
  points: number;
  at: number;
}

interface Occurrence {
  id: string;
  kindKey: string;
  code?: string;
  severity: StuckDiagnosticInput["severity"];
  startLine: number;
  endLine: number;
  firstSeenAt: number;
  /** 対応先がなくなった時刻（消滅候補） */
  missingSince?: number;
  /** 持続（A）の判定に使う周辺編集の回数。必要回数で数えるのをやめる */
  nearbyEdits: number;
  persistentAwarded: boolean;
  events: ScoreEvent[];
  state: StuckState;
}

interface Tombstone {
  occurrence: Occurrence;
  missingSince: number;
}

interface ChurnEdit {
  at: number;
  inserted: number;
  deleted: number;
}

interface DocumentState {
  occurrences: Map<string, Occurrence>;
  tombstones: Tombstone[];
  /** 10行単位の領域ごとの編集 */
  churn: Map<number, ChurnEdit[]>;
  regionStates: Map<number, { state: StuckState; since: number }>;
  questions: { at: number; tokens: Set<string> }[];
}

export class StuckSignalTracker {
  private readonly documents = new Map<string, DocumentState>();
  private readonly assessments = new Map<string, StuckTopicSnapshot>();
  private nextId = 1;
  private lastActivityAt?: number;
  private lastActivityDocument?: string;
  private bulkChangeUntil = 0;

  public constructor(private readonly heuristics: typeof STUCK_HEURISTICS = STUCK_HEURISTICS) {}

  /** 編集。変更は VS Code の contentChanges と同じく、変更前の文書の座標で渡す。 */
  public noteEdit(documentKey: string, edits: readonly StuckEditInput[], now: number): void {
    const doc = this.document(documentKey);
    this.noteActivity(documentKey, now);
    // 下から順に適用すると、上の変更による行のずれが下の変更の座標に影響しない。
    for (const edit of [...edits].sort((a, b) => b.startLine - a.startLine)) {
      const paste = edit.insertedChars > this.heuristics.pasteChars || edit.insertedLineCount > this.heuristics.pasteLines;
      const delta = edit.insertedLineCount - (edit.endLine - edit.startLine);
      for (const occurrence of doc.occurrences.values()) {
        const nearStart = occurrence.startLine - this.heuristics.nearbyLines;
        const nearEnd = occurrence.endLine + this.heuristics.nearbyLines;
        if (!paste && !occurrence.persistentAwarded && occurrence.nearbyEdits < this.heuristics.persistentMinEditsNearby &&
          edit.endLine >= nearStart && edit.startLine <= nearEnd) occurrence.nearbyEdits++;
        if (occurrence.startLine > edit.endLine) {
          occurrence.startLine = Math.max(0, occurrence.startLine + delta);
          occurrence.endLine = Math.max(occurrence.startLine, occurrence.endLine + delta);
        } else if (occurrence.endLine >= edit.startLine && delta !== 0) {
          occurrence.endLine = Math.max(occurrence.startLine, occurrence.endLine + delta);
        }
      }
      for (const tombstone of doc.tombstones) {
        if (tombstone.occurrence.startLine > edit.endLine) {
          tombstone.occurrence.startLine = Math.max(0, tombstone.occurrence.startLine + delta);
          tombstone.occurrence.endLine = Math.max(tombstone.occurrence.startLine, tombstone.occurrence.endLine + delta);
        }
      }
      if (paste || now < this.bulkChangeUntil) continue;
      const bucket = Math.floor(edit.startLine / this.heuristics.churnBucketLines);
      const list = doc.churn.get(bucket) ?? [];
      list.push({ at: now, inserted: edit.insertedChars, deleted: edit.deletedChars });
      doc.churn.set(bucket, list);
    }
  }

  /** 選択・カーソル移動などの操作（停滞の判定に使う）。 */
  public noteActivity(documentKey: string, now: number): void {
    this.lastActivityAt = now;
    this.lastActivityDocument = documentKey;
  }

  /** ファイル名の変更など、複数ファイルにまたがる変更。しばらくチャーンを数えない（リファクタリング）。 */
  public noteBulkChange(now: number): void {
    this.bulkChangeUntil = now + this.heuristics.bulkChangePauseMs;
  }

  /** 手動相談の質問。保持するのは正規化したトークンの集合だけ（最大40、10分）。 */
  public noteQuestion(documentKey: string, text: string, now: number): void {
    const tokens = tokenizeQuestion(text, this.heuristics.questionMaxTokens);
    if (!tokens.size) return;
    const doc = this.document(documentKey);
    doc.questions.push({ at: now, tokens });
    doc.questions = doc.questions.filter((item) => now - item.at <= this.heuristics.questionWindowMs).slice(-5);
  }

  /** 文書の診断の一覧（その時点のすべて）。既存の発生へ対応付け、再発・消滅を判定する。 */
  public noteDiagnostics(documentKey: string, diagnostics: readonly StuckDiagnosticInput[], now: number): StuckEvent[] {
    const doc = this.document(documentKey);
    const events: StuckEvent[] = [];
    const incoming = diagnostics.filter((item) => item.severity === "error");
    const candidates: { index: number; occurrence: Occurrence; tombstone?: Tombstone; distance: number }[] = [];
    incoming.forEach((diagnostic, index) => {
      for (const occurrence of doc.occurrences.values()) {
        if (occurrence.kindKey !== diagnostic.kindKey) continue;
        const distance = Math.abs(occurrence.startLine - diagnostic.startLine);
        if (distance <= this.heuristics.matchDistanceLines) candidates.push({ index, occurrence, distance });
      }
      for (const tombstone of doc.tombstones) {
        if (tombstone.occurrence.kindKey !== diagnostic.kindKey) continue;
        const distance = Math.abs(tombstone.occurrence.startLine - diagnostic.startLine);
        if (distance <= this.heuristics.matchDistanceLines) candidates.push({ index, occurrence: tombstone.occurrence, tombstone, distance });
      }
    });
    // 1対1の対応付け（距離の近い順。同じ距離なら追跡中の発生を墓標より優先）
    candidates.sort((a, b) => a.distance - b.distance || Number(Boolean(a.tombstone)) - Number(Boolean(b.tombstone)));
    const matchedDiagnostics = new Set<number>();
    const matchedOccurrences = new Set<string>();
    for (const candidate of candidates) {
      if (matchedDiagnostics.has(candidate.index) || matchedOccurrences.has(candidate.occurrence.id)) continue;
      matchedDiagnostics.add(candidate.index);
      matchedOccurrences.add(candidate.occurrence.id);
      const diagnostic = incoming[candidate.index];
      const occurrence = candidate.occurrence;
      occurrence.startLine = diagnostic.startLine;
      occurrence.endLine = diagnostic.endLine;
      if (candidate.tombstone) {
        // 墓標から復元（消滅から3分以内の再発）。スコアと記録を引き継ぎ、Watching から再開する。
        doc.tombstones = doc.tombstones.filter((item) => item !== candidate.tombstone);
        occurrence.missingSince = undefined;
        occurrence.events.push({ group: "B", points: this.heuristics.recurrencePoints, at: now });
        occurrence.state = "Calm";
        doc.occurrences.set(occurrence.id, occurrence);
        events.push({ type: "reopened", documentKey, topicId: occurrence.id, code: occurrence.code });
      } else if (occurrence.missingSince !== undefined) {
        // 消滅候補の間の再発
        occurrence.missingSince = undefined;
        occurrence.events.push({ group: "B", points: this.heuristics.recurrencePoints, at: now });
      }
    }
    const created = new Set<string>();
    incoming.forEach((diagnostic, index) => {
      if (matchedDiagnostics.has(index)) return;
      // 追跡中の発生は入れ替えない。新しい発生は空き枠の範囲でだけ受け入れる（上限を超えた分は追跡しない）。
      if (doc.occurrences.size >= this.heuristics.maxOccurrencesPerDocument) return;
      const occurrence: Occurrence = {
        id: `occ-${this.nextId++}`,
        kindKey: diagnostic.kindKey,
        code: diagnostic.code,
        severity: diagnostic.severity,
        startLine: diagnostic.startLine,
        endLine: diagnostic.endLine,
        firstSeenAt: now,
        nearbyEdits: 0,
        persistentAwarded: false,
        events: [],
        state: "Calm"
      };
      doc.occurrences.set(occurrence.id, occurrence);
      created.add(occurrence.id);
    });
    for (const occurrence of doc.occurrences.values()) {
      if (!matchedOccurrences.has(occurrence.id) && !created.has(occurrence.id) && occurrence.missingSince === undefined) {
        occurrence.missingSince = now;
      }
    }
    this.trimOccurrences(doc);
    return events;
  }

  public releaseDocument(documentKey: string): void {
    this.documents.delete(documentKey);
    for (const [key, topic] of this.assessments) if (topic.documentKey === documentKey) this.assessments.delete(key);
    if (this.lastActivityDocument === documentKey) this.lastActivityDocument = undefined;
  }

  public clear(): void {
    this.documents.clear();
    this.assessments.clear();
    this.lastActivityAt = undefined;
    this.lastActivityDocument = undefined;
  }

  /**
   * 時間の経過を反映して状態を評価し、変化（遷移・解決）を返す。
   * 呼び出し側は、イベントのたびと nextDeadline() の時刻に呼ぶ。
   */
  public evaluate(now: number, environment: StuckEnvironment): StuckEvent[] {
    const events: StuckEvent[] = [];
    this.assessments.clear();
    for (const [documentKey, doc] of this.documents) {
      this.pruneChurn(doc, now);
      doc.questions = doc.questions.filter((item) => now - item.at <= this.heuristics.questionWindowMs);
      const churnPoints = (startLine: number, endLine: number): number => this.churnPointsFor(doc, startLine, endLine);
      const questionPoints = this.questionPoints(doc);
      const idle = this.isIdle(documentKey, now, environment);

      for (const occurrence of [...doc.occurrences.values()]) {
        if (occurrence.missingSince !== undefined && now - occurrence.missingSince >= this.heuristics.resolveAfterMs) {
          doc.occurrences.delete(occurrence.id);
          doc.tombstones.push({ occurrence, missingSince: occurrence.missingSince });
          events.push({ type: "resolved", documentKey, topicId: occurrence.id, code: occurrence.code,
            durationMs: occurrence.missingSince - occurrence.firstSeenAt, lastState: occurrence.state });
          occurrence.state = "Calm";
          continue;
        }
        if (occurrence.missingSince !== undefined) continue;
        if (!occurrence.persistentAwarded && now - occurrence.firstSeenAt >= this.heuristics.persistentAfterMs &&
          occurrence.nearbyEdits >= this.heuristics.persistentMinEditsNearby) {
          occurrence.persistentAwarded = true;
          occurrence.events.push({ group: "A", points: this.heuristics.persistentPoints, at: now });
        }
        const diagnosticPoints = Math.min(this.heuristics.diagnosticGroupCap,
          occurrence.events.reduce((sum, event) => sum + this.decay(event.points, now - event.at), 0));
        const churn = churnPoints(occurrence.startLine - this.heuristics.nearbyLines, occurrence.endLine + this.heuristics.nearbyLines);
        const contributions: [StuckEvidenceGroup, number][] = [
          ["A", diagnosticPoints],
          ["C", churn],
          ["D", questionPoints],
          ["E", idle ? this.heuristics.idlePoints : 0]
        ];
        const groups = this.groupsOf(contributions, occurrence);
        const score = contributions.reduce((sum, [, points]) => sum + points, 0);
        const next = this.nextState(occurrence.state, score, groups.filter((group) => group !== "E").length);
        this.assessments.set(JSON.stringify([documentKey, occurrence.id]), {
          documentKey, topicId: occurrence.id, kind: "diagnostic", state: next, score: round(score), groups,
          code: occurrence.code, durationMs: now - occurrence.firstSeenAt,
          lineStart: occurrence.startLine, lineEnd: occurrence.endLine
        });
        if (next !== occurrence.state) {
          events.push({ type: "transition", from: occurrence.state, to: next, documentKey, topicId: occurrence.id, kind: "diagnostic",
            state: next, score: round(score), groups, code: occurrence.code, durationMs: now - occurrence.firstSeenAt });
          occurrence.state = next;
        }
      }
      doc.tombstones = doc.tombstones.filter((tombstone) => now - tombstone.missingSince < this.heuristics.recurrenceWindowMs);

      // 診断を伴わない編集の往復（領域の論題）。群は C と D しかないので、両方そろわないと Struggling にならない。
      for (const bucket of new Set([...doc.churn.keys(), ...doc.regionStates.keys()])) {
        const start = bucket * this.heuristics.churnBucketLines;
        const churn = this.churnPointsFor(doc, start, start + this.heuristics.churnBucketLines - 1);
        const overlapsDiagnostic = [...doc.occurrences.values()].some((occurrence) =>
          occurrence.missingSince === undefined && occurrence.endLine + this.heuristics.nearbyLines >= start &&
          occurrence.startLine - this.heuristics.nearbyLines <= start + this.heuristics.churnBucketLines - 1);
        const current = doc.regionStates.get(bucket) ?? { state: "Calm" as StuckState, since: now };
        const contributions: [StuckEvidenceGroup, number][] = overlapsDiagnostic ? [] : [["C", churn], ["D", churn > 0 ? questionPoints : 0]];
        const score = contributions.reduce((sum, [, points]) => sum + points, 0);
        const groups = contributions.filter(([, points]) => points >= 1).map(([group]) => group);
        const next = this.nextState(current.state, score, groups.length);
        this.assessments.set(JSON.stringify([documentKey, `region-${bucket}`]), {
          documentKey, topicId: `region-${bucket}`, kind: "region", state: next, score: round(score), groups,
          durationMs: now - current.since, lineStart: start, lineEnd: start + this.heuristics.churnBucketLines - 1
        });
        if (next !== current.state) {
          events.push({ type: "transition", from: current.state, to: next, documentKey, topicId: `region-${bucket}`, kind: "region",
            state: next, score: round(score), groups, durationMs: now - current.since });
        }
        if (next === "Calm" && !doc.churn.has(bucket)) doc.regionStates.delete(bucket);
        else doc.regionStates.set(bucket, { state: next, since: next === "Calm" ? now : current.since });
      }
    }
    return events;
  }

  /**
   * 次に evaluate() を呼ぶべき時刻。追跡するものがなければ undefined（タイマーを張らない）。
   * ポーリングではなく、持続・解決・墓標の期限・停滞・チャーンの窓の終わりのうち最も早い時刻にする。
   */
  public nextDeadline(now: number): number | undefined {
    const deadlines: number[] = [];
    let active = false;
    for (const [documentKey, doc] of this.documents) {
      for (const occurrence of doc.occurrences.values()) {
        if (occurrence.missingSince !== undefined) deadlines.push(occurrence.missingSince + this.heuristics.resolveAfterMs);
        else {
          if (!occurrence.persistentAwarded) deadlines.push(occurrence.firstSeenAt + this.heuristics.persistentAfterMs);
          if (this.lastActivityAt !== undefined && this.lastActivityDocument === documentKey) {
            deadlines.push(this.lastActivityAt + this.heuristics.idleAfterMs);
          }
        }
        if (occurrence.state !== "Calm") active = true;
      }
      for (const tombstone of doc.tombstones) deadlines.push(tombstone.missingSince + this.heuristics.recurrenceWindowMs);
      for (const edits of doc.churn.values()) if (edits.length) deadlines.push(edits[0].at + this.heuristics.churnWindowMs);
      for (const question of doc.questions) deadlines.push(question.at + this.heuristics.questionWindowMs);
      if ([...doc.regionStates.values()].some((item) => item.state !== "Calm")) active = true;
    }
    if (active) deadlines.push(now + this.heuristics.reevaluateIntervalMs);
    const future = deadlines.filter((at) => at > now);
    return future.length ? Math.min(...future) : undefined;
  }

  /** テスト・開発用。追跡中の論題の現在の状態。 */
  public snapshot(now: number): StuckTopicSnapshot[] {
    const result: StuckTopicSnapshot[] = [];
    for (const [documentKey, doc] of this.documents) {
      for (const occurrence of doc.occurrences.values()) {
        const score = Math.min(this.heuristics.diagnosticGroupCap,
          occurrence.events.reduce((sum, event) => sum + this.decay(event.points, now - event.at), 0));
        result.push({ documentKey, topicId: occurrence.id, kind: "diagnostic", state: occurrence.state, score: round(score),
          groups: [], code: occurrence.code, durationMs: now - occurrence.firstSeenAt });
      }
    }
    return result;
  }

  public hasTombstone(documentKey: string, topicId: string): boolean {
    return Boolean(this.documents.get(documentKey)?.tombstones.some((item) => item.occurrence.id === topicId));
  }

  /** 直近の評価結果。介入側はスコアを再計算せず、この値だけを見る。 */
  public getAssessments(): StuckTopicSnapshot[] { return [...this.assessments.values()]; }

  /** 墓標を含む識別子。短い再発で介入済みの記録を失わないために使う。 */
  public getKnownTopicKeys(): string[] {
    const keys: string[] = [];
    for (const [documentKey, doc] of this.documents) {
      for (const occurrence of doc.occurrences.values()) keys.push(JSON.stringify([documentKey, occurrence.id]));
      for (const tombstone of doc.tombstones) keys.push(JSON.stringify([documentKey, tombstone.occurrence.id]));
      for (const bucket of new Set([...doc.regionStates.keys(), ...doc.churn.keys()])) keys.push(JSON.stringify([documentKey, `region-${bucket}`]));
    }
    return keys;
  }

  public idleDuration(now: number): number { return this.lastActivityAt === undefined ? 0 : Math.max(0, now - this.lastActivityAt); }

  private document(documentKey: string): DocumentState {
    let doc = this.documents.get(documentKey);
    if (!doc) {
      doc = { occurrences: new Map(), tombstones: [], churn: new Map(), regionStates: new Map(), questions: [] };
      this.documents.set(documentKey, doc);
    }
    return doc;
  }

  private trimOccurrences(doc: DocumentState): void {
    // 墓標からの復元で上限を超えた場合だけ通る。消滅中の発生を先に、次に新しい発生から外し、続いている発生は残す。
    while (doc.occurrences.size > this.heuristics.maxOccurrencesPerDocument) {
      const victim = [...doc.occurrences.values()].sort((a, b) =>
        Number(b.missingSince !== undefined) - Number(a.missingSince !== undefined) || b.firstSeenAt - a.firstSeenAt)[0];
      doc.occurrences.delete(victim.id);
    }
    if (doc.tombstones.length > this.heuristics.maxTombstonesPerDocument) {
      doc.tombstones = doc.tombstones.slice(-this.heuristics.maxTombstonesPerDocument);
    }
  }

  private pruneChurn(doc: DocumentState, now: number): void {
    for (const [bucket, edits] of doc.churn) {
      const recent = edits.filter((edit) => now - edit.at < this.heuristics.churnWindowMs);
      if (recent.length) doc.churn.set(bucket, recent);
      else doc.churn.delete(bucket);
    }
  }

  /**
   * C: 編集の往復。窓の中の編集が4回以上で、正味の変化が小さく（挿入と削除の差が総量の20%未満）、
   * 挿入が主の変更と削除が主の変更の切り替わりが2回以上。削除比率は独立した信号にしない（r2）。
   */
  private churnPointsFor(doc: DocumentState, startLine: number, endLine: number): number {
    const firstBucket = Math.floor(Math.max(0, startLine) / this.heuristics.churnBucketLines);
    const lastBucket = Math.floor(Math.max(0, endLine) / this.heuristics.churnBucketLines);
    const edits: ChurnEdit[] = [];
    for (let bucket = firstBucket; bucket <= lastBucket; bucket++) edits.push(...(doc.churn.get(bucket) ?? []));
    if (edits.length < this.heuristics.churnMinEdits) return 0;
    edits.sort((a, b) => a.at - b.at);
    const inserted = edits.reduce((sum, edit) => sum + edit.inserted, 0);
    const deleted = edits.reduce((sum, edit) => sum + edit.deleted, 0);
    const total = inserted + deleted;
    if (total === 0 || Math.abs(inserted - deleted) >= this.heuristics.churnMaxNetRatio * total) return 0;
    let alternations = 0;
    let previous: "insert" | "delete" | undefined;
    for (const edit of edits) {
      const kind = edit.inserted >= edit.deleted ? "insert" : "delete";
      if (previous && kind !== previous) alternations++;
      previous = kind;
    }
    if (alternations >= this.heuristics.churnHighAlternations) return 2;
    return alternations >= this.heuristics.churnMinAlternations ? 1 : 0;
  }

  private questionPoints(doc: DocumentState): number {
    const questions = doc.questions;
    for (let i = 0; i < questions.length; i++) {
      for (let j = i + 1; j < questions.length; j++) {
        if (jaccard(questions[i].tokens, questions[j].tokens) >= this.heuristics.questionSimilarity) return this.heuristics.questionPoints;
      }
    }
    return 0;
  }

  /** E: フォーカスがあり、デバッグ中でなく、その文書での最後の操作から一定時間たっている。 */
  private isIdle(documentKey: string, now: number, environment: StuckEnvironment): boolean {
    return environment.focused && !environment.debugging && this.lastActivityDocument === documentKey &&
      this.lastActivityAt !== undefined && now - this.lastActivityAt >= this.heuristics.idleAfterMs;
  }

  /** A と B は1つの群（上限を共有）。群として数えるのは寄与が1点以上のものだけ。 */
  private groupsOf(contributions: [StuckEvidenceGroup, number][], occurrence: Occurrence): StuckEvidenceGroup[] {
    const groups: StuckEvidenceGroup[] = [];
    for (const [group, points] of contributions) {
      if (points < 1) continue;
      if (group === "A") {
        // 表示用に A / B を区別する（群の数としては1つ）
        if (occurrence.events.some((event) => event.group === "A")) groups.push("A");
        else groups.push("B");
        continue;
      }
      groups.push(group);
    }
    return groups;
  }

  private nextState(current: StuckState, score: number, groupCount: number): StuckState {
    const h = this.heuristics;
    const likely = score >= h.likelyScore && groupCount >= h.likelyMinGroups;
    if (likely) return "Struggling";
    if (current === "Struggling") {
      // ヒステリシス: 少し下がっただけでは状態を戻さない
      if (score >= h.likelyScore - h.hysteresis && groupCount >= h.likelyMinGroups) return "Struggling";
      return score >= h.possibleScore - h.hysteresis ? "Watching" : "Calm";
    }
    if (score >= h.possibleScore) return "Watching";
    if (current === "Watching" && score >= h.possibleScore - h.hysteresis) return "Watching";
    return "Calm";
  }

  private decay(points: number, ageMs: number): number {
    return points * Math.pow(0.5, Math.max(0, ageMs) / this.heuristics.halfLifeMs);
  }
}

/** 質問の正規化トークン。英数字は単語、日本語などは2文字ずつ（空白で区切らない言語のため）。 */
export function tokenizeQuestion(text: string, maxTokens: number = STUCK_HEURISTICS.questionMaxTokens): Set<string> {
  const tokens = new Set<string>();
  const normalized = text.toLowerCase().normalize("NFKC");
  for (const word of normalized.match(/[a-z0-9_]{2,}/g) ?? []) tokens.add(word);
  for (const run of normalized.match(/[^\sa-z0-9_\p{P}\p{S}]+/gu) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  return new Set([...tokens].slice(0, maxTokens));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 診断の種類キー: source・code・メッセージの形（引用部と数値を置き換えたもの）。メッセージ本文は残さない。 */
export function diagnosticKindKey(source: string | undefined, code: string | undefined, message: string): string {
  const shape = message.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "'_'").replace(/\d+/g, "0").slice(0, 200);
  return `${(source ?? "").toLowerCase()}|${code ?? ""}|${hashString(shape)}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
