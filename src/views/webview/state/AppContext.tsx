import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import type { ExtensionToWebview, WebviewToExtension } from "../../../shared/messages";
import type { NavigatorScreen, NavigatorViewModel } from "../../../shared/types";
import { postMessage } from "./vscodeApi";
import { initialState, reducer } from "./reducer";

interface AppContextValue {
  viewModel: NavigatorViewModel | null;
  currentScreen: NavigatorScreen | null;
  send: (msg: WebviewToExtension) => void;
  additionalContextDraft: string;
  setAdditionalContextDraft: (value: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [additionalContextDraft, setAdditionalContextDraft] = useState("");

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebview;
      if (msg.type === "updateViewModel") {
        dispatch({ type: "UPDATE_VIEW_MODEL", payload: msg.payload });
      }
    };
    window.addEventListener("message", handler);
    postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const currentScreen = state.viewModel?.screen ?? null;

  return (
    <AppContext.Provider value={{ viewModel: state.viewModel, currentScreen, send: postMessage, additionalContextDraft, setAdditionalContextDraft }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
