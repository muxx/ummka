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
export async function watchSystemChannelsLinks(
  navigate: (
    link: SystemChannelsLink,
    signal: AbortSignal,
  ) => void | Promise<void>,
  onError: (error: unknown, deliveryId?: string) => void,
  signal: AbortSignal,
  onEmpty?: () => void,
) {
  signal.throwIfAborted();
  let running = false,
    requested = false,
    paused = false;
  let completed: string | undefined;
  let failed: string | undefined;
  async function drain() {
    running = true;
    try {
      do {
        requested = false;
        for (;;) {
          if (signal.aborted) return;
          failed = undefined;
          const link = await invoke<Delivery | null>("pending_channels_link");
          if (signal.aborted) return;
          if (!link) {
            completed = undefined;
            onEmpty?.();
            break;
          }
          failed = link.id;
          if (completed !== link.id) {
            const route = await routeChannelsLink(link.href);
            if (signal.aborted) return;
            await navigate({ ...link, route }, signal);
            if (signal.aborted) return;
            completed = link.id;
          }
          const removed = await invoke<boolean>("acknowledge_channels_link", {
            id: link.id,
          });
          if (!removed) throw new Error("System link was not acknowledged");
          completed = undefined;
        }
      } while (requested && !signal.aborted);
    } catch (error) {
      if (!signal.aborted) {
        paused = true;
        onError(error, failed);
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
    dismiss(id: string) {
      if (!paused || failed !== id) return;
      completed = id;
      paused = false;
      wake();
    },
  };
}
