import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./appearance/window";
import { entryLanguage } from "./entry/language";
import "./appearance/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("React mount element is missing");

const language = entryLanguage(window.navigator.languages);
document.documentElement.lang = language;
createRoot(container).render(<App language={language} />);
