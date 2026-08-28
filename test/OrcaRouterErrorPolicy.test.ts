import assert from "node:assert/strict";
import test from "node:test";
import { OrcaRouterError } from "../src/services/OrcaRouterClient";
import { classifyOrcaRouterFailure, requestRejectionMessage } from "../src/services/OrcaRouterErrorPolicy";

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
