import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./ui/tokens.css";
import "./ui/themes/aco.css";
import "./ui/themes/claro.css";
import "./ui/themes/arcano.css";
import "./ui/primitives/primitives.css";
import "./ui/shell/shell.css";
import "./ui/shell/tableShell.css";
import "./ui/shell/tableMenu.css";
import "./ui/shell/rail.css";
import "./ui/screens/deckTile.css";
import "./ui/screens/lobby/lobby.css";
import "./ui/screens/result/result.css";
import "./ui/screens/onboarding/onboarding.css";
import "./ui/shell/coach.css";
import "./ui/screens/library/library.css";
import "./ui/screens/deck/deck.css";
import "./ui/screens/import/import.css";
import "./ui/screens/match.css";
import "./ui/screens/settings/settings.css";
import "./ui/screens/zones/zones.css";
import "./ui/table/tcg.css";
import App from "./App";
import { applyTheme, readTheme } from "./ui/theme";

// Antes do createRoot: o tema salvo já está no <html> quando a primeira tela pinta.
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
