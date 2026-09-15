import type { AutomaticGuidanceFocus, AutomaticGuidanceObservation, GuidanceContext, GuidanceKind, SlashCommand } from "../shared/types";
import { repeatsExistingCallProposal } from "./AutomaticAdviceGrounding";
import { parseAutomaticFocus } from "../shared/automaticGuidance";
import { MAX_GUIDANCE_RESPONSE_CHARS } from "./AiRequestPolicy";

export type GuidanceResponseValidation =
  | { ok: true; outcome: "advice"; text: string; normalized: boolean; focus?: AutomaticGuidanceFocus }
  | { ok: true; outcome: "no_advice"; text: ""; normalized: boolean; focus?: AutomaticGuidanceFocus; suppressionReason?: "existingCodeProposal" }
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
  automaticCurrentCode?: readonly string[];
}

export type GuidanceEnvelopeIssue =
  | "valid"
  | "empty"
  | "invalidJson"
  | "surroundingText"
  | "topLevelNotObject"
  | "missingKind"
  | "kindWrongType"
  | "unsupportedKind"
  | "missingText"
  | "textWrongType"
  | "missingFocus"
  | "invalidFocus"
  | "unexpectedKeys";

export interface GuidanceEnvelopeDiagnostic {
  responseChars: number;
  trimmedChars: number;
  envelopeIssue: GuidanceEnvelopeIssue;
  markdownFence: boolean;
  actualKeyCount?: number;
  missingKeyCount?: number;
  unexpectedKeyCount?: number;
}

export function guidanceResponseValidationOptions(input: {
  kind: GuidanceKind; userPrompt?: string; context: GuidanceContext; automaticObservation?: AutomaticGuidanceObservation;
}): GuidanceResponseValidationOptions {
  const allowImplementationCode = userExplicitlyRequestedImplementationCode(input.userPrompt);
  return {
    kind: input.kind, allowImplementationCode,
    ...(input.kind === "always" && input.context.additionalContext?.trim() && !allowImplementationCode
      ? { automaticCurrentCode: [input.context.activeFileExcerpt,
          input.automaticObservation?.cursorExcerpt?.replaceAll("<<<NAVICOM_CURSOR>>>", "")]
          .filter((code): code is string => Boolean(code)) }
      : {})
  };
}

const MERMAID_OPENING_FENCE = /^[ \t]*```[ \t]*mermaid[ \t]*$/gim;
const MERMAID_BLOCK = /^[ \t]*```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gim;
const FLOWCHART_START = /^flowchart\s+TD\b/;
const COMMANDING_LANGUAGE = /(?:^|\n)\s*(?:[-*]\s*)?(?:必ず|今すぐ)?\s*(?:修正|変更|削除|追加|置換)(?:してください|しなければなりません|すべきです)/m;
const SHORT_MANUAL_CODE_MAX_LINES = 20;
const SHORT_MANUAL_CODE_MAX_CHARS = 1_000;

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
  const envelope = parseEnvelope(rawText, options.kind === "always");
  if (!envelope) {
    return { ok: false, reason: rawText.trim() ? "invalidEnvelope" : "emptyResponse" };
  }

  if (envelope.kind === "no_advice") {
    return options.kind === "always"
      ? { ok: true, outcome: "no_advice", text: "", normalized: envelope.normalized, focus: "none" }
      : { ok: false, reason: "unexpectedNoAdvice" };
  }

  const text = envelope.text.trim();
  if (!text) {
    return { ok: false, reason: "emptyResponse" };
  }
  if (text.length > MAX_GUIDANCE_RESPONSE_CHARS) {
    return { ok: false, reason: "responseTooLong" };
  }
  if (options.kind === "always" && envelope.focus === "continue" && options.allowImplementationCode === false
      && options.automaticCurrentCode && repeatsExistingCallProposal(text, options.automaticCurrentCode)) {
    return { ok: true, outcome: "no_advice", text: "", focus: "none", normalized: envelope.normalized,
      suppressionReason: "existingCodeProposal" };
  }
  if (
    options.allowImplementationCode === false
    && hasDisallowedCodeFence(
      text,
      slashCommand === "flow",
      slashCommand !== "flow" && (options.kind === "manual" || options.kind === "context")
    )
  ) {
    return { ok: false, reason: "implementationCodeNotRequested" };
  }
  if (COMMANDING_LANGUAGE.test(text)) {
    return { ok: false, reason: "commandingLanguage" };
  }

  if (slashCommand !== "flow") {
    return { ok: true, outcome: "advice", text, normalized: envelope.normalized,
      ...(envelope.focus ? { focus: envelope.focus } : {}) };
  }

  const flowValidation = validateFlowResponse(text);
  if (!flowValidation.ok) {
    return flowValidation;
  }
  return {
    ok: true,
    outcome: "advice",
    text: flowValidation.text,
    ...(envelope.focus ? { focus: envelope.focus } : {}),
    normalized: envelope.normalized || flowValidation.normalized
  };
}

/**
 * Describes an envelope failure without retaining model output or user data.
 * This intentionally reports only structure, counts and bounded enums.
 */
export function diagnoseGuidanceEnvelope(rawText: string, automatic: boolean): GuidanceEnvelopeDiagnostic {
  const trimmed = rawText.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenceMatch?.[1].trim() ?? trimmed;
  const base = {
    responseChars: rawText.length,
    trimmedChars: trimmed.length,
    markdownFence: Boolean(fenceMatch)
  };
  if (!candidate) return { ...base, envelopeIssue: "empty" };

  let value: unknown;
  try {
    value = JSON.parse(candidate) as unknown;
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace && (firstBrace > 0 || lastBrace < candidate.length - 1)) {
      try {
        JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
        return { ...base, envelopeIssue: "surroundingText" };
      } catch { /* The embedded candidate is also invalid JSON. */ }
    }
    return { ...base, envelopeIssue: "invalidJson" };
  }
  if (!isRecord(value)) return { ...base, envelopeIssue: "topLevelNotObject" };

  const keys = Object.keys(value);
  const withKeyCounts = (issue: GuidanceEnvelopeIssue, expected: readonly string[]): GuidanceEnvelopeDiagnostic => {
    const actual = new Set(keys);
    const expectedSet = new Set(expected);
    return {
      ...base,
      envelopeIssue: issue,
      actualKeyCount: keys.length,
      missingKeyCount: expected.filter(key => !actual.has(key)).length,
      unexpectedKeyCount: keys.filter(key => !expectedSet.has(key)).length
    };
  };
  if (!("kind" in value)) return withKeyCounts("missingKind", automatic ? ["kind", "focus", "text"] : ["kind", "text"]);
  if (typeof value.kind !== "string") return withKeyCounts("kindWrongType", automatic ? ["kind", "focus", "text"] : ["kind", "text"]);
  if (value.kind === "no_advice") {
    const expected = automatic ? ["kind", "focus"] : ["kind"];
    if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) return withKeyCounts("unexpectedKeys", expected);
    if (automatic && parseAutomaticFocus(value.focus) !== "none") {
      return withKeyCounts("invalidFocus", expected);
    }
    return withKeyCounts("valid", expected);
  }
  if (value.kind !== "advice") return withKeyCounts("unsupportedKind", automatic ? ["kind", "focus", "text"] : ["kind", "text"]);
  const expected = automatic ? ["kind", "focus", "text"] : ["kind", "text"];
  if (!("text" in value)) return withKeyCounts("missingText", expected);
  if (typeof value.text !== "string") return withKeyCounts("textWrongType", expected);
  if (automatic && !("focus" in value)) return withKeyCounts("missingFocus", expected);
  if (automatic) {
    const focus = parseAutomaticFocus(value.focus);
    if (!focus || focus === "none") return withKeyCounts("invalidFocus", expected);
  }
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) return withKeyCounts("unexpectedKeys", expected);
  return withKeyCounts("valid", expected);
}

export function buildGuidanceFormatRepairPrompt(
  originalSystemPrompt: string,
  reason: GuidanceResponseFailureReason,
  kind?: GuidanceKind
): string {
  return [
    originalSystemPrompt,
    "",
    "## Output contract correction",
    `The previous response failed the required output contract (${reason}).`,
    "Generate the complete answer again from the supplied current-request data.",
    kind === "always"
      ? '{"kind":"advice","focus":"continue|review|explain|overview","text":"..."} の focus は候補から1つ選んでください。有用な助言がなければ {"kind":"no_advice","focus":"none"} のみを返してください。'
      : '{"kind":"advice","text":"..."} のみを返してください。',
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

function parseEnvelope(rawText: string, automatic: boolean):
  | { kind: "advice"; text: string; normalized: boolean; focus?: AutomaticGuidanceFocus }
  | { kind: "no_advice"; normalized: boolean }
  | undefined {
  const trimmed = rawText.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenceMatch?.[1].trim() ?? trimmed;
  try {
    const value = JSON.parse(candidate) as unknown;
    if (!isRecord(value) || typeof value.kind !== "string") return undefined;
    const keys = Object.keys(value).sort();
    const focus = parseAutomaticFocus(value.focus);
    if (value.kind === "no_advice") {
      return (automatic ? keys.join(",") === "focus,kind" && focus === "none" : keys.join(",") === "kind")
        ? { kind: "no_advice", normalized: Boolean(fenceMatch) }
        : undefined;
    }
    if (value.kind !== "advice" || typeof value.text !== "string") return undefined;
    if (automatic
      ? keys.join(",") !== "focus,kind,text" || !focus || focus === "none"
      : keys.join(",") !== "kind,text") return undefined;
    return { kind: "advice", text: value.text, normalized: Boolean(fenceMatch), focus };
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

function hasDisallowedCodeFence(text: string, allowMermaid: boolean, allowShortManualCode: boolean): boolean {
  let openingLanguage: string | undefined;
  let codeLines: string[] = [];
  let codeBlockCount = 0;
  for (const line of text.split(/\r?\n/)) {
    // The output contract only permits the explicit ```mermaid form for /flow.
    // Treat Markdown's alternative tilde fences as implementation code so a
    // provider cannot bypass the code-output permission check with ~~~.
    if (/^[ \t]*~~~/.test(line)) {
      return true;
    }
    const match = /^[ \t]*```([^\r\n]*)$/.exec(line);
    if (!match) {
      if (openingLanguage !== undefined) codeLines.push(line);
      continue;
    }
    if (openingLanguage === undefined) {
      openingLanguage = (match[1] ?? "").trim().toLowerCase();
      codeLines = [];
      continue;
    }

    // Closing fences cannot carry an info string. Reject malformed Markdown
    // instead of accidentally treating a second opening fence as a close.
    if ((match[1] ?? "").trim()) return true;
    codeBlockCount++;
    if (allowMermaid && openingLanguage === "mermaid") {
      openingLanguage = undefined;
      codeLines = [];
      continue;
    }
    if (!allowShortManualCode || codeBlockCount > 1 || codeLines.length > SHORT_MANUAL_CODE_MAX_LINES
      || codeLines.join("\n").length > SHORT_MANUAL_CODE_MAX_CHARS) {
      return true;
    }
    openingLanguage = undefined;
    codeLines = [];
  }
  // /flow の Mermaid フェンスの閉じ忘れは、後段の flow 専用検証で
  // unclosedMermaidBlock として分類する。
  return openingLanguage !== undefined && !allowMermaid;
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
