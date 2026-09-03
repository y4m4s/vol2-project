import type { SlashCommand } from "../shared/types";

export type GuidanceResponseValidation =
  | { ok: true; text: string; normalized: boolean }
  | { ok: false; reason: FlowResponseFailureReason };

export type FlowResponseFailureReason =
  | "missingMermaidBlock"
  | "unclosedMermaidBlock"
  | "multipleMermaidBlocks"
  | "wrongDiagramType"
  | "emptyDiagram";

const MERMAID_OPENING_FENCE = /^[ \t]*```[ \t]*mermaid[ \t]*$/gim;
const MERMAID_BLOCK = /^[ \t]*```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gim;
const FLOWCHART_START = /^flowchart\s+TD\b/;

/**
 * Enforces output contracts that are part of a slash command's user-visible behavior.
 * This is intentionally provider-independent: routers and model upgrades must not be
 * able to silently weaken the /flow contract.
 */
export function validateGuidanceResponse(
  slashCommand: SlashCommand | undefined,
  text: string
): GuidanceResponseValidation {
  if (slashCommand !== "flow") {
    return { ok: true, text, normalized: false };
  }

  return validateFlowResponse(text);
}

export function buildGuidanceFormatRepairPrompt(
  originalPrompt: string,
  reason: FlowResponseFailureReason
): string {
  return [
    originalPrompt,
    "",
    "## Output format correction",
    `The previous response failed the required /flow output contract (${reason}).`,
    "Generate the complete answer again from the supplied context.",
    "Return only a 2-3 line Japanese summary followed by exactly one closed ```mermaid code block.",
    "The first non-comment line in that block must be exactly `flowchart TD`.",
    "Do not refer to the previous response or explain this correction."
  ].join("\n");
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

  // A common small-model failure is returning valid Mermaid without a fence. This
  // formatting-only defect is safe to repair deterministically without inventing flow.
  const bareFlowchart = !text.includes("```")
    ? /(?:^|\n)(flowchart\s+TD\b[\s\S]*)$/m.exec(text)
    : undefined;
  if (bareFlowchart) {
    const body = bareFlowchart[1].trim();
    const validation = validateFlowchartBody(text, body, true);
    if (!validation.ok) {
      return validation;
    }
    const summary = text.slice(0, bareFlowchart.index).trim();
    return {
      ok: true,
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

  return { ok: true, text: fullText, normalized };
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  const count = [...text.matchAll(pattern)].length;
  pattern.lastIndex = 0;
  return count;
}
