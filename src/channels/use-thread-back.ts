import { onBackButtonPress } from "@tauri-apps/api/app";
import { useEffect } from "react";

export function useThreadBack(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    let listening = true;
    const listener =
      import.meta.env.UMMKA_ANDROID === true
        ? onBackButtonPress(() => {
            if (listening) close();
          })
        : undefined;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing)
        return;
      if (document.querySelector("dialog[open], [aria-modal='true']")) return;
      event.preventDefault();
      close();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      listening = false;
      window.removeEventListener("keydown", handleEscape);
      void listener?.then((subscription) => subscription.unregister());
    };
  }, [active, close]);
}
