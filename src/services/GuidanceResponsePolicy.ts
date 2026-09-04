import type { GuidanceKind, SlashCommand } from "../shared/types";
import { MAX_GUIDANCE_RESPONSE_CHARS } from "./AiRequestPolicy";

export type GuidanceResponseValidation =
  | { ok: true; outcome: "advice"; text: string; normalized: boolean }
  | { ok: true; outcome: "no_advice"; text: ""; normalized: boolean }
  | { ok: false; reason: GuidanceResponseFailureReason };

export type FlowResponseFailureReason =
  | "missingMermaidBlock"
  | "unclosedMermaidBlock"
  | "multipleMermaidBlocks"
  | "wrongDiagramType"
  | "emptyDiagram";

export type GuidanceResponseFailureReason =
  | FlowResponseFailureReason
  | "invalidEnvelope"
  | "unexpectedNoAdvice"
  | "emptyResponse"
  | "responseTooLong"
  | "implementationCodeNotRequested"
  | "commandingLanguage";

export interface GuidanceResponseValidationOptions {
  kind?: GuidanceKind;
  allowImplementationCode?: boolean;
}

const MERMAID_OPENING_FENCE = /^[ \t]*```[ \t]*mermaid[ \t]*$/gim;
const MERMAID_BLOCK = /^[ \t]*```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gim;
const FLOWCHART_START = /^flowchart\s+TD\b/;
const COMMANDING_LANGUAGE = /(?:^|\n)\s*(?:[-*]\s*)?(?:必ず|今すぐ)?\s*(?:修正|変更|削除|追加|置換)(?:してください|しなければなりません|すべきです)/m;

/**
 * Enforces the provider-independent response envelope and user-visible output
 * contracts. Model upgrades and routers cannot silently turn an automatic
 * no-op into an error or bypass the basic guidance constraints.
 */
export function validateGuidanceResponse(
  slashCommand: SlashCommand | undefined,
  rawText: string,
  options: GuidanceResponseValidationOptions = {}
): GuidanceResponseValidation {
  const envelope = parseEnvelope(rawText);
  if (!envelope) {
    return { ok: false, reason: rawText.trim() ? "invalidEnvelope" : "emptyResponse" };
  }

  if (envelope.kind === "no_advice") {
    return options.kind === "always"
      ? { ok: true, outcome: "no_advice", text: "", normalized: envelope.normalized }
      : { ok: false, reason: "unexpectedNoAdvice" };
  }

  const text = envelope.text.trim();
  if (!text) {
    return { ok: false, reason: "emptyResponse" };
  }
  if (text.length > MAX_GUIDANCE_RESPONSE_CHARS) {
    return { ok: false, reason: "responseTooLong" };
  }
  if (
    options.allowImplementationCode === false
    && hasDisallowedCodeFence(text, slashCommand === "flow")
  ) {
    return { ok: false, reason: "implementationCodeNotRequested" };
  }
  if (COMMANDING_LANGUAGE.test(text)) {
    return { ok: false, reason: "commandingLanguage" };
  }

  if (slashCommand !== "flow") {
    return { ok: true, outcome: "advice", text, normalized: envelope.normalized };
  }

  const flowValidation = validateFlowResponse(text);
  if (!flowValidation.ok) {
    return flowValidation;
  }
  return {
    ok: true,
    outcome: "advice",
    text: flowValidation.text,
    normalized: envelope.normalized || flowValidation.normalized
  };
}

export function buildGuidanceFormatRepairPrompt(
  originalSystemPrompt: string,
  reason: GuidanceResponseFailureReason
): string {
  return [
    originalSystemPrompt,
    "",
    "## Output contract correction",
    `The previous response failed the required output contract (${reason}).`,
    "Generate the complete answer again from the supplied current-request data.",
    '{"kind":"advice","text":"..."} のみを返してください。常時モードで有用な指摘がない場合だけ {"kind":"no_advice"} を返してください。',
    "JSON object を Markdown fence で囲まず、失敗した応答には言及しないでください。",
    ...(reason === "missingMermaidBlock" || reason === "unclosedMermaidBlock" ||
      reason === "multipleMermaidBlocks" || reason === "wrongDiagramType" || reason === "emptyDiagram"
      ? [
          "For /flow, the text value must contain a 2-3 line Japanese summary followed by exactly one closed ```mermaid block.",
          "The first non-comment line in that block must be exactly `flowchart TD`."
        ]
      : [])
  ].join("\n");
}

function parseEnvelope(rawText: string):
  | { kind: "advice"; text: string; normalized: boolean }
  | { kind: "no_advice"; normalized: boolean }
  | undefined {
  const trimmed = rawText.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenceMatch?.[1].trim() ?? trimmed;
  try {
    const value = JSON.parse(candidate) as unknown;
    if (!isRecord(value) || typeof value.kind !== "string") return undefined;
    const keys = Object.keys(value).sort();
    if (value.kind === "no_advice") {
      return keys.length === 1 && keys[0] === "kind"
        ? { kind: "no_advice", normalized: Boolean(fenceMatch) }
        : undefined;
    }
    if (value.kind !== "advice" || typeof value.text !== "string") return undefined;
    if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "text") return undefined;
    return { kind: "advice", text: value.text, normalized: Boolean(fenceMatch) };
  } catch {
    return undefined;
  }
}

export function userExplicitlyRequestedImplementationCode(userPrompt?: string): boolean {
  if (!userPrompt?.trim()) return false;
  const prompt = userPrompt.normalize("NFKC");
  return [
    /(?:コード|スニペット|実装例|サンプルコード).{0,16}(?:書(?:い|く)|示(?:し|す)|見せ|提示|出力|生成|作成|作って|実装|ください|ほしい|欲しい)/,
    /(?:書(?:い|く)|示(?:し|す)|見せ|提示|出力|生成|作成|実装).{0,16}(?:コード|スニペット|実装例|サンプルコード)/,
    /実装(?:して|してください|をお願い)/,
    /\b(?:write|show|provide|generate|create|implement)\b.{0,40}\b(?:code|snippet|implementation)\b/i,
    /\b(?:code|snippet|implementation)\b.{0,40}\b(?:please|example)\b/i
  ].some((pattern) => pattern.test(prompt));
}

function hasDisallowedCodeFence(text: string, allowMermaid: boolean): boolean {
  let insideFence = false;
  for (const line of text.split(/\r?\n/)) {
    // The output contract only permits the explicit ```mermaid form for /flow.
    // Treat Markdown's alternative tilde fences as implementation code so a
    // provider cannot bypass the code-output permission check with ~~~.
    if (/^[ \t]*~~~/.test(line)) {
      return true;
    }
    const match = /^[ \t]*```([^\r\n]*)$/.exec(line);
    if (!match) continue;
    if (insideFence) {
      insideFence = false;
      continue;
    }
    insideFence = true;
    if (!allowMermaid || (match[1] ?? "").trim().toLowerCase() !== "mermaid") {
      return true;
    }
  }
  // /flow の Mermaid フェンスの閉じ忘れは、後段の flow 専用検証で
  // unclosedMermaidBlock として分類する。
  return false;
}

function validateFlowResponse(text: string): GuidanceResponseValidation {
  const openingFenceCount = countMatches(text, MERMAID_OPENING_FENCE);
  const blocks = [...text.matchAll(MERMAID_BLOCK)];

  if (openingFenceCount > blocks.length) {
    return { ok: false, reason: "unclosedMermaidBlock" };
  }
  if (blocks.length > 1) {
    return { ok: false, reason: "multipleMermaidBlocks" };
  }
  if (blocks.length === 1) {
    return validateFlowchartBody(text, blocks[0][1] ?? "", false);
  }

  const bareFlowchart = !text.includes("```")
    ? /(?:^|\n)(flowchart\s+TD\b[\s\S]*)$/m.exec(text)
    : undefined;
  if (bareFlowchart) {
    const body = bareFlowchart[1].trim();
    const validation = validateFlowchartBody(text, body, true);
    if (!validation.ok) return validation;
    const summary = text.slice(0, bareFlowchart.index).trim();
    return {
      ok: true,
      outcome: "advice",
      text: `${summary ? `${summary}\n\n` : ""}\`\`\`mermaid\n${body}\n\`\`\``,
      normalized: true
    };
  }

  return { ok: false, reason: "missingMermaidBlock" };
}

function validateFlowchartBody(
  fullText: string,
  body: string,
  normalized: boolean
): GuidanceResponseValidation {
  const statements = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));

  if (!statements[0] || !FLOWCHART_START.test(statements[0])) {
    return { ok: false, reason: "wrongDiagramType" };
  }
  if (statements.length < 2) {
    return { ok: false, reason: "emptyDiagram" };
  }

  return { ok: true, outcome: "advice", text: fullText, normalized };
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  const count = [...text.matchAll(pattern)].length;
  pattern.lastIndex = 0;
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
