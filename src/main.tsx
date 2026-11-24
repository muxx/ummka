import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPalette, resolvePalette } from "./appearance/palette";
import "./appearance/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("React mount element is missing");

const mode = window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";
applyPalette(document.documentElement, mode, resolvePalette(mode));

createRoot(container).render(<App />);
