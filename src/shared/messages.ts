import type { AdviceMode, NavigatorScreen, NavigatorViewModel } from "./types";

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "connect" }
  | { type: "ask"; text: string }
  | { type: "askContext" }
  | { type: "setMode"; mode: AdviceMode }
  | { type: "toggleAutoPause" }
  | { type: "navigate"; screen: NavigatorScreen }
  | { type: "navigateBack" }
  | { type: "openAdviceDetail"; id: string }
  | { type: "deepDive" }
  | { type: "saveKnowledge" }
  | { type: "saveSettings"; payload: SaveSettingsPayload }
  | { type: "resetSettings" }
  | { type: "searchKnowledge"; query: string }
  | { type: "filterKnowledge"; filter: string }
  | { type: "exportKnowledge" }
  | { type: "resetKnowledge" };

export interface SaveSettingsPayload {
  defaultMode: AdviceMode;
  alwaysModeEnabled: boolean;
  requestIntervalSec: number;
  idleDelaySec: number;
  suppressDuplicate: boolean;
  ctxActiveFile: boolean;
  ctxSelection: boolean;
  ctxDiagnostics: boolean;
  ctxRecentEdits: boolean;
  ctxSymbols: boolean;
  excludeGlobs: string;
}

export type ExtensionToWebview = { type: "updateViewModel"; payload: NavigatorViewModel };
