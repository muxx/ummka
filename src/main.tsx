import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("React mount element is missing");

createRoot(container).render(<App />);
