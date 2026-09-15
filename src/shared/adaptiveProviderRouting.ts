import type {
  AssistanceDepth,
  DiagnosticSeverityLabel,
  RoutingComplexity,
  RoutingLearningStatus,
  RoutingScope,
  RoutingTaskProfile,
  RoutingTaskPurpose,
  SlashCommand
} from "./types";
import { findInitialModelCapability, initialTaskFitScore } from "./modelCapabilityDefaults";
import type { RoutingCandidate } from "./providerRouting";

export const ROUTING_LEARNING_THRESHOLD = 10;
export const ROUTING_SWITCH_SCORE_DELTA = 8;
export const ROUTING_MIN_TURNS_AFTER_SWITCH = 2;
export const ROUTING_CONTINUITY_BONUS = 4;

export interface RoutingSignals {
  question: string;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
  targetFileCount?: number;
  diagnostics?: Array<{ severity: DiagnosticSeverityLabel }>;
  changeCount?: number;
}

export interface RoutingObservedStats {
  successCount: number;
  requestFailureCount: number;
  formatFailureCount: number;
  timeoutCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  totalLatencyMs: number;
}

export interface ScoredRoutingCandidate extends RoutingCandidate {
  modelId: string;
  stats?: RoutingObservedStats;
}

export interface AdaptiveRoutingDecision {
  providerId: RoutingCandidate["providerId"];
  action: "stay" | "switch";
  reasonCode: "learning" | "singleProvider" | "scoreBelowThreshold" | "taskFit" | "cooldown" | "exploration";
  reason: string;
  score?: number;
  scoreDelta?: number;
  debug: AdaptiveRoutingDebug;
}

export interface AdaptiveRoutingDebug {
  learningStatus: RoutingLearningStatus;
  learningThreshold: number;
  switchScoreThreshold: number;
  minimumTurnsAfterSwitch: number;
  turnsSinceSwitch: number;
  explorationDue: boolean;
  explorationAllowed: boolean;
  candidateScores: Array<{
    providerId: RoutingCandidate["providerId"];
    modelId: string;
    initialScore: number;
    finalScore: number;
    observedAttemptCount: number;
    successCount: number;
    requestFailureCount: number;
    formatFailureCount: number;
    timeoutCount: number;
    positiveFeedbackCount: number;
    negativeFeedbackCount: number;
    averageLatencyMs?: number;
  }>;
  continuityBonus: number;
  currentBaseScore: number;
  currentAdjustedScore: number;
  bestProviderId: RoutingCandidate["providerId"];
  bestScore: number;
}

export function classifyRoutingTask(signals: RoutingSignals): RoutingTaskProfile {
  const question = signals.question.trim();
  const diagnosticErrors = signals.diagnostics?.filter(item => item.severity === "Error").length ?? 0;
  const diagnosticWarnings = signals.diagnostics?.filter(item => item.severity === "Warning").length ?? 0;
  const targetFileCount = Math.max(0, signals.targetFileCount ?? 0);
  const reasons: string[] = [];
  let purpose: RoutingTaskPurpose = "explanation";

  if (signals.slashCommand === "hint") {
    purpose = "learning";
    reasons.push("/hintによる学習支援");
  } else if (signals.slashCommand === "test") {
    purpose = "review";
    reasons.push("/testによる検証観点の整理");
  } else if (signals.slashCommand === "flow") {
    purpose = "explanation";
    reasons.push("/flowによる構造整理");
  } else if (/実装|修正|作って|追加して|変更して|implement|fix/i.test(question)) {
    purpose = "implementation";
    reasons.push("実装または修正の依頼");
  } else if (signals.slashCommand === "risk" || /危険|脆弱|security|認証|課金|削除|移行/i.test(question)) {
    purpose = "riskAssessment";
    reasons.push("高リスク境界の確認");
  } else if (diagnosticErrors > 0 || /レビュー|review|問題点|バグ|原因/i.test(question)) {
    purpose = "review";
    reasons.push("レビューまたは診断の依頼");
  } else if (/初心者|学習|教えて|練習|カリキュラム|課題|ヒント/.test(question)) {
    purpose = "learning";
    reasons.push("学習支援の依頼");
  } else if (/要約|まとめ|圧縮/.test(question)) {
    purpose = "summarization";
    reasons.push("要約または圧縮の依頼");
  } else {
    reasons.push("説明中心の相談");
  }

  const scope: RoutingScope = targetFileCount >= 4 ? "project" : targetFileCount >= 2 ? "multiFile" : targetFileCount === 1 ? "singleFile" : "selection";
  const highRisk = purpose === "riskAssessment" || diagnosticErrors >= 3 || targetFileCount >= 4 || (signals.changeCount ?? 0) >= 8;
  const medium = signals.assistanceDepth === "high" || diagnosticErrors > 0 || diagnosticWarnings >= 3 || targetFileCount >= 2 || question.length >= 500;
  const complexity: RoutingComplexity = highRisk ? "high" : medium ? "medium" : "low";
  if (signals.assistanceDepth === "high") reasons.push("推論強度が高");
  if (diagnosticErrors > 0) reasons.push(`エラー診断${diagnosticErrors}件`);
  if (targetFileCount > 0) reasons.push(`対象ファイル${targetFileCount}件`);
  return { purpose, complexity, scope, confidence: reasons.length > 1 ? 0.9 : 0.7, reasons };
}

export function resolveRoutingLearningStatus(successfulResponseCount: number, eligibleProviderCount: number, automatic: boolean): RoutingLearningStatus {
  if (!automatic) return "manual";
  if (successfulResponseCount < ROUTING_LEARNING_THRESHOLD) return "learning";
  return eligibleProviderCount < 2 ? "readySingleProvider" : "active";
}

export function scoreRoutingCandidate(candidate: ScoredRoutingCandidate, profile: RoutingTaskProfile): number {
  const initial = findInitialModelCapability(candidate.providerId, candidate.modelId);
  const initialScore = initialTaskFitScore(initial, profile.purpose);
  const stats = candidate.stats;
  if (!stats || stats.successCount + stats.requestFailureCount === 0) return initialScore;

  const attempts = stats.successCount + stats.requestFailureCount;
  const reliability = 100 * stats.successCount / attempts;
  const schemaAttempts = stats.successCount + stats.formatFailureCount;
  const schema = schemaAttempts > 0 ? 100 * stats.successCount / schemaAttempts : initial.schemaCompliance;
  const feedbackCount = stats.positiveFeedbackCount + stats.negativeFeedbackCount;
  const feedback = feedbackCount > 0 ? 100 * stats.positiveFeedbackCount / feedbackCount : initialScore;
  const averageLatencyMs = stats.successCount > 0 ? stats.totalLatencyMs / stats.successCount : 30_000;
  const speed = Math.max(0, Math.min(100, 100 - averageLatencyMs / 300));
  const observed = reliability * 0.35 + schema * 0.25 + feedback * 0.25 + speed * 0.15;
  const sampleCount = Math.min(100, attempts + feedbackCount);
  return (initialScore * 10 + observed * sampleCount) / (10 + sampleCount);
}

export function decideAdaptiveRoute(input: {
  candidates: ScoredRoutingCandidate[];
  currentProviderId: RoutingCandidate["providerId"];
  profile: RoutingTaskProfile;
  successfulResponseCount: number;
  turnsSinceSwitch: number;
  allowExploration?: boolean;
}): AdaptiveRoutingDecision {
  const current = input.candidates.find(item => item.providerId === input.currentProviderId) ?? input.candidates[0];
  if (!current) throw new Error("No eligible routing candidates.");
  const status = resolveRoutingLearningStatus(input.successfulResponseCount, input.candidates.length, true);
  const scored = input.candidates.map(candidate => ({ candidate, score: scoreRoutingCandidate(candidate, input.profile) }))
    .sort((a, b) => b.score - a.score || a.candidate.providerId.localeCompare(b.candidate.providerId));
  const currentBaseScore = scoreRoutingCandidate(current, input.profile);
  const currentScore = currentBaseScore + ROUTING_CONTINUITY_BONUS;
  const best = scored[0];
  const explorationAllowed = input.allowExploration !== false && input.profile.complexity !== "high" &&
    input.profile.purpose !== "riskAssessment";
  const explorationDue = status === "active" && input.successfulResponseCount % 5 === 4;
  const debug: AdaptiveRoutingDebug = {
    learningStatus: status,
    learningThreshold: ROUTING_LEARNING_THRESHOLD,
    switchScoreThreshold: ROUTING_SWITCH_SCORE_DELTA,
    minimumTurnsAfterSwitch: ROUTING_MIN_TURNS_AFTER_SWITCH,
    turnsSinceSwitch: input.turnsSinceSwitch,
    explorationDue,
    explorationAllowed,
    candidateScores: scored.map(item => {
      const stats = item.candidate.stats;
      return {
        providerId: item.candidate.providerId,
        modelId: item.candidate.modelId,
        initialScore: roundedScore(initialTaskFitScore(
          findInitialModelCapability(item.candidate.providerId, item.candidate.modelId), input.profile.purpose
        )),
        finalScore: roundedScore(item.score),
        observedAttemptCount: observedAttemptCount(stats),
        successCount: stats?.successCount ?? 0,
        requestFailureCount: stats?.requestFailureCount ?? 0,
        formatFailureCount: stats?.formatFailureCount ?? 0,
        timeoutCount: stats?.timeoutCount ?? 0,
        positiveFeedbackCount: stats?.positiveFeedbackCount ?? 0,
        negativeFeedbackCount: stats?.negativeFeedbackCount ?? 0,
        averageLatencyMs: stats?.successCount ? Math.round(stats.totalLatencyMs / stats.successCount) : undefined
      };
    }),
    continuityBonus: ROUTING_CONTINUITY_BONUS,
    currentBaseScore: roundedScore(currentBaseScore),
    currentAdjustedScore: roundedScore(currentScore),
    bestProviderId: best.candidate.providerId,
    bestScore: roundedScore(best.score)
  };
  if (status === "learning") return { providerId: current.providerId, action: "stay", reasonCode: "learning",
    reason: `学習中 ${input.successfulResponseCount} / ${ROUTING_LEARNING_THRESHOLD} のため、基本プロバイダーを維持します。`, debug };
  if (status === "readySingleProvider") return { providerId: current.providerId, action: "stay", reasonCode: "singleProvider",
    reason: "接続確認済みの候補が1件のため、現在のプロバイダーを維持します。", debug };
  if (input.turnsSinceSwitch < ROUTING_MIN_TURNS_AFTER_SWITCH) return { providerId: current.providerId, action: "stay", reasonCode: "cooldown",
    reason: "切り替え直後のため、現在のプロバイダーを維持します。", debug };

  const exploration = explorationAllowed && explorationDue
    ? input.candidates.filter(candidate => candidate.providerId !== current.providerId && observedAttemptCount(candidate.stats) < 3)
      .sort((a, b) => observedAttemptCount(a.stats) - observedAttemptCount(b.stats) || a.providerId.localeCompare(b.providerId))[0]
    : undefined;
  if (exploration) {
    return { providerId: exploration.providerId, action: "switch", reasonCode: "exploration",
      reason: "低リスクの相談で、実績が少ない接続先を評価するため切り替えます。", debug };
  }

  const delta = best.candidate.providerId === current.providerId ? 0 : best.score - currentScore;
  if (best.candidate.providerId === current.providerId || delta < ROUTING_SWITCH_SCORE_DELTA) {
    return { providerId: current.providerId, action: "stay", reasonCode: "scoreBelowThreshold",
      reason: "候補の適性差が切り替え基準未満のため、現在のプロバイダーを維持します。", score: currentScore, scoreDelta: Math.max(0, delta), debug };
  }
  return { providerId: best.candidate.providerId, action: "switch", reasonCode: "taskFit",
    reason: `${routingPurposeLabel(input.profile.purpose)}への適性が現在の候補より高いため切り替えます。`, score: best.score, scoreDelta: delta, debug };
}

function roundedScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function observedAttemptCount(stats?: RoutingObservedStats): number {
  return stats ? stats.successCount + stats.requestFailureCount : 0;
}

function routingPurposeLabel(purpose: RoutingTaskPurpose): string {
  return { learning: "学習支援", explanation: "説明", implementation: "実装", review: "レビュー",
    riskAssessment: "リスク確認", summarization: "要約" }[purpose];
}
