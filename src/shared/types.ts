export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "consent_pending"
  | "connected"
  | "restricted"
  | "unavailable";

export type AiProviderId = "copilot" | "lmStudio";

export type AdviceMode = "manual" | "always";

export type AssistanceDepth = "low" | "high";

// SlashCommand の実体は skills.ts のレジストリ（SKILLS）から導出される。
// 互換のためここから再エクスポートする。コマンドの追加は skills.ts のみで完結する。
import type { SlashCommand } from "./skills";
export type { SlashCommand };

export type SlashCommandScope = "standard" | "deep";

export type ProjectContextScope = "project-lite" | "project" | "deep";

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

export type GuidanceKind = "manual" | "context" | "always";

export type ConversationRole = "user" | "assistant";

export type ContextCategoryKey =
  | "activeFile"
  | "selection"
  | "diagnostics"
  | "recentEdits"
  | "relatedSymbols"
  | "workspaceTree"
  | "referencedFiles"
  | "projectSummary"
  | "additionalContext";

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

export type ReferencedFileReason =
  | "open"
  | "diagnostic"
  | "recentEdit"
  | "sameDirectory"
  | "workspace";

export interface ReferencedFileContext {
  path: string;
  languageId?: string;
  reason: ReferencedFileReason;
  excerpt?: string;
  diagnosticsSummary: DiagnosticSummary[];
  recentEditsSummary: string[];
  score: number;
}

export interface WorkspaceTreeContext {
  rootPath: string;
  treeText: string;
  truncated: boolean;
}

export interface ProjectContextSummary {
  scope: ProjectContextScope;
  openFiles: string[];
  diagnosticsSummary: string[];
  recentEditsSummary: string[];
  todoSummary: string[];
  manifestSummary: string[];
  docsSummary: string[];
}

export interface GuidanceContext {
  activeFilePath?: string;
  activeFileLanguage?: string;
  activeFileExcerpt?: string;
  selectedText?: string;
  workspaceTree?: WorkspaceTreeContext;
  referencedFiles: ReferencedFileContext[];
  diagnosticsSummary: DiagnosticSummary[];
  recentEditsSummary: string[];
  relatedSymbols: string[];
  projectSummary?: ProjectContextSummary;
  additionalContext?: string;
}

export interface NavigatorSettings {
  providerId: AiProviderId;
  defaultMode: AdviceMode;
  defaultAssistanceDepth: AssistanceDepth;
  copilotModelId?: string;
  lmStudioBaseUrl: string;
  lmStudioModelKey?: string;
  requestIntervalMs: number;
  idleDelayMs: number;
  dailyBudgetUsd: number;
  protectedExcludedGlobs: string[];
  excludedGlobs: string[];
}

export interface CopilotModelOption {
  id: string;
  label: string;
  tokenLimitText: string;
}

export interface UsageTodayViewData {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostText: string;
  blendedPricePerMTokenUsd: number;
  budgetUsd: number;
  budgetExceeded: boolean;
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
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
  categories: RequestPlanCategory[];
  targetFiles: RequestPlanFile[];
  excludedGlobs: string[];
  estimatedSizeText: string;
}

export interface GuidanceCard {
  id: string;
  requestedAt: string;
  mode: AdviceMode;
  assistanceDepth: AssistanceDepth;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
  providerId?: AiProviderId;
  modelId?: string;
  modelLabel?: string;
  text: string;
  basedOn: NavigatorContextPreview;
  requestPlan: RequestPlanSnapshot;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ConversationEntry {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt: string;
  kind: GuidanceKind;
  basedOn?: NavigatorContextPreview;
  mode?: AdviceMode;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
  providerId?: AiProviderId;
  modelId?: string;
  modelLabel?: string;
  requestPlan?: RequestPlanSnapshot;
  tokenUsage?: TokenUsage;
}

export interface ConversationStreamListItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
  additionalContext?: string;
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

export interface KnowledgeListItem {
  id: string;
  title: string;
  summary: string;
  providerId?: AiProviderId;
  modelId?: string;
  modelLabel?: string;
  updatedAt: string;
}

export interface KnowledgeDetailViewData extends KnowledgeListItem {
  body: string;
  createdAt: string;
  sourceConversation?: ConversationStreamListItem;
  sourceConversationDeleted?: boolean;
}

export interface NavigatorSessionState {
  screen: NavigatorScreen;
  screenHistory: NavigatorScreen[];
  connectionState: ConnectionState;
  requestState: RequestState;
  mode: AdviceMode;
  assistanceDepth: AssistanceDepth;
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
  activeAdditionalContext?: string;
  pendingAdditionalContext?: string;
}

export interface NavigatorViewModel {
  screen: NavigatorScreen;
  connectionState: ConnectionState;
  requestState: RequestState;
  mode: AdviceMode;
  assistanceDepth: AssistanceDepth;
  canConnect: boolean;
  canAskForGuidance: boolean;
  canSwitchMode: boolean;
  canSwitchAssistanceDepth: boolean;
  isBusy: boolean;
  autoAdvice: AutoAdviceState;
  usageToday: UsageTodayViewData;
  providerId: AiProviderId;
  modelLabel?: string;
  copilotModelOptions: CopilotModelOption[];
  statusMessage?: NavigatorStatusMessage;
  contextPreview: NavigatorContextPreview;
  latestGuidance?: GuidanceCard;
  conversationStreams: ConversationStreamListItem[];
  activeConversationStreamId?: string;
  activeAdditionalContext?: string;
  conversationHistory: ConversationEntry[];
  currentRequestPlan: RequestPlanSnapshot;
  settings: NavigatorSettings;
  knowledgeItems: KnowledgeListItem[];
  selectedKnowledge?: KnowledgeDetailViewData;
  savedKnowledgeSourceIds: string[];
  knowledgeQuery: string;
}
