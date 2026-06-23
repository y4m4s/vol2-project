export type PromptDelimiter = "xml" | "markdown";

export interface ModelProfile {
  delimiter: PromptDelimiter;
  contextBudget: number;
  terse: boolean;
}

export interface ModelProfileSource {
  id?: string;
  name?: string;
  family?: string;
  vendor?: string;
  maxInputTokens?: number;
}

const DEFAULT_CONTEXT_BUDGET = 8000;
const MIN_CONTEXT_BUDGET = 1000;

/**
 * Derives a thin prompt profile from broad model metadata.
 *
 * Copilot model IDs churn quickly, so this intentionally avoids exact ID quirks.
 * Use family/provider-ish signals and size tier only.
 */
export function deriveModelProfile(model?: ModelProfileSource): ModelProfile {
  const searchable = normalizeModelIdentifier(
    `${model?.vendor ?? ""} ${model?.family ?? ""} ${model?.name ?? ""} ${model?.id ?? ""}`
  );
  const contextBudget = deriveContextBudget(model?.maxInputTokens);

  return {
    delimiter: deriveDelimiter(searchable),
    contextBudget,
    terse: isSmallOrCheapModel(searchable) || contextBudget <= DEFAULT_CONTEXT_BUDGET
  };
}

export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  delimiter: "xml",
  contextBudget: DEFAULT_CONTEXT_BUDGET,
  terse: true
};

function deriveDelimiter(searchable: string): PromptDelimiter {
  if (isAnthropicLike(searchable)) {
    return "xml";
  }

  if (isOpenAiLike(searchable) || isGoogleLike(searchable)) {
    return "markdown";
  }

  return DEFAULT_MODEL_PROFILE.delimiter;
}

function deriveContextBudget(maxInputTokens: number | undefined): number {
  if (!Number.isFinite(maxInputTokens) || !maxInputTokens || maxInputTokens <= 0) {
    return DEFAULT_MODEL_PROFILE.contextBudget;
  }

  return Math.max(MIN_CONTEXT_BUDGET, Math.floor(maxInputTokens * 0.5));
}

function isAnthropicLike(searchable: string): boolean {
  return /(anthropic|claude|sonnet|opus|haiku|raptor)/.test(searchable);
}

function isOpenAiLike(searchable: string): boolean {
  return /(openai|gpt|^o[1345]|[^a-z0-9]o[1345])/.test(searchable);
}

function isGoogleLike(searchable: string): boolean {
  return /(google|gemini)/.test(searchable);
}

function isSmallOrCheapModel(searchable: string): boolean {
  return /(nano|mini|flash|small|lite|cheap|haiku)/.test(searchable);
}

function normalizeModelIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}
