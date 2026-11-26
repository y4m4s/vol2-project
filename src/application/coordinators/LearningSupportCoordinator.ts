import type { AdviceMode } from "../../shared/types";
import type { StuckTopicSnapshot } from "../../services/StuckSignalTracker";

export const INTERVENTION_COOLDOWN_MS = 10 * 60_000;
/**
 * advice / no_advice / cancelled: 完了（同じ論題には再介入せず、論題をまたぐ間隔を空ける）
 * nothing_to_send: 送る文脈がない・同じ文脈で相談済み。完了とするが、AIを呼んでいないので間隔は空けない
 * error: AIへの要求の失敗（初回＋再試行1回まで） / stale: 生成前後の陳腐化（試行に数えない、2回で打ち切り）
 * skipped: 一時停止・切断・処理中など、送信前に止めたもの（試行に数えない）
 */
export type InterventionOutcome = "advice" | "no_advice" | "cancelled" | "nothing_to_send" | "error" | "stale" | "skipped";
interface InterventionRecord {
  phase: "idle" | "offered" | "scheduled" | "inFlight" | "done";
  attempts: number;
  staleDiscards: number;
  retryAfter: number;
}
export interface LearningSupportRuntime {
  enabled: boolean;
  mode: AdviceMode;
  connected: boolean;
  requestIdle: boolean;
  composerActive: boolean;
  paused: boolean;
  focused: boolean;
  documentKey?: string;
  editorIdleMs: number;
  idleDelayMs: number;
  requestIntervalMs: number;
}
export interface LearningSupportHost {
  runtime(): LearningSupportRuntime;
  requestReevaluation(topic: StuckTopicSnapshot): boolean;
  cancelReevaluation(key: string): void;
  showSuggestion(topic: StuckTopicSnapshot | undefined): void;
  log(entry: Record<string, unknown>): void;
}
export function interventionKey(topic: Pick<StuckTopicSnapshot, "documentKey" | "topicId">): string {
  return JSON.stringify([topic.documentKey, topic.topicId]);
}

/** 検知と生成を分離し、論題ごとの予約・再試行・提示と全体の介入間隔だけを管理する。 */
export class LearningSupportCoordinator {
  private readonly records = new Map<string, InterventionRecord>();
  private topics = new Map<string, StuckTopicSnapshot>();
  private activeTopics = new Map<string, StuckTopicSnapshot>();
  private offered?: string;
  private cooldownUntil = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshing = false;
  private disposed = false;

  public constructor(private readonly host: LearningSupportHost, private readonly now: () => number = Date.now) {}

  public update(topics: readonly StuckTopicSnapshot[], knownKeys: readonly string[]): void {
    this.activeTopics = new Map(topics.map(topic => [interventionKey(topic), topic]));
    this.topics = new Map(topics.filter(topic => topic.state === "Struggling").map(topic => [interventionKey(topic), topic]));
    const known = new Set(knownKeys);
    for (const [key, record] of this.records) {
      if (!known.has(key)) {
        this.records.delete(key);
        if (record.phase === "scheduled") this.host.cancelReevaluation(key);
      }
    }
    this.refresh();
  }

  public getTopic(key: string): StuckTopicSnapshot | undefined {
    return this.host.runtime().enabled ? this.topics.get(key) : undefined;
  }

  /** 生成開始後はスコアの減衰だけで回答を捨てず、論題の消失を確認する。 */
  public getActiveTopic(key: string): StuckTopicSnapshot | undefined {
    return this.host.runtime().enabled ? this.activeTopics.get(key) : undefined;
  }

  public begin(key: string): StuckTopicSnapshot | undefined {
    const topic = this.getTopic(key), record = this.records.get(key);
    if (!topic || !record || record.phase === "done" || record.phase === "inFlight") return undefined;
    record.phase = "inFlight";
    record.attempts++;
    if (this.offered === key) this.setOffer(undefined);
    return topic;
  }

  public finish(key: string, outcome: InterventionOutcome): void {
    const record = this.records.get(key);
    if (!record || record.phase === "done") return;
    const now = this.now();
    if (outcome === "advice" || outcome === "no_advice" || outcome === "cancelled") {
      record.phase = "done";
      this.cooldownUntil = now + INTERVENTION_COOLDOWN_MS;
    } else if (outcome === "nothing_to_send") {
      if (record.phase === "inFlight") record.attempts = Math.max(0, record.attempts - 1);
      record.phase = "done";
    } else if (outcome === "stale") {
      record.attempts = Math.max(0, record.attempts - 1);
      record.staleDiscards++;
      record.phase = record.staleDiscards >= 2 ? "done" : "idle";
      record.retryAfter = now + this.host.runtime().requestIntervalMs;
    } else if (outcome === "error") {
      record.phase = record.attempts >= 2 ? "done" : "idle";
      record.retryAfter = now + this.host.runtime().requestIntervalMs;
    } else {
      if (record.phase === "inFlight") record.attempts = Math.max(0, record.attempts - 1);
      record.phase = "idle";
      record.retryAfter = now + this.host.runtime().requestIntervalMs;
    }
    this.host.log({ event: "stuck_intervention_completed", outcome, attempts: record.attempts, staleDiscards: record.staleDiscards });
    this.refresh();
  }

  public dismiss(key: string): void {
    if (!this.records.has(key)) return;
    this.finish(key, "cancelled");
    if (this.offered === key) this.setOffer(undefined);
  }

  /** 一時停止・切断・モード切替で破棄された予約は、生成の試行として数えない。 */
  public dropped(key: string): void {
    const record = this.records.get(key);
    if (record?.phase === "scheduled") record.phase = "idle";
  }

  /** 収集中のカーソル移動などは、生成後の陳腐化回数にも生成の試行にも数えない。 */
  public deferPreparation(key: string, requeued: boolean): void {
    const record = this.records.get(key);
    if (!record || record.phase === "done") return;
    record.attempts = Math.max(0, record.attempts - 1);
    record.phase = requeued ? "scheduled" : "idle";
    if (!requeued) record.retryAfter = this.now() + this.host.runtime().requestIntervalMs;
    this.refresh();
  }

  /**
   * 中断ボタン。中断したのが生成中のつまずきの相談なら完了とする。予約だけの論題は、
   * 別の相談を中断しただけなので完了にせず、通常の間隔の後に予約し直せるよう戻す。
   */
  public cancelActive(): void {
    const now = this.now();
    for (const [key, record] of this.records) {
      if (record.phase === "inFlight") this.finish(key, "cancelled");
      else if (record.phase === "scheduled") {
        record.phase = "idle";
        record.retryAfter = now + this.host.runtime().requestIntervalMs;
        this.host.cancelReevaluation(key);
      }
    }
  }

  public invalidateSuggestion(): void {
    const record = this.offered ? this.records.get(this.offered) : undefined;
    if (record?.phase === "offered") record.phase = "idle";
    this.setOffer(undefined);
    this.refresh();
  }

  public refresh(): void {
    if (this.refreshing || this.disposed) return;
    this.refreshing = true;
    try {
      this.clearTimer();
      const runtime = this.host.runtime(), now = this.now();
      if (!runtime.enabled) {
        for (const [key, record] of this.records) {
          if (record.phase === "scheduled") { record.phase = "idle"; this.host.cancelReevaluation(key); }
          if (record.phase === "offered") record.phase = "idle";
        }
        this.setOffer(undefined);
        return;
      }
      if (this.offered && (!this.topics.has(this.offered) || this.topics.get(this.offered)?.documentKey !== runtime.documentKey || runtime.mode === "always")) {
        const record = this.records.get(this.offered);
        if (record?.phase === "offered") record.phase = "idle";
        this.setOffer(undefined);
      }
      if (!runtime.connected || !runtime.focused || (runtime.mode === "always" && runtime.paused) || !runtime.requestIdle || runtime.composerActive) return;
      // Controller が idle に戻してから結果を通知するまでの隙間も、次の論題を予約しない。
      // 複数の論題を先に予約すると、完了後の10分クールダウンを迂回してしまう。
      if ([...this.records.values()].some(record => record.phase === "scheduled" || record.phase === "inFlight")) return;
      const wait = Math.max(this.cooldownUntil - now, runtime.idleDelayMs - runtime.editorIdleMs);
      if (wait > 0) { this.wakeAfter(wait); return; }
      for (const [key, topic] of this.topics) {
        if (topic.documentKey !== runtime.documentKey) continue;
        let record = this.records.get(key);
        if (!record) {
          record = { phase: "idle", attempts: 0, staleDiscards: 0, retryAfter: 0 };
          this.records.set(key, record);
        }
        if (record.phase !== "idle") continue;
        if (record.retryAfter > now) { this.wakeAfter(record.retryAfter - now); continue; }
        if (runtime.mode === "always") {
          // 予約が同期的に発火しても、二重予約にならないよう先に状態を変える。
          record.phase = "scheduled";
          if (!this.host.requestReevaluation(topic)) record.phase = "idle";
        } else if (!this.offered) {
          record.phase = "offered";
          this.setOffer(key);
        }
        break;
      }
    } finally { this.refreshing = false; }
  }

  public dispose(): void { this.disposed = true; this.clearTimer(); }

  private setOffer(key: string | undefined): void {
    if (this.offered === key) return;
    this.offered = key;
    this.host.showSuggestion(key ? this.topics.get(key) : undefined);
  }
  private wakeAfter(ms: number): void {
    if (this.timer || !this.topics.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.refresh(); }, Math.max(1, ms));
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}
