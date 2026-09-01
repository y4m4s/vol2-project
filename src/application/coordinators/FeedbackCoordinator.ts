import { FeedbackStore } from "../../services/FeedbackStore";
import { isFeedbackReasonForRating } from "../../shared/feedback";
import {
  AdviceFeedbackInput,
  ConversationEntry,
  FeedbackReason,
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
    private readonly host: FeedbackCoordinatorHost
  ) {}

  public async rateAdvice(conversationEntryId: string, rating: FeedbackRating): Promise<void> {
    if (rating !== "good" && rating !== "bad") return;
    const state = this.host.getState();
    if (state.requestState !== "idle") return;
    const entry = findAssistantEntry(state, conversationEntryId);
    if (!entry) return;

    this.host.patchSession({
      pendingFeedbackEntryId: conversationEntryId,
      pendingFeedbackRating: rating,
      statusMessage: undefined
    });
    this.host.pushFeedbackForm();
  }

  public async submitFeedback(reasons: FeedbackReason[], comment: string): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle") return;
    const conversationEntryId = state.pendingFeedbackEntryId;
    const rating = state.pendingFeedbackRating;
    if (!conversationEntryId || !rating) {
      this.host.navigateBack();
      return;
    }
    const entry = findAssistantEntry(state, conversationEntryId);
    if (!entry) {
      this.cancelFeedback();
      return;
    }

    const normalizedReasons = [...new Set(reasons.filter((reason) => isFeedbackReasonForRating(reason, rating)))];
    if (normalizedReasons.length === 0) {
      this.host.patchSession({
        statusMessage: { kind: "warning", text: "フィードバックの理由を1つ以上選択してください。" }
      });
      return;
    }

    const input: AdviceFeedbackInput = {
      conversationEntryId,
      rating,
      reasons: normalizedReasons,
      comment: comment.trim().slice(0, 1000)
    };
    const feedbackId = await this.persistFeedbackAndMark(input, entry);
    if (!feedbackId) return;
    this.returnFromForm();
  }

  public cancelFeedback(): void {
    if (this.host.getState().requestState === "saving_feedback") return;
    this.returnFromForm();
  }

  private async markAdviceFeedback(conversationEntryId: string, rating: FeedbackRating | undefined): Promise<void> {
    const state = this.host.getState();
    const previousHistory = state.conversationHistory;
    const previousLatestGuidance = state.latestGuidance;
    const conversationHistory = state.conversationHistory.map((entry) =>
      entry.id === conversationEntryId && entry.role === "assistant" ? { ...entry, feedback: rating } : entry
    );
    const updatedAssistant = conversationHistory.find((entry) => entry.id === conversationEntryId && entry.role === "assistant");
    const latestGuidance = state.latestGuidance?.id === conversationEntryId && updatedAssistant
      ? this.host.createGuidanceCard(updatedAssistant)
      : state.latestGuidance;
    this.host.patchSession({
      conversationHistory,
      latestGuidance,
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
    let conversationUpdated = false;
    try {
      await this.markAdviceFeedback(input.conversationEntryId, input.rating);
      conversationUpdated = true;
      const feedbackId = await this.feedbackStore.saveFeedback(
        input,
        {
          kind: entry.kind,
          assistanceDepth: entry.assistanceDepth,
          slashCommand: entry.slashCommand
        }
      );
      return feedbackId;
    } catch (error) {
      if (conversationUpdated) {
        try {
          await this.markAdviceFeedback(input.conversationEntryId, entry.feedback);
        } catch (rollbackError) {
          console.error("Failed to roll back conversation feedback", rollbackError);
        }
      }
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

  private returnFromForm(): void {
    const state = this.host.getState();
    const nextHistory = [...state.screenHistory];
    const previousScreen = nextHistory.pop() ?? "conversation";
    this.host.patchSession({
      pendingFeedbackEntryId: undefined,
      pendingFeedbackRating: undefined,
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
