import type { AiProviderId, AutomaticRoutingSettings } from "../shared/types";

export const PROVIDER_IDS: AiProviderId[] = ["copilot", "orcaRouter", "lmStudio", "ollama"];
export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  copilot: "GitHub Copilot", orcaRouter: "OrcaRouter", lmStudio: "LM Studio", ollama: "Ollama"
};
export function normalizeRoutingSettings(value: unknown): AutomaticRoutingSettings {
  const v = value && typeof value === "object" ? value as Partial<AutomaticRoutingSettings> : {};
  const finite = (n: unknown, fallback = 0, max = 1_000_000_000): number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(max, n) : fallback;
  return {
    mode: v.mode === "automatic" || v.mode === "automaticSuggest" ? v.mode : "manual",
    allowedProviderIds: PROVIDER_IDS.filter(p => Array.isArray(v.allowedProviderIds) && v.allowedProviderIds.includes(p)),
    preferredProviderId: PROVIDER_IDS.includes(v.preferredProviderId!) ? v.preferredProviderId : undefined,
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
  const preferredProviderId = routing.preferredProviderId && allowedProviderIds.includes(routing.preferredProviderId)
    ? routing.preferredProviderId
    : currentProviderIsAvailable
      ? currentProviderId
      : allowedProviderIds[0];

  return { ...routing, mode, allowedProviderIds, preferredProviderId };
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
export interface ProviderRoute {
  action: "stay" | "suggest" | "switch" | "stop";
  providerId?: AiProviderId;
  currentEligible: boolean;
  reason: string;
}
export function decideProviderRoute(
  settings: AutomaticRoutingSettings, candidates: RoutingCandidate[], current: AiProviderId,
  estimatedInputTokens: number, localOnly = false, pinned = false
): ProviderRoute {
  const cloud = (p: AiProviderId): boolean => p === "copilot" || p === "orcaRouter";
  const cloudUsage = candidates.filter(c => cloud(c.providerId)).reduce((sum, c) => sum + c.usedTokens, 0);
  const near = (used: number, limit: number): boolean => limit > 0 && used >= limit * settings.thresholdPercent / 100;
  const eligible = (c: RoutingCandidate): boolean => c.available && c.maxInputTokens >= estimatedInputTokens &&
    (!localOnly || c.verifiedLocal === true) && (settings.mode === "manual" || settings.allowedProviderIds.includes(c.providerId));
  const underBudget = (c: RoutingCandidate): boolean => !near(c.usedTokens, c.tokenLimit) &&
    !(cloud(c.providerId) && near(cloudUsage, settings.dailyCloudTokenSoftLimit)) &&
    !(c.providerId === "orcaRouter" && settings.orcaDailyCostSoftLimit > 0 &&
      (c.costUsd === undefined || near(c.costUsd, settings.orcaDailyCostSoftLimit)));
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
  return { action: settings.mode === "automaticSuggest" ? "suggest" : "switch", providerId: next.providerId, currentEligible, reason };
}

export async function executeProviderRoute(
  route: ProviderRoute, confirm: () => Promise<boolean>, activate: (provider: AiProviderId) => Promise<boolean>
): Promise<boolean> {
  if (route.action === "stop") return false;
  if (route.action === "stay") return true;
  if (route.action === "suggest" && !await confirm()) return route.currentEligible;
  return route.providerId !== undefined && await activate(route.providerId);
}
