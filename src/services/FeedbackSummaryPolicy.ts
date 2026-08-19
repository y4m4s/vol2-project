import type { FeedbackRating } from "../shared/types";

const MAX_SUMMARY_LENGTH = 120;
const META_INSTRUCTION_PATTERN =
  /\b(ignore|jailbreak|prompt|system message|developer message|assistant answer|user message|return exactly|summari[sz]e|pair[- ]programming navigator)\b/i;
const SAFE_SUMMARY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ,.';!?()\/_-]*$/;
const BAD_SUMMARY_PREFIX_PATTERN = /^(Avoid|Do not|Don't|Never)\b/i;

export function validateFeedbackSummary(value: unknown, rating: FeedbackRating): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const summary = value.trim();
  if (
    !summary ||
    summary.length > MAX_SUMMARY_LENGTH ||
    /[\r\n]/.test(summary) ||
    !SAFE_SUMMARY_PATTERN.test(summary) ||
    META_INSTRUCTION_PATTERN.test(summary) ||
    (rating === "bad" && !BAD_SUMMARY_PREFIX_PATTERN.test(summary))
  ) {
    return undefined;
  }

  return summary;
}
