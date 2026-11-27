import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type AccountChannelsLink,
  routeChannelsLink,
} from "./route-channels-link.ts";

type Delivery = { id: string; href: string };
type QueueHead = Delivery & { waiting: number };
type Observers = {
  onEmpty?: () => void;
  onWaiting?: (id: string, waiting: number | undefined) => void;
};
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
  { onEmpty, onWaiting }: Observers = {},
) {
  signal.throwIfAborted();
  let running = false,
    requested = false,
    paused = false;
  let completed: string | undefined;
  let failed: string | undefined;
  let observedHead: string | undefined;
  let waitingDirty = false;
  let readingWaiting = false;
  const readHead = () => invoke<QueueHead | null>("pending_channels_link");

  async function refreshWaiting() {
    if (!onWaiting || readingWaiting) return;
    readingWaiting = true;
    try {
      // The delivery may be waiting for the user while new links arrive.
      while (waitingDirty && observedHead && !signal.aborted && !paused) {
        waitingDirty = false;
        const id: string = observedHead;
        const snapshot = await readHead().catch(() => null);
        if (
          observedHead === id &&
          !waitingDirty &&
          !signal.aborted &&
          !paused
        ) {
          onWaiting(id, snapshot?.id === id ? snapshot.waiting : undefined);
        }
      }
    } finally {
      readingWaiting = false;
    }
  }
  async function drain() {
    running = true;
    try {
      do {
        requested = false;
        for (;;) {
          if (signal.aborted) return;
          failed = undefined;
          waitingDirty = false;
          const link = await readHead();
          if (signal.aborted) return;
          if (!link) {
            completed = undefined;
            onEmpty?.();
            break;
          }
          failed = link.id;
          if (completed !== link.id) {
            const { id, href, waiting } = link;
            observedHead = id;
            if (waitingDirty) void refreshWaiting();
            else onWaiting?.(id, waiting);
            const route = await routeChannelsLink(href);
            if (signal.aborted) return;
            await navigate({ id, href, route }, signal);
            observedHead = undefined;
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
      observedHead = undefined;
      running = false;
      if (requested && !paused && !signal.aborted) wake();
    }
  }
  function wake() {
    if (signal.aborted || paused) return;
    requested = true;
    waitingDirty = true;
    if (!running) void drain();
    else if (observedHead) void refreshWaiting();
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
