export type AiRequestPurpose = "guidance" | "flowRepair" | "knowledge";

export interface AiTextRequest {
  systemPrompt: string;
  userPrompt: string;
  purpose: AiRequestPurpose;
  maxOutputTokens: number;
}

export const AI_OUTPUT_TOKEN_LIMITS: Readonly<Record<AiRequestPurpose, number>> = {
  guidance: 2_048,
  flowRepair: 3_072,
  knowledge: 2_048
};

export const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
export const MAX_MODEL_LIST_RESPONSE_BYTES = 1024 * 1024;
export const MAX_PROVIDER_MODEL_COUNT = 300;
export const MAX_PROVIDER_MODEL_FIELD_LENGTH = 500;
export const MAX_GUIDANCE_RESPONSE_CHARS = 50_000;
export const MAX_KNOWLEDGE_RESPONSE_CHARS = 60_000;

export class AiResponseLimitError extends Error {
  public constructor(message = "AI response exceeded the configured size limit.") {
    super(message);
    this.name = "AiResponseLimitError";
  }
}

export async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiResponseLimitError();
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new AiResponseLimitError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export function assertResponseCharacterLimit(text: string, purpose: AiRequestPurpose): void {
  if (text.length > getResponseCharacterLimit(purpose)) {
    throw new AiResponseLimitError();
  }
}

export function getResponseCharacterLimit(purpose: AiRequestPurpose): number {
  return purpose === "knowledge"
    ? MAX_KNOWLEDGE_RESPONSE_CHARS
    : MAX_GUIDANCE_RESPONSE_CHARS;
}

export function normalizeProviderField(value: string, maxLength = MAX_PROVIDER_MODEL_FIELD_LENGTH): string {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength);
}
