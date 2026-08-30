import type {
  AdviceMode,
  AiProviderId,
  AssistanceDepth,
  BadFeedbackReason,
  FeedbackRating,
  NavigatorScreen,
  NavigatorViewModel
} from "./types";

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "connect"; providerId?: AiProviderId }
  | { type: "createConversationStream" }
  | { type: "selectConversationStream"; id: string }
  | { type: "deleteConversationStream"; id: string }
  | { type: "ask"; text: string; additionalContext?: string }
  | { type: "cancelGuidanceRequest" }
  | { type: "setMode"; mode: AdviceMode; additionalContext?: string }
  | { type: "setAssistanceDepth"; assistanceDepth: AssistanceDepth }
  | { type: "toggleAutoPause" }
  | { type: "navigate"; screen: NavigatorScreen }
  | { type: "navigateBack" }
  | { type: "saveKnowledge"; id?: string }
  | { type: "rateAdvice"; id: string; rating: FeedbackRating }
  | { type: "submitBadFeedback"; reasons: BadFeedbackReason[]; comment: string }
  | { type: "cancelBadFeedback" }
  | { type: "selectKnowledge"; id: string }
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
  | { type: "setOrcaRouterApiKey"; apiKey: string }
  | { type: "deleteOrcaRouterApiKey" }
  | { type: "refreshOrcaRouterModels" }
  | { type: "refreshRequestPlan" }
  | { type: "openReferencedFile"; path: string; line?: number }
  | { type: "resetSettings" }
  | { type: "searchKnowledge"; query: string }
  | { type: "setAdditionalContext"; additionalContext: string }
  | { type: "setComposerActive"; active: boolean };

export interface SaveSettingsPayload {
  providerId: AiProviderId;
  defaultMode: AdviceMode;
  defaultAssistanceDepth: AssistanceDepth;
  copilotModelId?: string;
  lmStudioModelKey?: string;
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
  "cancelGuidanceRequest",
  "toggleAutoPause",
  "navigateBack",
  "cancelBadFeedback",
  "refreshLmStudioServerStatus",
  "startLmStudioServer",
  "stopLmStudioServer",
  "useLmStudioRunningPort",
  "restartLmStudioOnConfiguredPort",
  "refreshLmStudioModels",
  "deleteOrcaRouterApiKey",
  "refreshOrcaRouterModels",
  "refreshRequestPlan",
  "resetSettings"
]);
const SCREENS = new Set([
  "onboarding", "main", "history", "conversation", "feedback_form",
  "error", "advice_detail", "knowledge", "knowledge_detail", "settings"
]);
const BAD_FEEDBACK_REASONS = new Set(["too_long", "off_topic", "gives_answer", "too_vague", "other"]);

export function parseWebviewMessage(value: unknown): WebviewToExtension | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (SIMPLE_MESSAGE_TYPES.has(value.type)) return { type: value.type } as WebviewToExtension;

  switch (value.type) {
    case "connect":
      return value.providerId === undefined || value.providerId === "copilot" || value.providerId === "lmStudio" || value.providerId === "orcaRouter"
        ? value as WebviewToExtension : undefined;
    case "setOrcaRouterApiKey":
      return isBoundedString(value.apiKey, 9, 500) ? value as WebviewToExtension : undefined;
    case "selectConversationStream":
    case "deleteConversationStream":
    case "selectKnowledge":
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
    case "submitBadFeedback":
      return Array.isArray(value.reasons) && value.reasons.length <= 5 &&
        value.reasons.every((reason) => typeof reason === "string" && BAD_FEEDBACK_REASONS.has(reason)) &&
        isBoundedString(value.comment, 0, 4_000) ? value as WebviewToExtension : undefined;
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
  return (value.providerId === "copilot" || value.providerId === "lmStudio" || value.providerId === "orcaRouter") &&
    (value.defaultMode === "manual" || value.defaultMode === "always") &&
    (value.defaultAssistanceDepth === "low" || value.defaultAssistanceDepth === "high") &&
    isOptionalBoundedString(value.copilotModelId, 200) &&
    isOptionalBoundedString(value.lmStudioModelKey, 500) &&
    isOptionalBoundedString(value.orcaRouterModelId, 500) &&
    isFiniteInRange(value.idleDelaySec, 5, 15) &&
    isFiniteInRange(value.requestIntervalSec, 20, 180) &&
    isFiniteInRange(value.dailyTokenLimit, 0, 1_000_000) &&
    isBoundedString(value.excludeGlobs, 0, 10_000);
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
