import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { registerPosServiceWorker } from "./offline-ready.ts";
import { initTheme } from "./theme.ts";
import { installValidationFeedback } from "./validation-feedback.ts";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles.css";

initTheme();
void registerPosServiceWorker();

const root = document.getElementById("root")!;
const removeValidationFeedback = installValidationFeedback(root);
if (import.meta.hot) import.meta.hot.dispose(removeValidationFeedback);

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
