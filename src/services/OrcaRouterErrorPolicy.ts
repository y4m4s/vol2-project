import type { OrcaRouterError, OrcaRouterFailureKind } from "./OrcaRouterClient";

export function orcaRouterAccessMessage(kind: OrcaRouterFailureKind): string | undefined {
  switch (kind) {
    case "balanceQuota": return "OrcaRouter の残高、またはメンバー・エージェントの月次予算に達しました。管理画面で該当する上限を確認してください。";
    case "keyQuota": return "OrcaRouter APIキーの利用上限に達しました。キーの上限を確認してください。残高の追加だけでは解消しません。";
    case "cycleLimit": return "OrcaRouter APIキーの期間別予算に達しました。管理画面でリセット時刻を確認するか、期間別予算を変更してください。";
    case "modelAccess": return "OrcaRouter APIキーに、このモデルの利用が許可されていません。キーの許可モデル一覧を確認してください。ルーターはルーターID自体の許可が必要です。";
    case "forbidden": return "OrcaRouter がアクセスを拒否しました。キーのIP許可リスト・モデル権限・期間別予算を管理画面で確認してください。";
    default: return undefined;
  }
}

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
    (error.kind === "quota" || error.kind === "rateLimit" || error.kind === "forbidden")
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
  if (["quota", "keyQuota", "cycleLimit", "balanceQuota", "rateLimit"].includes(error.kind)) {
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
