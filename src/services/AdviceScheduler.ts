import * as vscode from "vscode";
import {
  AdviceMode,
  AdviceTriggerReason,
  AutomaticTriggerSignal,
  AutoAdviceState,
  ConnectionState,
  NavigatorSettings,
  RequestState
} from "../shared/types";

interface SchedulerRuntimeState {
  mode: AdviceMode;
  connectionState: ConnectionState;
  requestState: RequestState;
}

export interface AutoAdviceTriggerEvent {
  signals: AutomaticTriggerSignal[];
  idleDurationMs: number;
}

const DEFAULT_SETTINGS: Pick<NavigatorSettings, "requestIntervalMs" | "idleDelayMs"> = {
  requestIntervalMs: 20000,
  idleDelayMs: 10000
};

export class AdviceScheduler implements vscode.Disposable {
  private readonly didTriggerAdviceEmitter = new vscode.EventEmitter<AutoAdviceTriggerEvent>();
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();

  private settings = DEFAULT_SETTINGS;
  private runtimeState: SchedulerRuntimeState = {
    mode: "manual",
    connectionState: "disconnected",
    requestState: "idle"
  };

  private paused = false;
  private composerActive = false;
  private pendingTriggerReason?: AdviceTriggerReason;
  private signals: AutomaticTriggerSignal[] = [];
  private lastActivityAt?: number;
  private lastAdviceAt?: number;
  private eligibilityTimer?: NodeJS.Timeout;
  private ticker?: NodeJS.Timeout;

  public readonly onDidTriggerAdvice = this.didTriggerAdviceEmitter.event;
  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public configure(
    settings: Pick<NavigatorSettings, "requestIntervalMs" | "idleDelayMs">,
    runtimeState: SchedulerRuntimeState
  ): void {
    this.settings = settings;
    this.runtimeState = runtimeState;

    if (!this.isModeActive()) {
      this.clearPending();
    } else {
      this.ensureScheduled();
    }

    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public handleActivity(reason: AdviceTriggerReason): void {
    // エディタ操作が来たら入力一時停止を解除
    this.composerActive = false;

    if (!this.isModeEnabledForUi() || this.paused) {
      this.clearPending();
      this.pendingTriggerReason = undefined;
      this.lastActivityAt = undefined;
      this.syncTicker();
      this.didChangeStateEmitter.fire();
      return;
    }

    this.lastActivityAt = Date.now();
    // An editor switch starts a new document context; never mix signals from two files.
    if (reason === "editor_change") this.signals = [];
    this.signals = [...this.signals.filter((signal) => signal.reason !== reason),
      { reason, occurredAt: this.lastActivityAt }].slice(-5);
    this.pendingTriggerReason = reason;

    if (this.isModeActive()) {
      this.ensureScheduled();
    }

    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public setComposerActive(active: boolean): void {
    if (this.composerActive === active) {
      return;
    }
    this.composerActive = active;

    if (active) {
      // 入力中は発火だけを止める。クールダウンの絶対期限は lastAdviceAt に保持する。
      this.clearEligibilityTimer();
    } else {
      // 入力終了時点からのアイドル期限と、既存のクールダウン期限の遅い方まで待つ。
      this.lastActivityAt = Date.now();
      if (this.pendingTriggerReason) {
        this.ensureScheduled();
      }
    }

    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public handleCursorActivity(): void {
    if (this.pendingTriggerReason && this.isModeActive()) {
      this.lastActivityAt = Date.now();
      this.ensureScheduled();
    }
  }

  /** Retry an already triggered request, without making cursor movement a new trigger. */
  public requeueStaleTrigger(event: AutoAdviceTriggerEvent): void {
    if (!this.isModeEnabledForUi() || this.paused || this.pendingTriggerReason || !event.signals.length) return;
    this.signals = event.signals.map((signal) => ({ ...signal }));
    this.pendingTriggerReason = this.signals[this.signals.length - 1].reason;
    // Start a fresh idle wait; do not interrupt continued cursor navigation.
    this.lastActivityAt = Date.now();
    if (this.isModeActive()) this.ensureScheduled();
    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public togglePaused(): void {
    this.paused = !this.paused;

    if (this.paused) {
      this.clearPending();
    } else if (this.pendingTriggerReason) {
      this.ensureScheduled();
    }

    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public resetPause(): void {
    if (!this.paused) {
      return;
    }

    this.paused = false;
    this.ensureScheduled();
    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public getState(now = Date.now()): AutoAdviceState {
    return {
      enabled: this.isModeEnabledForUi(),
      paused: this.paused,
      waitingForIdle: this.isWaitingForIdle(now),
      idleRemainingMs: this.getIdleRemainingMs(now),
      cooldownRemainingMs: this.getCooldownRemainingMs(now),
      pendingTriggerReason: this.pendingTriggerReason,
      lastAdviceAt: this.lastAdviceAt ? new Date(this.lastAdviceAt).toISOString() : undefined
    };
  }

  public getTriggerSnapshot(now = Date.now()): AutoAdviceTriggerEvent {
    return {
      signals: this.signals.map((signal) => ({ ...signal })),
      idleDurationMs: this.lastActivityAt === undefined ? 0 : Math.max(0, now - this.lastActivityAt)
    };
  }

  public cancelPending(): void {
    this.clearPending();
    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public dispose(): void {
    this.clearTimers();
    this.didTriggerAdviceEmitter.dispose();
    this.didChangeStateEmitter.dispose();
  }

  private ensureScheduled(): void {
    if (!this.isModeActive() || !this.pendingTriggerReason) {
      this.clearTimers();
      return;
    }

    // 入力中は発火しない。クールダウンは絶対時刻で継続する。
    if (this.composerActive) {
      this.clearEligibilityTimer();
      return;
    }

    const now = Date.now();
    const idleRemaining = this.getIdleRemainingMs(now);
    const cooldownRemaining = this.getCooldownRemainingMs(now);
    const eligibilityRemaining = Math.max(idleRemaining, cooldownRemaining);
    if (eligibilityRemaining > 0) {
      this.armEligibilityTimer(eligibilityRemaining);
      return;
    }

    this.dispatchPendingTrigger();
  }

  private dispatchPendingTrigger(): void {
    if (!this.pendingTriggerReason || !this.isModeActive()) {
      return;
    }

    const event = this.getTriggerSnapshot();
    this.pendingTriggerReason = undefined;
    this.signals = [];
    this.lastAdviceAt = Date.now();
    this.clearTimers();
    this.syncTicker();
    this.didChangeStateEmitter.fire();
    this.didTriggerAdviceEmitter.fire(event);
  }

  private getIdleRemainingMs(now: number): number {
    if (!this.pendingTriggerReason || !this.lastActivityAt) {
      return 0;
    }

    return Math.max(0, this.lastActivityAt + this.settings.idleDelayMs - now);
  }

  private getCooldownRemainingMs(now: number): number {
    if (!this.lastAdviceAt) {
      return 0;
    }

    return Math.max(0, this.lastAdviceAt + this.settings.requestIntervalMs - now);
  }

  private isWaitingForIdle(now: number): boolean {
    return this.isModeActive() && Boolean(this.pendingTriggerReason) && this.getIdleRemainingMs(now) > 0;
  }

  private isModeActive(): boolean {
    return (
      this.isModeEnabledForUi() &&
      !this.paused &&
      this.runtimeState.requestState === "idle"
    );
  }

  private isModeEnabledForUi(): boolean {
    return (
      this.runtimeState.mode === "always" &&
      this.runtimeState.connectionState === "connected"
    );
  }

  private armEligibilityTimer(delayMs: number): void {
    this.clearEligibilityTimer();
    this.eligibilityTimer = setTimeout(() => {
      this.eligibilityTimer = undefined;
      this.ensureScheduled();
      this.syncTicker();
      this.didChangeStateEmitter.fire();
    }, delayMs);
  }

  private syncTicker(): void {
    const shouldTick = this.isModeEnabledForUi() && (Boolean(this.pendingTriggerReason) || this.getCooldownRemainingMs(Date.now()) > 0);
    if (shouldTick && !this.ticker) {
      this.ticker = setInterval(() => {
        this.didChangeStateEmitter.fire();
        if (!this.isModeEnabledForUi() || (!this.pendingTriggerReason && this.getCooldownRemainingMs(Date.now()) <= 0)) {
          this.syncTicker();
        }
      }, 1000);
      return;
    }

    if (!shouldTick && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private clearPending(): void {
    this.signals = [];
    this.pendingTriggerReason = undefined;
    this.lastActivityAt = undefined;
    this.clearTimers();
  }

  private clearTimers(): void {
    this.clearEligibilityTimer();
    this.syncTicker();
  }

  private clearEligibilityTimer(): void {
    if (this.eligibilityTimer) {
      clearTimeout(this.eligibilityTimer);
      this.eligibilityTimer = undefined;
    }
  }
}
