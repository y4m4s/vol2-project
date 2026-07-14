import type { AdviceMode, AiProviderId, AssistanceDepth, NavigatorScreen, NavigatorViewModel } from "./types";

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
  | { type: "refreshLmStudioModels" }
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
  idleDelaySec: number;
  requestIntervalSec: number;
  dailyBudgetUsd: number;
  excludeGlobs: string;
}

export type ExtensionToWebview = { type: "updateViewModel"; payload: NavigatorViewModel };
