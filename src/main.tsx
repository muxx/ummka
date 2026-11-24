import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startAppearance } from "./appearance/device";
import "./appearance/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("React mount element is missing");

const appearance = startAppearance(window);
import.meta.hot?.dispose(appearance.dispose);

createRoot(container).render(<App />);
