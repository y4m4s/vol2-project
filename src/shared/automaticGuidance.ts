import type { AutomaticGuidanceFocus } from "./types";

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
