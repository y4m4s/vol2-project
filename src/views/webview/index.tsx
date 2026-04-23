import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./state/AppContext";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <AppProvider>
      <App />
    </AppProvider>
  );
}
