import React from "react";
import { useApp } from "./state/AppContext";
import { S01Connection } from "../screens/s01-connection";
import { S02Main } from "../screens/s02-main";
import { S03AdviceDetail } from "../screens/s03-advice-detail";
import { S04ContextCheck } from "../screens/s04-context-check";
import { S05Knowledge } from "../screens/s05-knowledge";
import { S06Settings } from "../screens/s06-settings";
import { S07Error } from "../screens/s07-error";

export function App() {
  const { viewModel } = useApp();

  if (!viewModel) {
    return <div style={{ padding: 16, opacity: 0.5 }}>読み込み中...</div>;
  }

  const screen = viewModel.screen;

  switch (screen) {
    case "onboarding":
      return <S01Connection />;
    case "main":
      return <S02Main />;
    case "advice_detail":
      return <S03AdviceDetail />;
    case "context_check":
      return <S04ContextCheck />;
    case "knowledge":
      return <S05Knowledge />;
    case "settings":
      return <S06Settings />;
    case "error":
      return <S07Error />;
    default:
      return <S01Connection />;
  }
}
