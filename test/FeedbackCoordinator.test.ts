import assert from "node:assert/strict";
import test from "node:test";
import { FeedbackCoordinator, type FeedbackCoordinatorHost } from "../src/application/coordinators/FeedbackCoordinator";
import type { FeedbackStore } from "../src/services/FeedbackStore";
import type { AdviceFeedbackInput, NavigatorSessionState } from "../src/shared/types";

function createState(): NavigatorSessionState {
  return {
    screen: "conversation",
    screenHistory: [],
    connectionState: "connected",
    requestState: "idle",
    mode: "manual",
    assistanceDepth: "low",
    autoAdvice: {
      enabled: false,
      paused: false,
      waitingForIdle: false,
      idleRemainingMs: 0,
      cooldownRemainingMs: 0
    },
    contextPreview: { diagnosticsSummary: [] },
    conversationStreams: [],
    activeConversationStreamId: "stream-1",
    conversationHistory: [{
      id: "answer-1",
      role: "assistant",
      text: "確認場所を短く整理します。",
      createdAt: "2026-08-30T00:00:00.000Z",
      kind: "manual",
      assistanceDepth: "low"
    }],
    knowledgeQuery: ""
  };
}

function createHarness(options: { failConversationPersist?: boolean; failFeedbackPersist?: boolean } = {}) {
  let state = createState();
  const saved: AdviceFeedbackInput[] = [];
  let feedbackFormPushes = 0;
  const store = {
    saveFeedback: async (input: AdviceFeedbackInput) => {
      if (options.failFeedbackPersist) throw new Error("feedback persist failed");
      saved.push(input);
      return `feedback-${saved.length}`;
    }
  } as unknown as FeedbackStore;
  const host: FeedbackCoordinatorHost = {
    getState: () => state,
    patchSession: (partial) => { state = { ...state, ...partial }; },
    pushFeedbackForm: () => {
      feedbackFormPushes += 1;
      state = { ...state, screenHistory: [...state.screenHistory, state.screen], screen: "feedback_form" };
    },
    navigateBack: () => {
      state = { ...state, screen: "conversation" };
    },
    createGuidanceCard: (entry) => ({
      id: entry.id,
      requestedAt: entry.createdAt,
      mode: entry.mode ?? "manual",
      assistanceDepth: entry.assistanceDepth ?? "low",
      text: entry.text,
      basedOn: entry.basedOn ?? { diagnosticsSummary: [] },
      requestPlan: entry.requestPlan ?? { kind: entry.kind, categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "0 B" }
    }),
    persistConversation: async () => {
      if (options.failConversationPersist) throw new Error("persist failed");
    }
  };

  return {
    coordinator: new FeedbackCoordinator(store, host),
    getState: () => state,
    saved,
    getFeedbackFormPushes: () => feedbackFormPushes
  };
}

test("Goodも理由入力画面を経由し、理由なしでは保存しない", async () => {
  const harness = createHarness();
  await harness.coordinator.rateAdvice("answer-1", "good");

  assert.equal(harness.getFeedbackFormPushes(), 1);
  assert.equal(harness.getState().pendingFeedbackRating, "good");

  await harness.coordinator.submitFeedback([], "");
  assert.equal(harness.saved.length, 0);
  assert.equal(harness.getState().screen, "feedback_form");

  await harness.coordinator.submitFeedback(["concise", "too_long"], "  補足  ");
  assert.deepEqual(harness.saved, [{
    conversationEntryId: "answer-1",
    rating: "good",
    reasons: ["concise"],
    comment: "補足"
  }]);
  assert.equal(harness.getState().conversationHistory[0].feedback, "good");
  assert.equal(harness.getState().pendingFeedbackEntryId, undefined);
  assert.equal(harness.getState().pendingFeedbackRating, undefined);
});

test("評価済み回答を別の評価へ変更できる", async () => {
  const harness = createHarness();
  harness.getState().conversationHistory[0].feedback = "good";

  await harness.coordinator.rateAdvice("answer-1", "bad");
  await harness.coordinator.submitFeedback(["too_vague"], "");

  assert.equal(harness.saved[0].rating, "bad");
  assert.equal(harness.getState().conversationHistory[0].feedback, "bad");
});

test("会話保存に失敗した場合は表示上の評価を戻す", async () => {
  const harness = createHarness({ failConversationPersist: true });
  await withMutedConsoleError(async () => {
    await harness.coordinator.rateAdvice("answer-1", "bad");
    await harness.coordinator.submitFeedback(["off_topic"], "");
  });

  assert.equal(harness.saved.length, 0);
  assert.equal(harness.getState().conversationHistory[0].feedback, undefined);
  assert.equal(harness.getState().requestState, "idle");
  assert.equal(harness.getState().statusMessage?.kind, "error");
});

test("評価DBの保存に失敗した場合は会話履歴の評価も戻す", async () => {
  const harness = createHarness({ failFeedbackPersist: true });
  await withMutedConsoleError(async () => {
    await harness.coordinator.rateAdvice("answer-1", "good");
    await harness.coordinator.submitFeedback(["concise"], "");
  });

  assert.equal(harness.saved.length, 0);
  assert.equal(harness.getState().conversationHistory[0].feedback, undefined);
  assert.equal(harness.getState().requestState, "idle");
  assert.equal(harness.getState().statusMessage?.kind, "error");
});

async function withMutedConsoleError(task: () => Promise<void>): Promise<void> {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    await task();
  } finally {
    console.error = originalConsoleError;
  }
}
