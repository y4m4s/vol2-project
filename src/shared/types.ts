export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "consent_pending"
  | "connected"
  | "restricted"
  | "unavailable";

export type AdviceMode = "manual" | "always";

export type NavigatorScreen = "onboarding" | "main" | "error";

export type RequestState = "idle" | "connecting" | "requesting_guidance";

export type DiagnosticSeverityLabel = "Error" | "Warning" | "Information" | "Hint";

export interface DiagnosticSummary {
  severity: DiagnosticSeverityLabel;
  message: string;
  source?: string;
  line: number;
}

export interface NavigatorContextPreview {
  activeFilePath?: string;
  selectedTextPreview?: string;
  diagnosticsSummary: DiagnosticSummary[];
}

export interface GuidanceContext {
  activeFilePath?: string;
  activeFileLanguage?: string;
  activeFileExcerpt?: string;
  selectedText?: string;
  diagnosticsSummary: DiagnosticSummary[];
}

export interface GuidanceCard {
  requestedAt: string;
  mode: AdviceMode;
  text: string;
  basedOn: NavigatorContextPreview;
}

export interface NavigatorStatusMessage {
  kind: "info" | "warning" | "error";
  text: string;
}

export interface NavigatorSessionState {
  screen: NavigatorScreen;
  connectionState: ConnectionState;
  requestState: RequestState;
  mode: AdviceMode;
  statusMessage?: NavigatorStatusMessage;
  contextPreview: NavigatorContextPreview;
  latestGuidance?: GuidanceCard;
}

export interface NavigatorViewModel {
  screen: NavigatorScreen;
  connectionState: ConnectionState;
  mode: AdviceMode;
  canConnect: boolean;
  canAskForGuidance: boolean;
  canSwitchMode: boolean;
  isBusy: boolean;
  statusMessage?: NavigatorStatusMessage;
  contextPreview: NavigatorContextPreview;
  latestGuidance?: GuidanceCard;
}
