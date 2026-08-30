import type {
  BadFeedbackReason,
  FeedbackRating,
  FeedbackReason,
  FeedbackTendencySummary,
  GoodFeedbackReason
} from "./types";

export const GOOD_FEEDBACK_REASONS: readonly GoodFeedbackReason[] = [
  "concise",
  "concrete",
  "well_structured",
  "right_depth",
  "guided_thinking",
  "other"
];

export const BAD_FEEDBACK_REASONS: readonly BadFeedbackReason[] = [
  "too_long",
  "off_topic",
  "gives_answer",
  "too_vague",
  "other"
];

const GOOD_REASON_SET = new Set<FeedbackReason>(GOOD_FEEDBACK_REASONS);
const BAD_REASON_SET = new Set<FeedbackReason>(BAD_FEEDBACK_REASONS);

interface TendencyRule {
  key: string;
  text: string;
}

const GOOD_TENDENCY_RULES: Partial<Record<GoodFeedbackReason, TendencyRule>> = {
  concise: { key: "concise", text: "Keep responses concise and focused." },
  concrete: { key: "concrete", text: "Use concrete file, symbol, and check references." },
  well_structured: { key: "structure", text: "Use a clear, easy-to-follow structure." },
  right_depth: { key: "depth", text: "Match the detail level to the selected assistance depth." },
  guided_thinking: { key: "guidance", text: "Guide with checks and hints instead of complete solutions." }
};

const BAD_TENDENCY_RULES: Partial<Record<BadFeedbackReason, TendencyRule>> = {
  too_long: { key: "concise", text: "Avoid overly long responses; keep them concise and focused." },
  off_topic: { key: "focus", text: "Avoid drifting away from the user's current question and context." },
  gives_answer: { key: "guidance", text: "Avoid complete solutions; guide with checks and hints." },
  too_vague: { key: "concrete", text: "Avoid vague advice; point to concrete locations and checks." }
};

export interface FeedbackTendencyCandidate {
  rating: FeedbackRating;
  reasons: readonly unknown[];
}

export function isFeedbackReasonForRating(value: unknown, rating: FeedbackRating): value is FeedbackReason {
  return typeof value === "string" && (rating === "good" ? GOOD_REASON_SET.has(value as FeedbackReason) : BAD_REASON_SET.has(value as FeedbackReason));
}

export function collectFeedbackTendency(
  candidates: readonly FeedbackTendencyCandidate[],
  limit = 5
): FeedbackTendencySummary {
  if (!Number.isInteger(limit) || limit <= 0) {
    return { goodPatterns: [], badAvoidPatterns: [] };
  }

  const result: FeedbackTendencySummary = { goodPatterns: [], badAvoidPatterns: [] };
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    for (const value of candidate.reasons) {
      if (!isFeedbackReasonForRating(value, candidate.rating)) {
        continue;
      }

      const rule = candidate.rating === "good"
        ? GOOD_TENDENCY_RULES[value as GoodFeedbackReason]
        : BAD_TENDENCY_RULES[value as BadFeedbackReason];
      if (!rule || seenKeys.has(rule.key)) {
        continue;
      }

      seenKeys.add(rule.key);
      const target = candidate.rating === "good" ? result.goodPatterns : result.badAvoidPatterns;
      if (target.length < limit) {
        target.push(rule.text);
      }
    }

    if (result.goodPatterns.length >= limit && result.badAvoidPatterns.length >= limit) {
      break;
    }
  }

  return result;
}
