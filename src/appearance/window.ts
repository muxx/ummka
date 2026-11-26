import { startAppearance } from "./device";

export const windowAppearance = startAppearance(window);
import.meta.hot?.dispose(windowAppearance.dispose);
