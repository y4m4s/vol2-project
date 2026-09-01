import { AdviceService } from "../../services/AdviceService";
import { ConnectionService } from "../../services/ConnectionService";
import {
  ConversationRevisionConflictError,
  ConversationStore,
  ConversationStreamRecord,
  DEFAULT_CONVERSATION_STREAM_TITLE,
  StoredConversationEntry
} from "../../services/ConversationStore";
import { SettingsService } from "../../services/SettingsService";
import { UsageMeter } from "../../services/UsageMeter";
import { FeedbackStore } from "../../services/FeedbackStore";
import {
  AiProviderId,
  ConversationEntry,
  GuidanceCard,
  GuidanceContext,
  GuidanceKind,
  NavigatorScreen,
  NavigatorSessionState
} from "../../shared/types";
import { normalizeAdditionalContext } from "../GuidanceInput";

export interface ConversationCoordinatorHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  resolveHomeScreen(): NavigatorScreen;
  resetAutomaticFingerprint(): void;
  createGuidanceCard(entry: ConversationEntry): GuidanceCard;
  getGuidanceAdditionalContext(state: NavigatorSessionState): string | undefined;
  getCurrentProviderId(): AiProviderId;
}

export class ConversationCoordinator {
  private readonly guidanceContexts = new Map<string, GuidanceContext>();
  private readonly summarizedTitleStreamIds = new Set<string>();

  public constructor(
    private readonly store: ConversationStore,
    private readonly feedbackStore: FeedbackStore,
    private readonly adviceService: AdviceService,
    private readonly connectionService: ConnectionService,
    private readonly settingsService: SettingsService,
    private readonly usageMeter: UsageMeter,
    private readonly host: ConversationCoordinatorHost
  ) {}

  public getGuidanceContext(entryId: string): GuidanceContext | undefined {
    return this.guidanceContexts.get(entryId);
  }

  public setGuidanceContext(entryId: string, context: GuidanceContext): void {
    this.guidanceContexts.set(entryId, context);
  }

  public async restore(): Promise<void> {
    const existingStream = this.resolveInitialStream();
    if (!existingStream) {
      this.host.patchSession({
        conversationStreams: this.store.list(),
        activeConversationStreamId: undefined,
        latestGuidance: undefined,
        conversationHistory: [],
        selectedConversationId: undefined
      });
      return;
    }
    this.hydrate({ ...existingStream, additionalContext: undefined });
  }

  public async createStream(): Promise<void> {
    if (this.host.getState().requestState !== "idle") return;
    await this.discardActiveIfEmpty();
    const record = await this.store.createStream();
    await this.store.setActiveStream(record.id);
    this.host.resetAutomaticFingerprint();
    this.hydrate(record, { screen: "conversation", resetNavigation: true, clearStatusMessage: true });
  }

  public async selectStream(streamId: string): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle" || (state.activeConversationStreamId === streamId && state.screen === "conversation")) return;
    const record = this.store.get(streamId);
    if (!record) return;
    await this.store.setActiveStream(record.id);
    this.host.resetAutomaticFingerprint();
    this.hydrate(record, { screen: "conversation", resetNavigation: true, clearStatusMessage: true });
  }

  public async deleteStream(streamId: string): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle") return;
    const deletingActiveStream = state.activeConversationStreamId === streamId;
    const deletingRecord = this.store.get(streamId);
    const deleted = await this.store.deleteStream(streamId);
    if (!deleted) {
      this.host.patchSession({ conversationStreams: this.store.list() });
      return;
    }

    let feedbackCleanupFailed = false;
    try {
      await this.feedbackStore.deleteByConversationEntryIds(deletingRecord?.entries.map((entry) => entry.id) ?? []);
    } catch (error) {
      feedbackCleanupFailed = true;
      console.error("Failed to delete feedback associated with conversation", error);
    }

    this.summarizedTitleStreamIds.delete(streamId);
    if (deletingActiveStream) this.guidanceContexts.clear();
    this.host.patchSession({
      conversationStreams: this.store.list(),
      statusMessage: feedbackCleanupFailed
        ? { kind: "warning", text: "履歴は削除しましたが、関連する評価データの削除に失敗しました。" }
        : undefined,
      ...(deletingActiveStream
        ? {
            activeConversationStreamId: undefined,
            activeAdditionalContext: undefined,
            latestGuidance: undefined,
            conversationHistory: [],
            selectedConversationId: undefined,
            screenHistory: state.screenHistory.filter((screen) => screen !== "conversation" && screen !== "advice_detail"),
            screen: state.screen === "conversation" ? this.host.resolveHomeScreen() : state.screen
          }
        : {})
    });
  }

  public async prepareForGuidance(state: NavigatorSessionState, kind: GuidanceKind): Promise<NavigatorSessionState> {
    if (kind === "always") {
      return state.screen === "main" ? this.createNewActiveStream() : this.ensureActiveStream();
    }
    if (state.screen === "main") return this.createNewActiveStream();
    if (state.activeConversationStreamId) return state;
    return this.ensureActiveStream();
  }

  public async persist(options: { summarizeTitle?: boolean } = {}): Promise<void> {
    const record = this.buildActiveRecord();
    if (!record) return;
    if (record.entries.length === 0) {
      await this.store.deleteStream(record.id);
      this.host.patchSession({
        activeConversationStreamId: undefined,
        activeAdditionalContext: undefined,
        conversationStreams: this.store.list(),
        latestGuidance: undefined,
        conversationHistory: [],
        selectedConversationId: undefined
      });
      return;
    }

    const recordToSave = options.summarizeTitle === false ? record : await this.withSummarizedTitle(record);
    let saved: ConversationStreamRecord;
    try {
      saved = await this.store.saveStream(recordToSave);
    } catch (error) {
      if (!(error instanceof ConversationRevisionConflictError)) throw error;
      const latestRecord = this.buildActiveRecord();
      if (!latestRecord || latestRecord.id !== record.id) return;
      saved = await this.store.saveStream({ ...latestRecord, title: recordToSave.title });
    }
    this.host.patchSession({
      activeConversationStreamId: saved.id,
      activeAdditionalContext: saved.additionalContext,
      conversationStreams: this.store.list()
    });
  }

  public async discardActiveIfEmpty(): Promise<void> {
    const state = this.host.getState();
    const streamId = state.activeConversationStreamId ?? this.store.getActiveStreamId();
    if (!streamId) return;
    const existing = this.store.get(streamId);
    if (!existing || existing.entries.length > 0) return;
    if (state.activeConversationStreamId === streamId && state.conversationHistory.length > 0) return;

    await this.store.deleteStream(streamId);
    if (state.activeConversationStreamId === streamId) {
      this.host.patchSession({
        activeConversationStreamId: undefined,
        activeAdditionalContext: undefined,
        conversationStreams: this.store.list(),
        latestGuidance: undefined,
        conversationHistory: [],
        selectedConversationId: undefined
      });
    }
  }

  private resolveInitialStream(): ConversationStreamRecord | undefined {
    const activeStreamId = this.store.getActiveStreamId();
    if (activeStreamId) {
      const activeStream = this.store.get(activeStreamId);
      if (activeStream) return activeStream;
    }
    const latestStream = this.store.list()[0];
    return latestStream ? this.store.get(latestStream.id) : undefined;
  }

  private async createNewActiveStream(): Promise<NavigatorSessionState> {
    const additionalContext = this.host.getGuidanceAdditionalContext(this.host.getState());
    await this.discardActiveIfEmpty();
    const record = await this.store.createStream();
    await this.store.setActiveStream(record.id);
    this.host.resetAutomaticFingerprint();
    this.hydrate({ ...record, additionalContext });
    return this.host.getState();
  }

  private async ensureActiveStream(): Promise<NavigatorSessionState> {
    const state = this.host.getState();
    if (state.activeConversationStreamId) return state;
    const existingStream = this.resolveInitialStream();
    if (existingStream) {
      await this.store.setActiveStream(existingStream.id);
      this.hydrate(existingStream);
      return this.host.getState();
    }
    const record = await this.store.createStream();
    await this.store.setActiveStream(record.id);
    this.host.resetAutomaticFingerprint();
    this.hydrate(record);
    return this.host.getState();
  }

  private hydrate(
    record: ConversationStreamRecord,
    options: { screen?: NavigatorScreen; resetNavigation?: boolean; clearStatusMessage?: boolean } = {}
  ): void {
    this.guidanceContexts.clear();
    const conversationHistory = this.toConversationHistory(record.entries);
    const latestAssistant = [...conversationHistory].reverse().find((entry) => entry.role === "assistant");
    this.host.patchSession({
      conversationStreams: this.store.list(),
      activeConversationStreamId: record.id,
      activeAdditionalContext: record.additionalContext,
      latestGuidance: latestAssistant ? this.host.createGuidanceCard(latestAssistant) : undefined,
      conversationHistory,
      selectedConversationId: undefined,
      ...(options.screen ? { screen: options.screen } : {}),
      ...(options.resetNavigation ? { screenHistory: [] } : {}),
      ...(options.clearStatusMessage ? { statusMessage: undefined } : {})
    });
  }

  private async withSummarizedTitle(record: ConversationStreamRecord): Promise<ConversationStreamRecord> {
    if (this.summarizedTitleStreamIds.has(record.id) || this.connectionService.getState() !== "connected") return record;
    const settings = this.settingsService.getSettings();
    if (this.usageMeter.isTokenLimitExceeded(this.host.getCurrentProviderId(), settings.dailyTokenLimit)) return record;
    const fallbackTitle = this.resolveTitle(undefined, record.entries);
    if (record.title && record.title !== DEFAULT_CONVERSATION_STREAM_TITLE && record.title !== fallbackTitle) return record;
    const title = await this.adviceService.createConversationTitle({ entries: record.entries });
    if (!title) return record;
    this.summarizedTitleStreamIds.add(record.id);
    return { ...record, title };
  }

  private buildActiveRecord(): ConversationStreamRecord | undefined {
    const state = this.host.getState();
    const streamId = state.activeConversationStreamId;
    if (!streamId) return undefined;
    const existing = this.store.get(streamId);
    const now = new Date().toISOString();
    return {
      id: streamId,
      title: this.resolveTitle(existing?.title, state.conversationHistory),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
      entries: state.conversationHistory.map((entry) => ({
        ...entry,
        guidanceContext: this.guidanceContexts.get(entry.id)
      })),
      additionalContext: normalizeAdditionalContext(state.activeAdditionalContext),
      revision: existing?.revision ?? 0
    };
  }

  private toConversationHistory(entries: StoredConversationEntry[]): ConversationEntry[] {
    return entries.map((entry) => {
      if (entry.guidanceContext) this.guidanceContexts.set(entry.id, entry.guidanceContext);
      const { guidanceContext: _guidanceContext, ...conversationEntry } = entry;
      return conversationEntry;
    });
  }

  private resolveTitle(currentTitle: string | undefined, history: ConversationEntry[]): string {
    if (currentTitle && currentTitle !== DEFAULT_CONVERSATION_STREAM_TITLE) return currentTitle;
    for (const entry of history) {
      const candidate = entry.role === "user" && entry.kind === "manual"
        ? normalizeTitle(entry.text)
        : entry.role === "user" && entry.kind === "context"
          ? normalizeTitle(entry.basedOn?.selectedTextPreview)
          : entry.role === "assistant"
            ? normalizeTitle(entry.text)
            : undefined;
      if (candidate) return candidate;
    }
    return currentTitle ?? DEFAULT_CONVERSATION_STREAM_TITLE;
  }
}

function normalizeTitle(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const firstMeaningfulLine = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").trim())
    .find((line) => line.length > 0);
  if (!firstMeaningfulLine) return undefined;
  return firstMeaningfulLine.length <= 60 ? firstMeaningfulLine : `${firstMeaningfulLine.slice(0, 60)}...`;
}
