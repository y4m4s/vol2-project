export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "restricted"
  | "unavailable";

export type AdviceMode = "manual" | "always";

export interface NavigatorContextSnapshot {
  activeFilePath?: string;
  selectedText?: string;
  diagnosticsSummary: string[];
  relatedSymbols: string[];
  recentEditsSummary: string[];
}

export interface NavigatorViewState {
  connectionState: ConnectionState;
  mode: AdviceMode;
  statusMessage: string;
  contextPreview: NavigatorContextSnapshot;
}
