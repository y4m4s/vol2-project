import assert from "node:assert/strict";
import test from "node:test";
import { OrcaRouterError } from "../src/services/OrcaRouterClient";
import { classifyOrcaRouterFailure, requestRejectionMessage, retryAfterSeconds } from "../src/services/OrcaRouterErrorPolicy";

test("classifies ordinary 4xx responses as request-scoped rejections", () => {
  const error = new OrcaRouterError("other", "Bad request", 400, "bad_request_body");

  assert.equal(classifyOrcaRouterFailure(error), "requestRejected");
  assert.match(requestRejectionMessage(error) ?? "", /接続は維持されています/);
});

test("uses a dedicated message for guardrail rejections", () => {
  const error = new OrcaRouterError("other", "Prompt rejected", 400, "guardrail_blocked");

  assert.equal(classifyOrcaRouterFailure(error), "requestRejected");
  assert.match(requestRejectionMessage(error) ?? "", /Guardrail/);
});

test("keeps quota and service failures out of the request-scoped path", () => {
  assert.equal(
    classifyOrcaRouterFailure(new OrcaRouterError("rateLimit", "Limited", 429)),
    "restricted"
  );
  assert.equal(
    classifyOrcaRouterFailure(new OrcaRouterError("unavailable", "Unavailable", 503)),
    "unavailable"
  );
});

test("logs unfamiliar rejection/free codes once without response bodies", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const error of [
    new OrcaRouterError("other", "private body", 400, "new_guardrail\ncode"),
    new OrcaRouterError("other", "private body", 404),
    new OrcaRouterError("quota", "private body", 403, "free_capacity_empty"),
    new OrcaRouterError("rateLimit", "private body", 429, "FREE_RATE_LIMITED")
  ]) {
    classifyOrcaRouterFailure(error);
    requestRejectionMessage(error);
    classifyOrcaRouterFailure(error);
  }
  assert.equal(warn.mock.callCount(), 4);
  const logs = JSON.stringify(warn.mock.calls.map((call) => call.arguments));
  assert.doesNotMatch(logs, /private body/);
  assert.match(logs, /free_capacity_empty/);
  assert.match(logs, /possible missed Guardrail/);
});

test("known codes and unrelated rate limits do not produce drift warnings", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const code of ["guardrail_blocked", "prompt_blocked", " SENSITIVE_WORDS_DETECTED "]) {
    assert.match(requestRejectionMessage(new OrcaRouterError("other", "body", 400, code))!, /Guardrail/);
  }
  classifyOrcaRouterFailure(new OrcaRouterError("quota", "body", 403, "free_quota_exhausted"));
  classifyOrcaRouterFailure(new OrcaRouterError("rateLimit", "body", 429, "free_rate_limited", "42"));
  classifyOrcaRouterFailure(new OrcaRouterError("rateLimit", "body", 429, "rate_limited"));
  assert.equal(warn.mock.callCount(), 0);
});

test("accepts only nonnegative safe integer Retry-After seconds", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(retryAfterSeconds(undefined), undefined);
  assert.equal(retryAfterSeconds("0"), 0);
  assert.equal(retryAfterSeconds(" 0042 "), 42);
  const unsupported = ["", " ", "-1", "1.5", "NaN", "Infinity", "0x10", "1e2", "9007199254740992", "Wed, 21 Oct 2026 07:28:00 GMT"];
  for (const value of unsupported) {
    assert.equal(retryAfterSeconds(value), undefined);
    const error = new OrcaRouterError("rateLimit", "body", 429, undefined, value);
    classifyOrcaRouterFailure(error);
    requestRejectionMessage(error);
  }
  assert.equal(warn.mock.callCount(), unsupported.length);
  assert.ok(warn.mock.calls.every((call) => String(call.arguments[0]).includes("Retry-After")));
});
