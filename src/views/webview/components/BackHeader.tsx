import React from "react";
import { useApp } from "../state/AppContext";

export function BackHeader({ label = "戻る" }: { label?: string }) {
  const { send } = useApp();
  return (
    <div className="back-header" onClick={() => send({ type: "navigateBack" })}>
      <span className="material-symbols-outlined">arrow_back</span>
      {label}
    </div>
  );
}
