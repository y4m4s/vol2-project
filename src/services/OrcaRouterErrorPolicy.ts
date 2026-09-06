import type { OrcaRouterError } from "./OrcaRouterClient";

export type OrcaRouterFailureDisposition = "requestRejected" | "restricted" | "unavailable";

const GUARDRAIL_ERROR_CODES = new Set([
  "guardrail_blocked",
  "prompt_blocked",
  "sensitive_words_detected"
]);

const diagnosedErrors = new WeakSet<OrcaRouterError>();

// Dates and other non-second formats deliberately use the generic retry guidance.
// In particular, Number("") and Number("0x10") must not schedule automatic retries.
export function retryAfterSeconds(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function diagnoseFailure(error: OrcaRouterError, requestRejected: boolean): void {
  if (diagnosedErrors.has(error)) return;
  diagnosedErrors.add(error);
  // Log only bounded, escaped protocol fields, never response bodies or credentials.
  const code = error.code?.trim().toLowerCase();
  const details = { status: error.status, kind: error.kind, code: JSON.stringify(error.code?.slice(0, 200)) };
  if (requestRejected && (!code || !GUARDRAIL_ERROR_CODES.has(code))) {
    console.warn("[OrcaRouter] Unrecognized request rejection; possible missed Guardrail code.", details);
  }
  if (
    (error.kind === "quota" || error.kind === "rateLimit")
    && code?.includes("free")
    && error.code !== "free_quota_exhausted"
    && error.code !== "free_rate_limited"
  ) {
    console.warn("[OrcaRouter] Unrecognized free error code; possible naming change.", details);
  }
  if (error.retryAfter !== undefined && retryAfterSeconds(error.retryAfter) === undefined) {
    console.warn("[OrcaRouter] Retry-After is not supported integer seconds; using generic retry guidance.", {
      ...details,
      retryAfter: JSON.stringify(error.retryAfter.slice(0, 200))
    });
  }
}

/**
 * Separates failures of one request from failures that invalidate the provider connection.
 * Authentication, quota, and rate-limit errors are classified by OrcaRouterClient before
 * this policy is applied. Other 4xx responses prove that the gateway was reachable, so the
 * current connection can remain available while the user adjusts the request or model.
 */
export function classifyOrcaRouterFailure(error: OrcaRouterError): OrcaRouterFailureDisposition {
  const requestRejected = error.kind === "other"
    && error.status !== undefined
    && error.status >= 400
    && error.status < 500;
  diagnoseFailure(error, requestRejected);
  if (error.kind === "quota" || error.kind === "rateLimit") {
    return "restricted";
  }
  if (requestRejected) {
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
