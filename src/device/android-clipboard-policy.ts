import { addPluginListener, invoke } from "@tauri-apps/api/core";

const plugin = "clipboard-policy";

/** Read the profile's current restriction before an explicit Android copy. */
export async function readAndroidClipboardAllowed(): Promise<boolean> {
  try {
    return (await invoke<boolean>(`plugin:${plugin}|read_allowed`)) === true;
  } catch {
    return false;
  }
}

export function observeAndroidClipboardAllowed(
  report: (allowed: boolean) => void,
) {
  report(false);
  let subscriber: typeof report | undefined = report;
  let ready = false;
  let revision = 0;
  const listener = addPluginListener<{ allowed: boolean } | null>(
    plugin,
    "changed",
    (event) => {
      revision++;
      if (ready) subscriber?.(event?.allowed === true);
    },
  );
  void listener.then(
    async () => {
      if (!subscriber) return;
      ready = true;
      const started = revision;
      const allowed = await readAndroidClipboardAllowed();
      if (revision === started) subscriber?.(allowed);
    },
    () => {}, // The initial denial stays in effect if registration fails.
  );
  return () => {
    if (!subscriber) return;
    subscriber = undefined;
    void listener.then((handle) => handle.unregister()).catch(() => {});
  };
}
