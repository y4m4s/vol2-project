import * as vscode from "vscode";
import {
  AdviceMode,
  AdviceTriggerReason,
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
  reason: AdviceTriggerReason;
}

const DEFAULT_SETTINGS: Pick<NavigatorSettings, "requestIntervalMs" | "idleDelayMs"> = {
  requestIntervalMs: 30000,
  idleDelayMs: 2000
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
  private pendingTriggerReason?: AdviceTriggerReason;
  private lastActivityAt?: number;
  private lastAdviceAt?: number;
  private idleTimer?: NodeJS.Timeout;
  private cooldownTimer?: NodeJS.Timeout;
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
    if (!this.isModeEnabledForUi()) {
      this.pendingTriggerReason = undefined;
      this.lastActivityAt = undefined;
      this.syncTicker();
      this.didChangeStateEmitter.fire();
      return;
    }

    this.lastActivityAt = Date.now();
    this.pendingTriggerReason = reason;

    if (this.isModeActive()) {
      this.ensureScheduled();
    }

    this.syncTicker();
    this.didChangeStateEmitter.fire();
  }

  public togglePaused(): void {
    this.paused = !this.paused;

    if (this.paused) {
      this.clearTimers();
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

    const now = Date.now();
    const idleRemaining = this.getIdleRemainingMs(now);
    if (idleRemaining > 0) {
      this.armIdleTimer(idleRemaining);
      this.clearCooldownTimer();
      return;
    }

    const cooldownRemaining = this.getCooldownRemainingMs(now);
    if (cooldownRemaining > 0) {
      this.armCooldownTimer(cooldownRemaining);
      this.clearIdleTimer();
      return;
    }

    this.dispatchPendingTrigger();
  }

  private dispatchPendingTrigger(): void {
    if (!this.pendingTriggerReason || !this.isModeActive()) {
      return;
    }

    const reason = this.pendingTriggerReason;
    this.pendingTriggerReason = undefined;
    this.lastAdviceAt = Date.now();
    this.clearTimers();
    this.syncTicker();
    this.didChangeStateEmitter.fire();
    this.didTriggerAdviceEmitter.fire({ reason });
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

  private armIdleTimer(delayMs: number): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.ensureScheduled();
      this.syncTicker();
      this.didChangeStateEmitter.fire();
    }, delayMs);
  }

  private armCooldownTimer(delayMs: number): void {
    this.clearCooldownTimer();
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = undefined;
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
    this.pendingTriggerReason = undefined;
    this.lastActivityAt = undefined;
    this.clearTimers();
  }

  private clearTimers(): void {
    this.clearIdleTimer();
    this.clearCooldownTimer();
    this.syncTicker();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
  }
}
