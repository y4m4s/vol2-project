import type { AiProviderId, AssistanceDepth } from "../shared/types";

/** Content breadth is independent of the user's Thinking selection. */
export function guidanceContentDepth(provider: AiProviderId | undefined, depth: AssistanceDepth = "low"): AssistanceDepth {
  return provider === "ollama" ? "high" : depth;
}
