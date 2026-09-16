import type { AiProviderId, AutomaticRoutingSettings } from "./types";

export const PROVIDER_IDS: AiProviderId[] = ["copilot", "orcaRouter", "lmStudio", "ollama"];
export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  copilot: "GitHub Copilot", orcaRouter: "OrcaRouter", lmStudio: "LM Studio", ollama: "Ollama"
};

export function normalizeRoutingSettings(value: unknown): AutomaticRoutingSettings {
  const v = value && typeof value === "object" ? value as Partial<AutomaticRoutingSettings> : {};
  const finite = (n: unknown, fallback = 0, max = 1_000_000_000): number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(max, n) : fallback;
  const allowedProviderIds = PROVIDER_IDS.filter(p =>
    Array.isArray(v.allowedProviderIds) && v.allowedProviderIds.includes(p)
  );
  return {
    // 廃止した提案型（automaticSuggest）は、意図しない自動切り替えを避けるため手動へ戻す。
    mode: v.mode === "automatic" ? "automatic" : "manual",
    allowedProviderIds,
    preferredProviderId: allowedProviderIds.includes(v.preferredProviderId!) ? v.preferredProviderId : undefined,
    thresholdPercent: Math.max(50, finite(v.thresholdPercent, 90, 100)),
    dailyProviderTokenSoftLimits: Object.fromEntries(PROVIDER_IDS.map(p => [p, finite(v.dailyProviderTokenSoftLimits?.[p], p === "copilot" || p === "orcaRouter" ? 100000 : 0)])),
    dailyCloudTokenSoftLimit: finite(v.dailyCloudTokenSoftLimit),
    orcaDailyCostSoftLimit: finite(v.orcaDailyCostSoftLimit, 0, 10000),
    compressionStrategy: v.compressionStrategy === "localPreferred" || v.compressionStrategy === "cloudOnly" ? v.compressionStrategy : "automatic",
    localHelperProviderId: v.localHelperProviderId === "ollama" || v.localHelperProviderId === "lmStudio" ? v.localHelperProviderId : undefined
  };
}

export function applyRoutingModeSelection(
  value: AutomaticRoutingSettings,
  mode: AutomaticRoutingSettings["mode"],
  currentProviderId: AiProviderId,
  testedProviderIds: readonly AiProviderId[]
): AutomaticRoutingSettings {
  const routing = normalizeRoutingSettings(value);
  if (mode === "manual") return { ...routing, mode };

  const currentProviderIsAvailable = testedProviderIds.includes(currentProviderId);
  const allowedProviderIds = currentProviderIsAvailable && !routing.allowedProviderIds.includes(currentProviderId)
    ? [...routing.allowedProviderIds, currentProviderId]
    : routing.allowedProviderIds;
  const preferredProviderId = routing.preferredProviderId
    ?? (currentProviderIsAvailable
      ? currentProviderId
      : allowedProviderIds[0]);

  return { ...routing, mode, allowedProviderIds, preferredProviderId };
}

export function toggleRoutingProviderSelection(
  value: AutomaticRoutingSettings,
  providerId: AiProviderId
): AutomaticRoutingSettings {
  const routing = normalizeRoutingSettings(value);
  const allowedProviderIds = routing.allowedProviderIds.includes(providerId)
    ? routing.allowedProviderIds.filter(id => id !== providerId)
    : [...routing.allowedProviderIds, providerId];
  const preferredProviderId = routing.preferredProviderId && allowedProviderIds.includes(routing.preferredProviderId)
    ? routing.preferredProviderId
    : allowedProviderIds[0];
  return { ...routing, allowedProviderIds, preferredProviderId };
}

export function routingConnectionProviderIds(value: AutomaticRoutingSettings): AiProviderId[] {
  return normalizeRoutingSettings(value).allowedProviderIds;
}

export function selectableBasicProviderIds(
  value: AutomaticRoutingSettings,
  localProvidersWithModels: readonly AiProviderId[]
): AiProviderId[] {
  const routing = normalizeRoutingSettings(value);
  return routingConnectionProviderIds(routing).filter(providerId =>
    (providerId !== "lmStudio" && providerId !== "ollama") || localProvidersWithModels.includes(providerId)
  );
}

export interface RoutingCandidate {
  providerId: AiProviderId;
  available: boolean;
  usedTokens: number;
  tokenLimit: number;
  maxInputTokens: number;
  costUsd?: number;
  verifiedLocal?: boolean;
}

export type RoutingCandidateExclusionReason =
  | "unavailable"
  | "contextLimit"
  | "localOnly"
  | "notAllowed"
  | "providerTokenLimit"
  | "providerSoftLimit"
  | "cloudSoftLimit"
  | "orcaCostLimit";

export interface RoutingCandidateEligibility {
  eligible: boolean;
  exclusionReasons: RoutingCandidateExclusionReason[];
}

export interface ProviderRoute {
  action: "stay" | "switch" | "stop";
  providerId?: AiProviderId;
  currentEligible: boolean;
  reason: string;
}

export function eligibleRoutingCandidates(
  settings: AutomaticRoutingSettings,
  candidates: RoutingCandidate[],
  estimatedInputTokens: number,
  localOnly = false
): RoutingCandidate[] {
  return candidates.filter(candidate =>
    evaluateRoutingCandidateEligibility(settings, candidates, candidate, estimatedInputTokens, localOnly).eligible
  );
}

export function evaluateRoutingCandidateEligibility(
  settings: AutomaticRoutingSettings,
  candidates: RoutingCandidate[],
  candidate: RoutingCandidate,
  estimatedInputTokens: number,
  localOnly = false
): RoutingCandidateEligibility {
  const cloud = (p: AiProviderId): boolean => p === "copilot" || p === "orcaRouter";
  const cloudUsage = candidates.filter(c => cloud(c.providerId)).reduce((sum, c) => sum + c.usedTokens, 0);
  const near = (used: number, limit: number): boolean => limit > 0 && used >= limit * settings.thresholdPercent / 100;
  const exclusionReasons: RoutingCandidateExclusionReason[] = [];
  if (!candidate.available) exclusionReasons.push("unavailable");
  if (candidate.maxInputTokens < estimatedInputTokens) exclusionReasons.push("contextLimit");
  if (localOnly && candidate.verifiedLocal !== true) exclusionReasons.push("localOnly");
  if (settings.mode !== "manual" && !settings.allowedProviderIds.includes(candidate.providerId)) exclusionReasons.push("notAllowed");
  if (near(candidate.usedTokens, candidate.tokenLimit)) exclusionReasons.push("providerTokenLimit");
  if (near(candidate.usedTokens, settings.dailyProviderTokenSoftLimits[candidate.providerId] ?? 0)) exclusionReasons.push("providerSoftLimit");
  if (cloud(candidate.providerId) && near(cloudUsage, settings.dailyCloudTokenSoftLimit)) exclusionReasons.push("cloudSoftLimit");
  if (candidate.providerId === "orcaRouter" && settings.orcaDailyCostSoftLimit > 0 &&
    (candidate.costUsd === undefined || near(candidate.costUsd, settings.orcaDailyCostSoftLimit))) {
    exclusionReasons.push("orcaCostLimit");
  }
  return { eligible: exclusionReasons.length === 0, exclusionReasons };
}

export function decideProviderRoute(
  settings: AutomaticRoutingSettings, candidates: RoutingCandidate[], current: AiProviderId,
  estimatedInputTokens: number, localOnly = false, pinned = false
): ProviderRoute {
  const eligible = (c: RoutingCandidate): boolean => c.available && c.maxInputTokens >= estimatedInputTokens &&
    (!localOnly || c.verifiedLocal === true) && (settings.mode === "manual" || settings.allowedProviderIds.includes(c.providerId));
  const underBudgetIds = new Set(eligibleRoutingCandidates(settings, candidates, estimatedInputTokens, localOnly).map(c => c.providerId));
  const underBudget = (c: RoutingCandidate): boolean => underBudgetIds.has(c.providerId);
  const active = candidates.find(c => c.providerId === current);
  const currentEligible = Boolean(active && eligible(active));
  if (settings.mode === "manual" || pinned) return {
    action: currentEligible ? "stay" : "stop", providerId: current, currentEligible,
    reason: currentEligible ? "この相談の接続先を維持します。" : "固定された接続先では送信条件を満たせません。"
  };
  if (active && currentEligible && underBudget(active)) return {
    action: "stay", providerId: current, currentEligible, reason: "現在のプロバイダーで作業を継続します。"
  };
  const next = [...candidates].sort((a, b) => Number(b.providerId === settings.preferredProviderId) - Number(a.providerId === settings.preferredProviderId))
    .find(c => c.providerId !== current && eligible(c) && underBudget(c));
  const reason = currentEligible ? "NaviComで設定・記録した利用上限に近づいています。" : "現在の接続先では利用可能性・入力上限・送信条件を満たせません。";
  if (!next) return { action: "stop", currentEligible, reason: `${reason} 利用可能な許可候補がありません。` };
  return { action: "switch", providerId: next.providerId, currentEligible, reason };
}

export async function executeProviderRoute(
  route: ProviderRoute, activate: (provider: AiProviderId) => Promise<boolean>
): Promise<boolean> {
  if (route.action === "stop") return false;
  if (route.action === "stay") return true;
  return route.providerId !== undefined && await activate(route.providerId);
}
