type BookmarkWriteOwner = {
  panel: string;
  view: AbortSignal;
};

// The request belongs to the account connection. A closed editor only stops
// applying its result to that view.
export function createChannelBookmarkWrites() {
  const writes = new Map<
    string,
    { owner: BookmarkWriteOwner; request: AbortController }
  >();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    pending(channelId: string) {
      return writes.get(channelId)?.owner ?? null;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run<T>(
      channelId: string,
      owner: BookmarkWriteOwner,
      write: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      if (writes.has(channelId))
        throw new Error("Bookmark change still pending");
      const request = new AbortController();
      writes.set(channelId, { owner, request });
      changed();
      try {
        const result = await write(request.signal);
        request.signal.throwIfAborted();
        return result;
      } finally {
        if (writes.get(channelId)?.request === request) {
          writes.delete(channelId);
          changed();
        }
      }
    },
    abort() {
      const running = [...writes.values()];
      writes.clear();
      for (const { request } of running) request.abort();
      changed();
    },
  };
}

export type ChannelBookmarkWrites = ReturnType<
  typeof createChannelBookmarkWrites
>;
