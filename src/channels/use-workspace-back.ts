import { onBackButtonPress } from "@tauri-apps/api/app";
import { useEffect, useEffectEvent } from "react";

import { isAndroid } from "../build-platform.ts";

// An open workspace modal owns Back even when its focused submit button was removed.
function openDialog() {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
  );
  return (
    dialogs.find((dialog) => dialog.contains(document.activeElement)) ??
    dialogs.at(-1)
  );
}

export function useWorkspaceBack(
  modal: boolean,
  back: (() => void) | null,
  nativeBack = back,
) {
  const active = modal || back !== null || (isAndroid && nativeBack !== null);
  const handle = useEffectEvent((action: "escape" | "native") => {
    const dialog = openDialog();
    if (dialog) {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      return true;
    }
    const run = action === "native" ? nativeBack : back;
    if (modal || !run) return false;
    run();
    return true;
  });
  useEffect(() => {
    if (!active) return;
    let listening = true;
    const listener = isAndroid
      ? onBackButtonPress(() => {
          if (listening) handle("native");
        })
      : undefined;
    function handleEscape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        handle("escape")
      )
        event.preventDefault();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      listening = false;
      window.removeEventListener("keydown", handleEscape);
      void listener?.then((subscription) => subscription.unregister());
    };
  }, [active]);
}
