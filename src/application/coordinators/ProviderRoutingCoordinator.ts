import type {
  AiProviderId,
  ConversationEntry,
  NavigatorSettings,
  ConversationRoutingPreference,
  ProviderResponseMetadata,
  RoutingLearningViewData,
  RoutingTaskProfile
} from "../../shared/types";
import type { ConversationStore } from "../../services/ConversationStore";
import type { ConnectionService } from "../../services/ConnectionService";
import type { UsageMeter } from "../../services/UsageMeter";
import type { ProviderEvaluationStore } from "../../services/ProviderEvaluationStore";
import { deriveModelProfile } from "../../services/ModelProfile";
import {
  decideProviderRoute,
  eligibleRoutingCandidates,
  evaluateRoutingCandidateEligibility,
  normalizeRoutingSettings,
  PROVIDER_IDS,
  PROVIDER_LABELS
} from "../../shared/providerRouting";
import {
  classifyRoutingTask,
  decideAdaptiveRoute,
  resolveRoutingLearningStatus,
  ROUTING_LEARNING_THRESHOLD,
  type RoutingSignals,
  type ScoredRoutingCandidate
} from "../../shared/adaptiveProviderRouting";

export interface ProviderRoutingPreparation {
  ok: boolean;
  reason?: string;
  taskProfile: RoutingTaskProfile;
}

export class ProviderRoutingCoordinator {
  private readonly pins = new Map<string, AiProviderId>();
  private readonly selected = new Map<string, AiProviderId>();
  private readonly preferences = new Map<string, ConversationRoutingPreference>();
  private readonly once = new Map<string, AiProviderId>();
  private readonly turnsSinceSwitch = new Map<string, number>();
  public constructor(
    private readonly connection: ConnectionService,
    private readonly usage: UsageMeter,
    private readonly store?: ConversationStore,
    private readonly evaluation?: ProviderEvaluationStore,
    private readonly diagnostic: (entry: Record<string, unknown>) => void = () => {}
  ) {}
  public preference(stream?: string): ConversationRoutingPreference | undefined {
    return stream ? this.preferences.get(stream) ?? this.store?.getRoutingPreference(stream) : undefined;
  }
  public async setPreference(stream: string, value: ConversationRoutingPreference): Promise<void> {
    await this.store?.saveRoutingPreference(stream, value);
    this.preferences.set(stream, value);
    if (value.providerId) this.pins.set(stream, value.providerId); else this.pins.delete(stream);
  }
  public selectOnce(stream: string, provider: AiProviderId): void { this.once.set(stream, provider); }
  public applyExplicitSelection(stream: string, provider: AiProviderId): void {
    this.selected.set(stream, provider);
    this.turnsSinceSwitch.set(stream, 0);
  }
  public async pin(stream: string, provider?: AiProviderId): Promise<void> {
    if (provider) this.pins.set(stream, provider); else this.pins.delete(stream);
    await this.setPreference(stream, { ...this.preference(stream), providerId: provider });
  }
  public forget(stream?: string): void {
    for (const map of [this.pins, this.selected, this.preferences, this.once, this.turnsSinceSwitch]) {
      if (stream) map.delete(stream); else map.clear();
    }
  }
  public learningView(settings: NavigatorSettings): RoutingLearningViewData {
    const routing = normalizeRoutingSettings(settings.routing);
    const eligibleProviderCount = this.connection.getTestedModels(settings)
      .filter(model => routing.allowedProviderIds.includes(model.providerId)).length;
    const successfulResponseCount = this.evaluation?.getSuccessfulResponseCount() ?? 0;
    const status = resolveRoutingLearningStatus(successfulResponseCount, eligibleProviderCount, routing.mode === "automatic");
    const reason = status === "manual"
      ? "自動切り替えはオフです。"
      : status === "learning"
        ? `学習中 ${successfulResponseCount} / ${ROUTING_LEARNING_THRESHOLD}。正常応答を記録しています。`
        : status === "readySingleProvider"
          ? "学習済みです。もう1つプロバイダーを接続すると自動選択を開始します。"
          : "タスク適性による自動選択が有効です。";
    return { status, successfulResponseCount, threshold: ROUTING_LEARNING_THRESHOLD, eligibleProviderCount, reason };
  }

  public async prepare(
    settings: NavigatorSettings,
    history: ConversationEntry[],
    stream: string | undefined,
    question = "",
    cancelled: () => boolean = () => false,
    signals: Omit<RoutingSignals, "question"> = {}
  ): Promise<ProviderRoutingPreparation> {
    const taskProfile = classifyRoutingTask({ ...signals, question });
    const routing = normalizeRoutingSettings(settings.routing);
    const preference = this.preference(stream);
    if (preference?.mode) routing.mode = preference.mode;
    const oneShot = stream ? this.once.get(stream) : undefined;
    if (routing.mode === "manual" && !oneShot && !preference?.providerId) {
      const connected = this.connection.getState() === "connected";
      const currentProviderId = this.connection.getProviderId?.();
      this.diagnostic({
        event: "provider_route_evaluated",
        routingMode: routing.mode,
        taskPurpose: taskProfile.purpose,
        complexity: taskProfile.complexity,
        scope: taskProfile.scope,
        classificationReasons: taskProfile.reasons,
        action: connected ? "stay" : "stop",
        currentProviderId,
        selectedProviderId: currentProviderId,
        reasonCode: "manual",
        reason: connected ? "手動モードの現在の接続先を維持します。" : "手動モードの接続先が未接続です。"
      });
      return { ok: connected, taskProfile };
    }
    const current = this.connection.getProviderId();
    const models = this.connection.getTestedModels(settings);
    const candidates = PROVIDER_IDS.map(providerId => {
      const model = models.find(m => m.providerId === providerId);
      const usage = this.usage.getToday(providerId);
      return { providerId, available: Boolean(model), usedTokens: usage.inputTokens + usage.outputTokens,
        // 自動切り替えも設定画面の「NaviCom内の概算使用量ガード」を共通で使う。
        // 切り替え専用の上限を持つと、同じ意味の設定が二重管理になるため。
        tokenLimit: settings.dailyTokenLimit,
        maxInputTokens: model ? deriveModelProfile(model.profileSource).contextBudget : 0,
        costUsd: usage.requestCount === 0 ? 0 : this.usage.getRecordedCostUsd(providerId),
        verifiedLocal: Boolean(model && (providerId === "ollama" || providerId === "lmStudio") &&
          /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(model.endpoint ?? "") && !/cloud/i.test(model.modelId)) };
    });
    const localOnly = history.some(e => e.transmissionClass === "localOnly" ||
      (!e.transmissionClass && (e.providerId === "ollama" || e.providerId === "lmStudio")));
    const requiredHistoryChars = history.length ? JSON.stringify(history.filter(e => e.role === "user").map(e => ({ id: e.id, role: e.role, text: e.text }))).length + 250 : 0;
    const estimated = Math.max(Math.ceil(question.length / 3) + 2000, Math.ceil(requiredHistoryChars / (3 * 0.35)) + 2000);
    const pinned = oneShot ?? (stream ? this.pins.get(stream) : undefined) ?? preference?.providerId;
    const remembered = stream ? this.selected.get(stream) ?? [...history].reverse().find(e => e.role === "assistant")?.providerId : undefined;
    const expected = pinned ?? remembered ?? (history.length ? current : routing.preferredProviderId ?? current);
    let route = decideProviderRoute(routing, candidates, expected, estimated, localOnly, Boolean(pinned));
    let reasonCode = route.action === "stop" ? "ineligible" : route.action === "switch" ? "fallback" : "fixed";
    let scoreDelta: number | undefined;
    let adaptiveDebug: ReturnType<typeof decideAdaptiveRoute>["debug"] | undefined;
    const successfulResponseCount = this.evaluation?.getSuccessfulResponseCount() ?? 0;
    const turnsSinceSwitch = stream
      ? this.turnsSinceSwitch.get(stream) ?? consecutiveProviderTurns(history, route.providerId ?? current)
      : Number.MAX_SAFE_INTEGER;
    const allowExploration = !localOnly && estimated < 16_000;
    if (routing.mode === "automatic" && !pinned && route.action === "stay" && route.providerId) {
      const eligible = eligibleRoutingCandidates(routing, candidates, estimated, localOnly);
      const scored: ScoredRoutingCandidate[] = eligible.flatMap(candidate => {
        const model = models.find(item => item.providerId === candidate.providerId);
        return model ? [{ ...candidate, modelId: model.modelId,
          stats: this.evaluation?.getStats({ providerId: model.providerId, modelId: model.modelId, taskPurpose: taskProfile.purpose }) }] : [];
      });
      const adaptive = decideAdaptiveRoute({ candidates: scored, currentProviderId: route.providerId,
        profile: taskProfile, successfulResponseCount,
        turnsSinceSwitch,
        allowExploration });
      route = { action: adaptive.action, providerId: adaptive.providerId, currentEligible: true, reason: adaptive.reason };
      reasonCode = adaptive.reasonCode;
      scoreDelta = adaptive.scoreDelta;
      adaptiveDebug = adaptive.debug;
    }
    const candidateDiagnostics = candidates.map(candidate => {
      const model = models.find(item => item.providerId === candidate.providerId);
      const eligibility = evaluateRoutingCandidateEligibility(routing, candidates, candidate, estimated, localOnly);
      return {
        providerId: candidate.providerId,
        modelId: model?.modelId,
        available: candidate.available,
        allowed: routing.allowedProviderIds.includes(candidate.providerId),
        eligible: eligibility.eligible,
        exclusionReasons: eligibility.exclusionReasons,
        maxInputTokens: candidate.maxInputTokens,
        usedTokens: candidate.usedTokens,
        tokenLimit: candidate.tokenLimit,
        verifiedLocal: candidate.verifiedLocal
      };
    });
    this.diagnostic({
      event: "provider_route_evaluated",
      routingMode: routing.mode,
      taskPurpose: taskProfile.purpose,
      complexity: taskProfile.complexity,
      scope: taskProfile.scope,
      classificationReasons: taskProfile.reasons,
      currentProviderId: current,
      expectedProviderId: expected,
      pinned: Boolean(pinned),
      oneShot: Boolean(oneShot),
      localOnly,
      estimatedInputTokens: estimated,
      successfulResponseCount,
      eligibleProviderCount: eligibleRoutingCandidates(routing, candidates, estimated, localOnly).length,
      turnsSinceSwitch,
      allowExploration,
      candidates: candidateDiagnostics,
      adaptive: adaptiveDebug,
      action: route.action,
      selectedProviderId: route.providerId,
      reasonCode,
      reason: route.reason,
      scoreDelta: scoreDelta === undefined ? undefined : Math.round(scoreDelta * 100) / 100
    });
    if (route.providerId) void this.evaluation?.recordDecision({ conversationId: stream, profile: taskProfile,
      previousProviderId: current, selectedProviderId: route.providerId, action: route.action,
      reasonCode, scoreDelta }).catch(error => this.logEvaluationError("decision", error));
    if (route.action === "stop") return { ok: false, reason: route.reason, taskProfile };
    const target = route.providerId;
    if (cancelled()) {
      this.diagnostic({ event: "provider_route_cancelled", currentProviderId: current, selectedProviderId: target });
      return { ok: false, reason: "送信を中止しました。", taskProfile };
    }
    if (target && (target !== current || this.connection.getState() !== "connected")) {
      this.diagnostic({ event: "provider_switch_started", previousProviderId: current, selectedProviderId: target,
        reasonCode, reconnect: target === current });
      if (!this.connection.activateTestedProvider(target, settings)) {
        this.diagnostic({ event: "provider_switch_failed", previousProviderId: current, selectedProviderId: target,
          reasonCode, failureReason: "activateTestedProviderReturnedFalse" });
        return { ok: false, reason: "切り替え先の接続を再確認してください。", taskProfile };
      }
      this.diagnostic({ event: "provider_switch_completed", previousProviderId: current, selectedProviderId: target,
        reasonCode, reconnect: target === current });
      if (stream) this.selected.set(stream, oneShot ? remembered ?? current : target);
      if (stream && !oneShot) this.turnsSinceSwitch.set(stream, 0);
      if (stream) this.once.delete(stream);
      return { ok: true, reason: `${PROVIDER_LABELS[target]}へ${routing.mode === "automatic" ? "自動" : ""}切り替え: ${route.reason}`, taskProfile };
    }
    if (stream && target) this.selected.set(stream, oneShot ? remembered ?? current : target);
    if (stream) this.once.delete(stream);
    return { ok: true, taskProfile };
  }

  public async recordSuccess(input: {
    stream?: string;
    providerId: AiProviderId;
    modelId: string;
    resolvedModelId?: string;
    taskProfile: RoutingTaskProfile;
    latencyMs: number;
    responseMetadata?: ProviderResponseMetadata;
  }): Promise<boolean> {
    if (input.stream) this.turnsSinceSwitch.set(input.stream, (this.turnsSinceSwitch.get(input.stream) ?? 0) + 1);
    if (!this.evaluation) return false;
    await this.evaluation?.recordSuccess(
      { providerId: input.providerId, modelId: input.modelId, taskPurpose: input.taskProfile.purpose },
      input.latencyMs,
      input.responseMetadata?.formatNormalized === true || (input.responseMetadata?.attemptCount ?? 1) > 1
    );
    if (input.resolvedModelId && input.resolvedModelId !== input.modelId) {
      await this.evaluation.recordSuccess(
        { providerId: input.providerId, modelId: input.resolvedModelId, taskPurpose: input.taskProfile.purpose },
        input.latencyMs,
        input.responseMetadata?.formatNormalized === true || (input.responseMetadata?.attemptCount ?? 1) > 1,
        false
      );
    }
    return true;
  }

  public async recordFailure(input: {
    providerId: AiProviderId;
    modelId: string;
    taskProfile: RoutingTaskProfile;
    timedOut: boolean;
    formatFailed?: boolean;
  }): Promise<void> {
    await this.evaluation?.recordFailure(
      { providerId: input.providerId, modelId: input.modelId, taskPurpose: input.taskProfile.purpose },
      input.timedOut,
      input.formatFailed
    );
  }

  public async recordFeedback(entry: ConversationEntry, rating: "good" | "bad"): Promise<void> {
    if (!entry.providerId || !entry.modelId || !entry.routingTaskPurpose) return;
    await this.evaluation?.recordFeedback(entry.id,
      { providerId: entry.providerId, modelId: entry.modelId, taskPurpose: entry.routingTaskPurpose }, rating);
  }

  private logEvaluationError(operation: string, error: unknown): void {
    this.diagnostic({ event: "provider_evaluation_persistence_failed", operation,
      errorName: error instanceof Error ? error.name : "unknown" });
  }
}

function consecutiveProviderTurns(history: ConversationEntry[], providerId: AiProviderId): number {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry.role !== "assistant") continue;
    if (entry.providerId !== providerId) break;
    count++;
  }
  return count === 0 ? Number.MAX_SAFE_INTEGER : count;
}
