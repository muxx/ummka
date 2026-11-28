import { Channel, invoke } from "@tauri-apps/api/core";

export type ChannelPostChange = {
  kind: "created" | "edited" | "deleted";
  channelId: string;
  postId: string;
  rootId: string | null;
};

export type ChannelEventNotice =
  | { kind: "posts"; changes: ChannelPostChange[] }
  | { kind: "reconcile" };

type Packet =
  | {
      kind: "notice";
      receipt: string;
      generation: number;
      notice: ChannelEventNotice;
    }
  | { kind: "cancel"; receipt: string };
type Apply = (
  notice: ChannelEventNotice,
  attemptSignal: AbortSignal,
) => Promise<void>;

function available() {
  return navigator.onLine !== false && document.visibilityState !== "hidden";
}

async function observe(rid: number, apply: Apply, signal: AbortSignal) {
  if (signal.aborted) return;
  let active = available();
  const observer = await invoke<string>("prepare_channel_observer", {
    rid,
    active,
  });
  const owner = { rid, observer };
  let generation = 0;
  let current: { receipt: string; attempt: AbortController } | undefined;
  let closed: Promise<void> | undefined;
  function close() {
    current?.attempt.abort();
    closed ??= invoke<void>("close_channel_observer", owner).catch(
      (error: unknown) => {
        // Retiring the login or destroying its window releases all native resources.
        if (error !== "unknown_connection" && error !== "cancelled")
          throw error;
      },
    );
    return closed;
  }
  let fail!: (error: unknown) => void;
  const failure = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const stop = () => {
    void close().catch(fail);
  };
  let transitions = Promise.resolve();
  function availabilityChanged() {
    const next = available();
    if (active === next || closed) return;
    active = next;
    current?.attempt.abort();
    const args = { ...owner, active, generation: ++generation };
    transitions = transitions
      .then(() => invoke<void>("set_channel_observer_active", args))
      .catch(fail);
  }

  let applying = Promise.resolve();
  function receive(packet: Packet) {
    if (packet.kind === "cancel") {
      if (current?.receipt === packet.receipt) current.attempt.abort();
      return;
    }
    if (closed || !active || signal.aborted || generation !== packet.generation)
      return;
    const attempt = new AbortController();
    current = { receipt: packet.receipt, attempt };
    // Resumption can arrive while the cancelled handler is releasing an HTTP request.
    applying = applying.then(async () => {
      if (attempt.signal.aborted) return;
      try {
        await apply(packet.notice, attempt.signal);
        if (!attempt.signal.aborted) {
          await invoke<boolean>("acknowledge_channel_notice", {
            ...owner,
            receipt: packet.receipt,
          });
        }
      } catch (error) {
        if (!attempt.signal.aborted) fail(error);
      } finally {
        if (current?.receipt === packet.receipt) current = undefined;
      }
    });
  }

  try {
    if (signal.aborted) return;
    signal.addEventListener("abort", stop, { once: true });
    document.addEventListener("visibilitychange", availabilityChanged);
    window.addEventListener("offline", availabilityChanged);
    window.addEventListener("online", availabilityChanged);
    availabilityChanged();
    const stream = invoke<void>("run_channel_observer", {
      ...owner,
      events: new Channel(receive),
    });
    await Promise.race([stream, failure]);
  } finally {
    signal.removeEventListener("abort", stop);
    document.removeEventListener("visibilitychange", availabilityChanged);
    window.removeEventListener("offline", availabilityChanged);
    window.removeEventListener("online", availabilityChanged);
    await close();
  }
}

/** One subscription per signed window. A remount waits for its cancelled predecessor to close. */
export function accountChannelEvents(rid: number) {
  let current: { signal: AbortSignal; done: Promise<void> } | undefined;
  return function observeChannelEvents(
    apply: Apply,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    const previous = current;
    if (previous && !previous.signal.aborted)
      return Promise.reject(
        new Error("This account already observes channel events"),
      );
    const done = (async () => {
      if (previous) {
        // Its failure was delivered to the previous subscriber.
        await previous.done.catch(() => undefined);
      }
      await observe(rid, apply, signal);
    })().finally(() => {
      if (current?.done === done) current = undefined;
    });
    current = { signal, done };
    return done;
  };
}
