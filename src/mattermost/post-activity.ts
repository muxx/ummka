type Attempt = { pendingId: string; attempt: number };
type Conversation = { channelId: string; rootId?: string | null };

function attemptKey({ pendingId, attempt }: Attempt) {
  return `${pendingId}:${attempt}`;
}

function conversationKey({ channelId, rootId }: Conversation) {
  return `${channelId}/${rootId ?? ""}`;
}

/** Requests owned by one open account connection, including while its views are unmounted. */
export function createPostActivity() {
  const active = new Map<string, string>();
  let events: EventTarget | undefined = new EventTarget();

  return {
    isSending(attempt: Attempt) {
      return active.has(attemptKey(attempt));
    },
    subscribe(location: Conversation, changed: () => void) {
      const target = events;
      const topic = conversationKey(location);
      const listener = () => changed();
      target?.addEventListener(topic, listener);
      return () => target?.removeEventListener(topic, listener);
    },
    start(post: Attempt & Conversation) {
      const key = attemptKey(post);
      const topic = conversationKey(post);
      if (events) {
        active.set(key, topic);
        events.dispatchEvent(new Event(topic));
      }
      return () => {
        if (active.delete(key)) events?.dispatchEvent(new Event(topic));
      };
    },
    close() {
      const target = events;
      events = undefined;
      const topics = new Set(active.values());
      active.clear();
      for (const topic of topics) target?.dispatchEvent(new Event(topic));
    },
  };
}
