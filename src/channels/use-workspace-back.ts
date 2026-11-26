import { onBackButtonPress } from "@tauri-apps/api/app";
import { useEffect, useEffectEvent } from "react";

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

export function useWorkspaceBack(modal: boolean, back: (() => void) | null) {
  const active = modal || back !== null;
  const handle = useEffectEvent(() => {
    const dialog = openDialog();
    if (dialog) {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      return true;
    }
    if (modal || !back) return false;
    back();
    return true;
  });
  useEffect(() => {
    if (!active) return;
    let listening = true;
    const listener =
      import.meta.env.UMMKA_ANDROID === true
        ? onBackButtonPress(() => {
            if (listening) handle();
          })
        : undefined;
    function handleEscape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        handle()
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
