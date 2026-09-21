import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { registerPosServiceWorker } from "./offline-ready.ts";
import { initTheme } from "./theme.ts";
import "./styles/tokens.css";
import "./styles.css";

initTheme();
void registerPosServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
