import { OrcaRouterError } from "./OrcaRouterClient";

export type OrcaRouterFailureDisposition = "requestRejected" | "restricted" | "unavailable";

const GUARDRAIL_ERROR_CODES = new Set([
  "guardrail_blocked",
  "prompt_blocked",
  "sensitive_words_detected"
]);

/**
 * Separates failures of one request from failures that invalidate the provider connection.
 * Authentication, quota, and rate-limit errors are classified by OrcaRouterClient before
 * this policy is applied. Other 4xx responses prove that the gateway was reachable, so the
 * current connection can remain available while the user adjusts the request or model.
 */
export function classifyOrcaRouterFailure(error: OrcaRouterError): OrcaRouterFailureDisposition {
  if (error.kind === "quota" || error.kind === "rateLimit") {
    return "restricted";
  }
  if (
    error.kind === "other"
    && error.status !== undefined
    && error.status >= 400
    && error.status < 500
  ) {
    return "requestRejected";
  }
  return "unavailable";
}

export function requestRejectionMessage(error: OrcaRouterError): string | undefined {
  if (classifyOrcaRouterFailure(error) !== "requestRejected") {
    return undefined;
  }

  const code = error.code?.trim().toLowerCase();
  if (code && GUARDRAIL_ERROR_CODES.has(code)) {
    return "OrcaRouterのGuardrailにより、このリクエストは拒否されました。接続は維持されています。内容を確認して再試行してください。";
  }

  return "OrcaRouterがこのリクエストを受け付けませんでした。入力内容またはモデル設定を確認してください。接続は維持されています。";
}
