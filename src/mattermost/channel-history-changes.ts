import type { ChannelPostChange } from "./channel-post-records.ts";

/** Confirmed local observations for one open account and a specific channel. */
export function createChannelHistoryChanges() {
  type Listener = (
    source?: AbortSignal,
    posts?: readonly ChannelPostChange[],
  ) => void;
  const channels = new Map<string, Set<Listener>>();
  let closed = false;
  return {
    subscribe(channelId: string, listener: Listener) {
      if (closed) return () => {};
      const listeners = channels.get(channelId) ?? new Set<Listener>();
      channels.set(channelId, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && channels.get(channelId) === listeners)
          channels.delete(channelId);
      };
    },
    notify(
      channelId: string,
      source?: AbortSignal,
      posts?: readonly ChannelPostChange[],
    ) {
      for (const listener of channels.get(channelId) ?? [])
        listener(source, posts);
    },
    close() {
      closed = true;
      channels.clear();
    },
  };
}
