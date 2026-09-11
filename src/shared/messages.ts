import type {
  AdviceMode,
  AiProviderId,
  AssistanceDepth,
  FeedbackReason,
  FeedbackRating,
  NavigatorScreen,
  NavigatorViewModel
} from "./types";
import { BAD_FEEDBACK_REASONS, GOOD_FEEDBACK_REASONS } from "./feedback";
import type { AutomaticRoutingSettings } from "./types";

export type WebviewToExtension =
  | { type: "setConversationRouting"; mode?: AutomaticRoutingSettings["mode"]; providerId?: AiProviderId }
  | { type: "testRoutingProvider"; providerId: AiProviderId }
  | { type: "setRoutingPin"; providerId?: AiProviderId }
  | { type: "ready" }
  | { type: "connect"; providerId?: AiProviderId }
  | { type: "createConversationStream" }
  | { type: "selectConversationStream"; id: string }
  | { type: "deleteConversationStream"; id: string }
  | { type: "deleteAllConversationStreams" }
  | { type: "ask"; text: string; additionalContext?: string }
  | { type: "cancelGuidanceRequest" }
  | { type: "setMode"; mode: AdviceMode; additionalContext?: string }
  | { type: "setAssistanceDepth"; assistanceDepth: AssistanceDepth }
  | { type: "toggleAutoPause" }
  | { type: "navigate"; screen: NavigatorScreen }
  | { type: "navigateBack" }
  | { type: "saveKnowledge"; id?: string }
  | { type: "rateAdvice"; id: string; rating: FeedbackRating }
  | { type: "submitFeedback"; reasons: FeedbackReason[]; comment: string }
  | { type: "cancelFeedback" }
  | { type: "selectKnowledge"; id: string }
  | { type: "approveKnowledge"; id: string }
  | {
      type: "updateKnowledge";
      id: string;
      title: string;
      summary: string;
      body: string;
    }
  | { type: "deleteKnowledge"; id: string }
  | { type: "saveSettings"; payload: SaveSettingsPayload }
  | { type: "refreshLmStudioServerStatus" }
  | { type: "startLmStudioServer" }
  | { type: "stopLmStudioServer" }
  | { type: "useLmStudioRunningPort" }
  | { type: "restartLmStudioOnConfiguredPort" }
  | { type: "refreshLmStudioModels" }
  | { type: "refreshOllamaModels"; baseUrl: string }
  | { type: "setOrcaRouterApiKey"; apiKey: string }
  | { type: "deleteOrcaRouterApiKey" }
  | { type: "refreshOrcaRouterModels" }
  | { type: "refreshRequestPlan"; userPrompt?: string; additionalContext?: string }
  | { type: "openReferencedFile"; path: string; line?: number }
  | { type: "resetSettings" }
  | { type: "searchKnowledge"; query: string }
  | { type: "setAdditionalContext"; additionalContext: string }
  | { type: "setComposerActive"; active: boolean };

export interface SaveSettingsPayload {
  routing?: AutomaticRoutingSettings;
  providerId: AiProviderId;
  defaultMode: AdviceMode;
  defaultAssistanceDepth: AssistanceDepth;
  copilotModelId?: string;
  lmStudioModelKey?: string;
  ollamaBaseUrl?: string;
  ollamaModelKey?: string;
  orcaRouterModelId?: string;
  idleDelaySec: number;
  requestIntervalSec: number;
  dailyTokenLimit: number;
  excludeGlobs: string;
}

export type ExtensionToWebview =
  | { type: "updateViewModel"; payload: NavigatorViewModel }
  | { type: "operationError"; message: string };

const SIMPLE_MESSAGE_TYPES = new Set([
  "ready",
  "createConversationStream",
  "deleteAllConversationStreams",
  "cancelGuidanceRequest",
  "toggleAutoPause",
  "navigateBack",
  "cancelFeedback",
  "refreshLmStudioServerStatus",
  "startLmStudioServer",
  "stopLmStudioServer",
  "useLmStudioRunningPort",
  "restartLmStudioOnConfiguredPort",
  "refreshLmStudioModels",
  "deleteOrcaRouterApiKey",
  "refreshOrcaRouterModels",
  "resetSettings"
]);
const SCREENS = new Set([
  "onboarding", "main", "history", "conversation", "feedback_form",
  "error", "advice_detail", "knowledge", "knowledge_detail", "settings"
]);
const FEEDBACK_REASONS = new Set<unknown>([...GOOD_FEEDBACK_REASONS, ...BAD_FEEDBACK_REASONS]);

export function parseWebviewMessage(value: unknown): WebviewToExtension | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (SIMPLE_MESSAGE_TYPES.has(value.type)) return { type: value.type } as WebviewToExtension;

  switch (value.type) {
    case "setConversationRouting":
      return (value.mode === undefined || ["manual", "automaticSuggest", "automatic"].includes(String(value.mode))) &&
        (value.providerId === undefined || ["copilot", "orcaRouter", "ollama", "lmStudio"].includes(String(value.providerId))) ? value as WebviewToExtension : undefined;
    case "testRoutingProvider":
      return ["copilot", "orcaRouter", "ollama", "lmStudio"].includes(String(value.providerId)) ? value as WebviewToExtension : undefined;
    case "setRoutingPin":
      return value.providerId === undefined || ["copilot", "orcaRouter", "ollama", "lmStudio"].includes(String(value.providerId)) ? value as WebviewToExtension : undefined;
    case "refreshOllamaModels":
      return isBoundedString(value.baseUrl, 1, 2000) ? value as WebviewToExtension : undefined;
    case "refreshRequestPlan":
      return isOptionalBoundedString(value.userPrompt, 20_000) && isOptionalBoundedString(value.additionalContext, 10_000)
        ? value as WebviewToExtension : undefined;
    case "connect":
      return value.providerId === undefined || value.providerId === "ollama" || value.providerId === "copilot" || value.providerId === "lmStudio" || value.providerId === "orcaRouter"
        ? value as WebviewToExtension : undefined;
    case "setOrcaRouterApiKey":
      return isBoundedString(value.apiKey, 9, 500) ? value as WebviewToExtension : undefined;
    case "selectConversationStream":
    case "deleteConversationStream":
    case "selectKnowledge":
    case "approveKnowledge":
    case "deleteKnowledge":
      return isBoundedString(value.id, 1, 200) ? value as WebviewToExtension : undefined;
    case "ask":
      return isBoundedString(value.text, 0, 20_000) && isOptionalBoundedString(value.additionalContext, 10_000)
        ? value as WebviewToExtension : undefined;
    case "setMode":
      return (value.mode === "manual" || value.mode === "always") && isOptionalBoundedString(value.additionalContext, 10_000)
        ? value as WebviewToExtension : undefined;
    case "setAssistanceDepth":
      return value.assistanceDepth === "low" || value.assistanceDepth === "high" ? value as WebviewToExtension : undefined;
    case "setComposerActive":
      return typeof value.active === "boolean" ? value as WebviewToExtension : undefined;
    case "navigate":
      return typeof value.screen === "string" && SCREENS.has(value.screen) ? value as WebviewToExtension : undefined;
    case "saveKnowledge":
      return value.id === undefined || isBoundedString(value.id, 1, 200) ? value as WebviewToExtension : undefined;
    case "rateAdvice":
      return isBoundedString(value.id, 1, 200) && (value.rating === "good" || value.rating === "bad")
        ? value as WebviewToExtension : undefined;
    case "submitFeedback":
      return Array.isArray(value.reasons) && value.reasons.length >= 1 && value.reasons.length <= 6 &&
        value.reasons.every((reason) => FEEDBACK_REASONS.has(reason)) &&
        isBoundedString(value.comment, 0, 1_000) ? value as WebviewToExtension : undefined;
    case "updateKnowledge":
      return isBoundedString(value.id, 1, 200) && isBoundedString(value.title, 0, 200) &&
        isBoundedString(value.summary, 0, 2_000) && isBoundedString(value.body, 0, 50_000)
        ? value as WebviewToExtension : undefined;
    case "saveSettings":
      return isSaveSettingsPayload(value.payload) ? value as WebviewToExtension : undefined;
    case "searchKnowledge":
      return isBoundedString(value.query, 0, 500) ? value as WebviewToExtension : undefined;
    case "openReferencedFile":
      return isBoundedString(value.path, 1, 2_000) &&
        (value.line === undefined || isFiniteInRange(value.line, 1, 1_000_000))
        ? value as WebviewToExtension : undefined;
    case "setAdditionalContext":
      return isBoundedString(value.additionalContext, 0, 10_000) ? value as WebviewToExtension : undefined;
    default:
      return undefined;
  }
}

function isSaveSettingsPayload(value: unknown): value is SaveSettingsPayload {
  if (!isRecord(value)) return false;
  return (value.routing === undefined || isRoutingSettings(value.routing)) &&
    (value.providerId === "ollama" || value.providerId === "copilot" || value.providerId === "lmStudio" || value.providerId === "orcaRouter") &&
    (value.defaultMode === "manual" || value.defaultMode === "always") &&
    (value.defaultAssistanceDepth === "low" || value.defaultAssistanceDepth === "high") &&
    isOptionalBoundedString(value.copilotModelId, 200) &&
    isOptionalBoundedString(value.lmStudioModelKey, 500) &&
    isOptionalBoundedString(value.ollamaModelKey, 500) &&
    isOptionalBoundedString(value.ollamaBaseUrl, 2000) &&
    isOptionalBoundedString(value.orcaRouterModelId, 500) &&
    isFiniteInRange(value.idleDelaySec, 5, 15) &&
    isFiniteInRange(value.requestIntervalSec, 20, 180) &&
    isFiniteInRange(value.dailyTokenLimit, 0, 1_000_000) &&
    isBoundedString(value.excludeGlobs, 0, 10_000);
}

function isRoutingSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const providers = new Set(["copilot", "orcaRouter", "lmStudio", "ollama"]);
  return ["manual", "automaticSuggest", "automatic"].includes(String(value.mode)) &&
    Array.isArray(value.allowedProviderIds) && value.allowedProviderIds.length <= 4 && value.allowedProviderIds.every(p => providers.has(p)) &&
    (value.preferredProviderId === undefined || (typeof value.preferredProviderId === "string" && providers.has(value.preferredProviderId))) &&
    isFiniteInRange(value.thresholdPercent, 50, 100) && isFiniteInRange(value.dailyCloudTokenSoftLimit, 0, 1_000_000_000) &&
    isFiniteInRange(value.orcaDailyCostSoftLimit, 0, 10000) && isRecord(value.dailyProviderTokenSoftLimits) &&
    Object.entries(value.dailyProviderTokenSoftLimits).every(([p, n]) => providers.has(p) && isFiniteInRange(n, 0, 1_000_000_000)) &&
    ["automatic", "localPreferred", "cloudOnly"].includes(String(value.compressionStrategy)) &&
    (value.localHelperProviderId === undefined || value.localHelperProviderId === "ollama" || value.localHelperProviderId === "lmStudio");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
}

function isOptionalBoundedString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || isBoundedString(value, 0, maxLength);
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
