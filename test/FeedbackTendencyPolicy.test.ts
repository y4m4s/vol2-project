import assert from "node:assert/strict";
import test from "node:test";
import {
  collectFeedbackTendency,
  isFeedbackReasonForRating
} from "../src/shared/feedback";

test("評価種別に合う理由だけを受け入れる", () => {
  assert.equal(isFeedbackReasonForRating("concise", "good"), true);
  assert.equal(isFeedbackReasonForRating("too_long", "good"), false);
  assert.equal(isFeedbackReasonForRating("too_long", "bad"), true);
  assert.equal(isFeedbackReasonForRating("concise", "bad"), false);
});

test("理由を安全な定型傾向へ変換し、同じ観点は新しい評価を優先する", () => {
  assert.deepEqual(
    collectFeedbackTendency([
      { rating: "bad", reasons: ["too_long", "too_vague"] },
      { rating: "good", reasons: ["concise", "concrete", "well_structured"] }
    ]),
    {
      goodPatterns: ["Use a clear, easy-to-follow structure."],
      badAvoidPatterns: [
        "Avoid overly long responses; keep them concise and focused.",
        "Avoid vague advice; point to concrete locations and checks."
      ]
    }
  );
});

test("その他と不正な理由はプロンプト傾向へ変換しない", () => {
  assert.deepEqual(
    collectFeedbackTendency([
      { rating: "good", reasons: ["other", "unknown"] },
      { rating: "bad", reasons: ["other", null] }
    ]),
    { goodPatterns: [], badAvoidPatterns: [] }
  );
});
