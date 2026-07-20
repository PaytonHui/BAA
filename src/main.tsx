import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ChatWindowApp from "./ChatWindowApp";
import CalendarWindowApp from "./CalendarWindowApp";
import ColorWindowApp from "./ColorWindowApp";
import SettingsWindowApp from "./SettingsWindowApp";
import LinkWindowApp from "./LinkWindowApp";
import GrokLoginWindowApp from "./GrokLoginWindowApp";
import MenuWindowApp from "./MenuWindowApp";
import "./index.css";

/**
 * Separate panel windows (?panel=…) — no WebGL,
 * so the pet window never resizes (no open/close flash).
 */
const panel =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("panel")
    : null;

function Root() {
  if (panel === "chat") return <ChatWindowApp />;
  if (panel === "calendar") return <CalendarWindowApp />;
  if (panel === "color") return <ColorWindowApp />;
  if (panel === "settings") return <SettingsWindowApp />;
  if (panel === "link") return <LinkWindowApp />;
  if (panel === "login") return <GrokLoginWindowApp />;
  if (panel === "menu") return <MenuWindowApp />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
