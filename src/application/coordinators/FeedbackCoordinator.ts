import { AdviceService } from "../../services/AdviceService";
import { FeedbackStore } from "../../services/FeedbackStore";
import {
  AdviceFeedbackInput,
  BadFeedbackReason,
  ConversationEntry,
  FeedbackRating,
  GuidanceCard,
  NavigatorSessionState
} from "../../shared/types";

export interface FeedbackCoordinatorHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  pushFeedbackForm(): void;
  navigateBack(): void;
  createGuidanceCard(entry: ConversationEntry): GuidanceCard;
  persistConversation(): Promise<void>;
}

export class FeedbackCoordinator {
  private readonly persistingEntryIds = new Set<string>();

  public constructor(
    private readonly feedbackStore: FeedbackStore,
    private readonly adviceService: AdviceService,
    private readonly host: FeedbackCoordinatorHost
  ) {}

  public async rateAdvice(conversationEntryId: string, rating: FeedbackRating): Promise<void> {
    if (rating !== "good" && rating !== "bad") return;
    const state = this.host.getState();
    if (state.requestState !== "idle") return;
    const entry = findAssistantEntry(state, conversationEntryId);
    if (!entry || entry.feedback) return;

    if (rating === "bad") {
      this.host.patchSession({ pendingFeedbackEntryId: conversationEntryId, statusMessage: undefined });
      this.host.pushFeedbackForm();
      return;
    }

    const input = { conversationEntryId, rating: "good" } satisfies AdviceFeedbackInput;
    const feedbackId = await this.persistFeedbackAndMark(input, entry);
    if (feedbackId) {
      this.host.patchSession({ requestState: "idle" });
      void this.summarizeAndUpdate(feedbackId, input, entry)
        .catch((error) => console.error("Failed to summarize good feedback", error));
    }
  }

  public async submitBadFeedback(reasons: BadFeedbackReason[], comment: string): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle") return;
    const conversationEntryId = state.pendingFeedbackEntryId;
    if (!conversationEntryId) {
      this.host.navigateBack();
      return;
    }
    const entry = findAssistantEntry(state, conversationEntryId);
    if (!entry || entry.feedback) {
      this.cancelBadFeedback();
      return;
    }

    const input: AdviceFeedbackInput = {
      conversationEntryId,
      rating: "bad",
      reasons: [...new Set(reasons.filter(isBadFeedbackReason))],
      comment: comment.trim().slice(0, 1000)
    };
    const feedbackId = await this.persistFeedbackAndMark(input, entry);
    if (!feedbackId) return;
    this.returnFromForm();
    void this.summarizeAndUpdate(feedbackId, input, entry)
      .catch((error) => console.error("Failed to summarize bad feedback", error));
  }

  public cancelBadFeedback(): void {
    if (this.host.getState().requestState === "saving_feedback") return;
    this.returnFromForm();
  }

  private async markAdviceFeedback(conversationEntryId: string, rating: FeedbackRating): Promise<void> {
    const state = this.host.getState();
    const previousHistory = state.conversationHistory;
    const previousLatestGuidance = state.latestGuidance;
    const conversationHistory = state.conversationHistory.map((entry) =>
      entry.id === conversationEntryId && entry.role === "assistant" ? { ...entry, feedback: rating } : entry
    );
    const updatedAssistant = conversationHistory.find((entry) => entry.id === conversationEntryId && entry.role === "assistant");
    this.host.patchSession({
      conversationHistory,
      latestGuidance: updatedAssistant ? this.host.createGuidanceCard(updatedAssistant) : state.latestGuidance,
      statusMessage: undefined
    });
    try {
      await this.host.persistConversation();
    } catch (error) {
      if (this.host.getState().activeConversationStreamId === state.activeConversationStreamId) {
        this.host.patchSession({ conversationHistory: previousHistory, latestGuidance: previousLatestGuidance });
      }
      throw error;
    }
  }

  private async persistFeedbackAndMark(
    input: AdviceFeedbackInput,
    entry: ConversationEntry
  ): Promise<string | undefined> {
    if (this.persistingEntryIds.has(input.conversationEntryId)) return undefined;
    this.persistingEntryIds.add(input.conversationEntryId);
    this.host.patchSession({ requestState: "saving_feedback", statusMessage: undefined });
    try {
      const feedbackId = await this.feedbackStore.saveFeedback(
        input,
        {
          kind: entry.kind,
          assistanceDepth: entry.assistanceDepth,
          slashCommand: entry.slashCommand,
          adviceText: entry.text
        },
        { status: "skipped" }
      );
      await this.markAdviceFeedback(input.conversationEntryId, input.rating);
      return feedbackId;
    } catch (error) {
      console.error("Failed to persist feedback", error);
      this.host.patchSession({
        requestState: "idle",
        statusMessage: { kind: "error", text: "フィードバックを保存できませんでした。もう一度お試しください。" }
      });
      return undefined;
    } finally {
      this.persistingEntryIds.delete(input.conversationEntryId);
    }
  }

  private async summarizeAndUpdate(
    feedbackId: string,
    input: AdviceFeedbackInput,
    entry: ConversationEntry
  ): Promise<void> {
    const summary = await this.adviceService.summarizeFeedback({
      rating: input.rating,
      adviceTextExcerpt: truncate(entry.text, 400),
      reasons: input.reasons,
      comment: input.comment
    });
    await this.feedbackStore.updateFeedbackSummary(feedbackId, input.rating, summary);
  }

  private returnFromForm(): void {
    const state = this.host.getState();
    const nextHistory = [...state.screenHistory];
    const previousScreen = nextHistory.pop() ?? "conversation";
    this.host.patchSession({
      pendingFeedbackEntryId: undefined,
      requestState: "idle",
      screen: previousScreen,
      screenHistory: nextHistory,
      statusMessage: undefined
    });
  }
}

function findAssistantEntry(state: NavigatorSessionState, id: string): ConversationEntry | undefined {
  return state.conversationHistory.find((entry) => entry.id === id && entry.role === "assistant");
}

function isBadFeedbackReason(value: unknown): value is BadFeedbackReason {
  return value === "too_long" || value === "off_topic" || value === "gives_answer" || value === "too_vague" || value === "other";
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}
