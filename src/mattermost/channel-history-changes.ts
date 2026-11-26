/** Local commits for one open account. Readers never receive message contents. */
export function createChannelHistoryChanges() {
  type Listener = (source?: AbortSignal) => void;
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
    notify(channelId: string, source?: AbortSignal) {
      for (const listener of channels.get(channelId) ?? []) listener(source);
    },
    close() {
      closed = true;
      channels.clear();
    },
  };
}
