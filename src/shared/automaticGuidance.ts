import type { AutoAdviceState, AutomaticGuidanceFocus } from "./types";

const LABELS: Record<AutomaticGuidanceFocus, string> = {
  continue: "次の一手", review: "レビュー", explain: "解説", overview: "全体像", none: "発話なし"
};

export function parseAutomaticFocus(value: unknown): AutomaticGuidanceFocus | undefined {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LABELS, value)
    ? value as AutomaticGuidanceFocus : undefined;
}

export function automaticGuidanceLabel(focus?: AutomaticGuidanceFocus): string {
  return focus && focus !== "none" ? `NaviCom（自動・${LABELS[focus]}）` : "NaviCom（自動）";
}

export function getAutoAdviceWaitStatus(
  state: Pick<AutoAdviceState, "waitingForIdle" | "idleRemainingMs" | "cooldownRemainingMs">
): { kind: "idle" | "cooldown" | "ready"; remainingMs: number } {
  const idleRemainingMs = state.waitingForIdle ? Math.max(0, state.idleRemainingMs) : 0;
  const cooldownRemainingMs = Math.max(0, state.cooldownRemainingMs);

  if (cooldownRemainingMs >= idleRemainingMs && cooldownRemainingMs > 0) {
    return { kind: "cooldown", remainingMs: cooldownRemainingMs };
  }
  if (idleRemainingMs > 0) {
    return { kind: "idle", remainingMs: idleRemainingMs };
  }
  return { kind: "ready", remainingMs: 0 };
}
