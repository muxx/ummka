import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type AccountChannelsLink,
  routeChannelsLink,
} from "./route-channels-link.ts";

type Delivery = { id: string; href: string };
export type SystemChannelsLink = Delivery & {
  route: AccountChannelsLink | null;
};

/** Watch the main window's native inbox. A rejected navigation remains available for explicit retry. */
export async function watchSystemChannelsLinks(
  navigate: (
    link: SystemChannelsLink,
    signal: AbortSignal,
  ) => void | Promise<void>,
  onError: (error: unknown) => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let running = false;
  let requested = false;
  let paused = false;

  async function drain() {
    running = true;
    try {
      do {
        requested = false;
        for (;;) {
          if (signal.aborted) return;
          const link = await invoke<Delivery | null>("pending_channels_link");
          if (!link || signal.aborted) break;
          const route = await routeChannelsLink(link.href);
          if (signal.aborted) return;
          await navigate({ ...link, route }, signal);
          if (signal.aborted) return;
          const removed = await invoke<boolean>("acknowledge_channels_link", {
            id: link.id,
          });
          if (!removed) throw new Error("System link was not acknowledged");
        }
      } while (requested && !signal.aborted);
    } catch (error) {
      if (!signal.aborted) {
        paused = true;
        onError(error);
      }
    } finally {
      running = false;
      if (requested && !paused && !signal.aborted) wake();
    }
  }

  function wake() {
    if (signal.aborted || paused) return;
    requested = true;
    if (!running) void drain();
  }

  const unlisten = await listen("channels-link-available", wake, {
    target: { kind: "Webview", label: "main" },
  });
  if (signal.aborted) {
    unlisten();
    signal.throwIfAborted();
  }
  signal.addEventListener("abort", unlisten, { once: true });
  wake();
  return {
    retry() {
      paused = false;
      wake();
    },
  };
}
