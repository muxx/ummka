import { getCurrentWindow } from "@tauri-apps/api/window";

/** Exercise real foreground visibility only for the step that needs it. */
export async function withVisibleTestWindow(run: () => Promise<void>) {
  if (import.meta.env.UMMKA_PLATFORM !== "darwin") return run();
  const window = getCurrentWindow();
  await window.show();
  try {
    if (document.visibilityState !== "visible") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          document.removeEventListener("visibilitychange", changed);
          reject(Error("shown WKWebView remained " + document.visibilityState));
        }, 8000);
        function changed() {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", changed);
          clearTimeout(timeout);
          resolve();
        }
        document.addEventListener("visibilitychange", changed);
        changed();
      });
    }
    await run();
  } finally {
    await window.hide();
  }
}
