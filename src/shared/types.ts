export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "consent_pending"
  | "connected"
  | "restricted"
  | "unavailable";

export type AdviceMode = "manual" | "always";

export type AdviceTriggerReason = "text_edit" | "selection_change" | "editor_change" | "diagnostics_change";

export type NavigatorScreen =
  | "onboarding"
  | "main"
  | "history"
  | "conversation"
  | "error"
  | "advice_detail"
  | "knowledge"
  | "knowledge_detail"
  | "settings";

export type RequestState = "idle" | "connecting" | "requesting_guidance" | "saving_knowledge";

export type DiagnosticSeverityLabel = "Error" | "Warning" | "Information" | "Hint";

export type GuidanceKind = "manual" | "context" | "deep_dive" | "always";

export type ConversationRole = "user" | "assistant";

export type ContextCategoryKey = "activeFile" | "selection" | "diagnostics" | "recentEdits" | "relatedSymbols";

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
  recentEditsSummary: string[];
  relatedSymbols: string[];
}

export interface NavigatorSettings {
  defaultMode: AdviceMode;
  requestIntervalMs: number;
  idleDelayMs: number;
  protectedExcludedGlobs: string[];
  excludedGlobs: string[];
}

export interface RequestPlanCategory {
  key: ContextCategoryKey;
  label: string;
  description: string;
  enabled: boolean;
  included: boolean;
  note?: string;
}

export interface RequestPlanFile {
  path: string;
  sizeText: string;
  included: boolean;
  excludedReason?: string;
}

export interface RequestPlanSnapshot {
  kind: GuidanceKind;
  categories: RequestPlanCategory[];
  targetFiles: RequestPlanFile[];
  excludedGlobs: string[];
  estimatedSizeText: string;
}

export interface GuidanceCard {
  id: string;
  requestedAt: string;
  mode: AdviceMode;
  text: string;
  basedOn: NavigatorContextPreview;
  requestPlan: RequestPlanSnapshot;
}

export interface ConversationEntry {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt: string;
  kind: GuidanceKind;
  basedOn?: NavigatorContextPreview;
  mode?: AdviceMode;
  requestPlan?: RequestPlanSnapshot;
}

export interface ConversationStreamListItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
}

export interface NavigatorStatusMessage {
  kind: "info" | "warning" | "error";
  text: string;
}

export interface AutoAdviceState {
  enabled: boolean;
  paused: boolean;
  waitingForIdle: boolean;
  idleRemainingMs: number;
  cooldownRemainingMs: number;
  pendingTriggerReason?: AdviceTriggerReason;
  lastAdviceAt?: string;
}

export interface AdviceDetailViewData {
  id: string;
  adviceBody: string;
  speculativeNote: string;
  referenceFiles: string[];
  diagnosticsSummary: string;
  changeSummary: string;
  canDeepDive: boolean;
}

export interface KnowledgeListItem {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
}

export interface KnowledgeDetailViewData extends KnowledgeListItem {
  body: string;
  createdAt: string;
}

export interface NavigatorSessionState {
  screen: NavigatorScreen;
  screenHistory: NavigatorScreen[];
  connectionState: ConnectionState;
  requestState: RequestState;
  mode: AdviceMode;
  autoAdvice: AutoAdviceState;
  statusMessage?: NavigatorStatusMessage;
  contextPreview: NavigatorContextPreview;
  latestGuidance?: GuidanceCard;
  conversationStreams: ConversationStreamListItem[];
  activeConversationStreamId?: string;
  conversationHistory: ConversationEntry[];
  selectedConversationId?: string;
  knowledgeQuery: string;
  selectedKnowledgeId?: string;
}

export interface NavigatorViewModel {
  screen: NavigatorScreen;
  connectionState: ConnectionState;
  requestState: RequestState;
  mode: AdviceMode;
  canConnect: boolean;
  canAskForGuidance: boolean;
  canSwitchMode: boolean;
  isBusy: boolean;
  autoAdvice: AutoAdviceState;
  statusMessage?: NavigatorStatusMessage;
  contextPreview: NavigatorContextPreview;
  latestGuidance?: GuidanceCard;
  conversationStreams: ConversationStreamListItem[];
  activeConversationStreamId?: string;
  conversationHistory: ConversationEntry[];
  selectedAdvice?: AdviceDetailViewData;
  currentRequestPlan: RequestPlanSnapshot;
  settings: NavigatorSettings;
  knowledgeItems: KnowledgeListItem[];
  selectedKnowledge?: KnowledgeDetailViewData;
  savedKnowledgeSourceIds: string[];
  knowledgeQuery: string;
}
