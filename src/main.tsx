import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./ui/tokens.css";
import "./ui/primitives/primitives.css";
import "./ui/shell/shell.css";
import "./ui/shell/tableShell.css";
import "./ui/shell/tableMenu.css";
import "./ui/shell/rail.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
