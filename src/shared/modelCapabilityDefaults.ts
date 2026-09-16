import type { AiProviderId, RoutingTaskPurpose } from "./types";

export interface ModelCapabilityProfile {
  providerId: AiProviderId;
  modelPattern: RegExp;
  reasoning: number;
  coding: number;
  instructionFollowing: number;
  schemaCompliance: number;
  grounding: number;
  reliability: number;
  speed: number;
  contextCapacity: number;
  confidence: number;
  profileVersion: number;
}

export const MODEL_CAPABILITY_PROFILE_VERSION = 1;

// 初期値は自動切り替え開始前の保守的な基準であり、モデルの絶対的な品質順位ではない。
// 実測値は端末内の形式遵守・安定性・速度・明示評価だけを徐々に合成する。
export const MODEL_CAPABILITY_DEFAULTS: readonly ModelCapabilityProfile[] = [
  profile("copilot", /^(auto|copilot)$/i, 78, 82, 84, 86, 78, 84, 72, 86, 75),
  profile("copilot", /.*/, 76, 80, 82, 84, 76, 82, 70, 82, 65),
  profile("orcaRouter", /router/i, 80, 78, 76, 72, 78, 76, 68, 88, 60),
  profile("orcaRouter", /.*/, 74, 76, 74, 72, 72, 74, 66, 82, 55),
  profile("lmStudio", /(qwen.*coder|deepseek.*coder|codestral|starcoder)/i, 68, 78, 70, 68, 64, 68, 58, 72, 45),
  profile("ollama", /(qwen.*coder|deepseek.*coder|codestral|starcoder)/i, 68, 78, 70, 68, 64, 68, 58, 72, 45),
  profile("lmStudio", /.*/, 60, 58, 64, 62, 58, 64, 58, 64, 35),
  profile("ollama", /.*/, 60, 58, 64, 62, 58, 64, 58, 64, 35)
];

type CapabilityKey = Exclude<keyof ModelCapabilityProfile, "providerId" | "modelPattern" | "confidence" | "profileVersion">;

const TASK_WEIGHTS: Record<RoutingTaskPurpose, Record<CapabilityKey, number>> = {
  learning: weights({ instructionFollowing: 0.30, reliability: 0.20, speed: 0.15, schemaCompliance: 0.15, grounding: 0.10, reasoning: 0.10 }),
  explanation: weights({ instructionFollowing: 0.25, grounding: 0.20, reasoning: 0.20, reliability: 0.15, speed: 0.10, contextCapacity: 0.10 }),
  implementation: weights({ coding: 0.30, reasoning: 0.20, reliability: 0.15, schemaCompliance: 0.15, instructionFollowing: 0.10, contextCapacity: 0.10 }),
  review: weights({ reasoning: 0.25, grounding: 0.20, coding: 0.20, reliability: 0.15, instructionFollowing: 0.10, contextCapacity: 0.10 }),
  riskAssessment: weights({ reasoning: 0.30, grounding: 0.25, reliability: 0.20, instructionFollowing: 0.15, schemaCompliance: 0.10 }),
  summarization: weights({ schemaCompliance: 0.30, grounding: 0.25, instructionFollowing: 0.20, contextCapacity: 0.15, reliability: 0.10 })
};

export function findInitialModelCapability(providerId: AiProviderId, modelId: string): ModelCapabilityProfile {
  return MODEL_CAPABILITY_DEFAULTS.find(item => item.providerId === providerId && item.modelPattern.test(modelId))
    ?? profile(providerId, /.*/, 55, 55, 58, 55, 55, 58, 55, 58, 20);
}

export function initialTaskFitScore(profile: ModelCapabilityProfile, purpose: RoutingTaskPurpose): number {
  const taskWeights = TASK_WEIGHTS[purpose];
  return Object.entries(taskWeights).reduce((total, [key, weight]) => total + profile[key as CapabilityKey] * weight, 0);
}

function profile(
  providerId: AiProviderId,
  modelPattern: RegExp,
  reasoning: number,
  coding: number,
  instructionFollowing: number,
  schemaCompliance: number,
  grounding: number,
  reliability: number,
  speed: number,
  contextCapacity: number,
  confidence: number
): ModelCapabilityProfile {
  return { providerId, modelPattern, reasoning, coding, instructionFollowing, schemaCompliance, grounding,
    reliability, speed, contextCapacity, confidence, profileVersion: MODEL_CAPABILITY_PROFILE_VERSION };
}

function weights(partial: Partial<Record<CapabilityKey, number>>): Record<CapabilityKey, number> {
  return {
    reasoning: 0,
    coding: 0,
    instructionFollowing: 0,
    schemaCompliance: 0,
    grounding: 0,
    reliability: 0,
    speed: 0,
    contextCapacity: 0,
    ...partial
  };
}
