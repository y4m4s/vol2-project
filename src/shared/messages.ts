import type { AdviceMode, KnowledgeStatus, NavigatorScreen, NavigatorViewModel } from "./types";

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "connect" }
  | { type: "createConversationStream" }
  | { type: "selectConversationStream"; id: string }
  | { type: "ask"; text: string }
  | { type: "askContext" }
  | { type: "setMode"; mode: AdviceMode }
  | { type: "toggleAutoPause" }
  | { type: "navigate"; screen: NavigatorScreen }
  | { type: "navigateBack" }
  | { type: "openAdviceDetail"; id: string }
  | { type: "deepDive" }
  | { type: "saveKnowledge"; id?: string }
  | { type: "selectKnowledge"; id: string }
  | {
      type: "updateKnowledge";
      id: string;
      title: string;
      summary: string;
      body: string;
      tags: string;
      status: KnowledgeStatus;
    }
  | { type: "toggleKnowledgeStatus"; id: string }
  | { type: "deleteKnowledge"; id: string }
  | { type: "saveSettings"; payload: SaveSettingsPayload }
  | { type: "resetSettings" }
  | { type: "searchKnowledge"; query: string }
  | { type: "filterKnowledge"; filter: string }
  | { type: "exportKnowledge" }
  | { type: "resetKnowledge" };

export interface SaveSettingsPayload {
  defaultMode: AdviceMode;
  requestIntervalSec: number;
  idleDelaySec: number;
  excludeGlobs: string;
}

export type ExtensionToWebview = { type: "updateViewModel"; payload: NavigatorViewModel };
