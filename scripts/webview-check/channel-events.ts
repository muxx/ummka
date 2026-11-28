import { invoke } from "@tauri-apps/api/core";
import type { ChannelPostChange } from "../../src/mattermost/account-channel-events.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channelId = "b".repeat(26);
const firstPost = "1".padStart(26, "0");
type Write = { kind: "applied" | "superseded" };

async function begin(account: Account) {
  return invoke<number>("begin_channel_history_load", {
    rid: account.rid,
    channelId,
  });
}

async function prepareDeletion(account: Account) {
  const result = await invoke<Write>("store_channel_history_page", {
    rid: account.rid,
    load: await begin(account),
    page: {
      channelId,
      collapsedThreads: false,
      source: { kind: "latest" },
      order: [firstPost],
      changes: [
        {
          kind: "save",
          id: firstPost,
          userId: "Abc01234567890123456789012",
          channelId,
          rootId: null,
          createAt: 101,
          updateAt: 101,
          editAt: 0,
          type: "",
          message: "Retained zero-delete-at fixture post",
          messageSource: null,
          hashtags: "",
          isPinned: false,
        },
      ],
      prevPostId: "",
      nextPostId: "",
      firstInaccessiblePostTime: 0,
    },
  });
  if (result.kind !== "applied")
    throw Error("Could not store the deletion fixture");
}

async function remove(
  account: Account,
  change: ChannelPostChange,
  channel: string,
) {
  return invoke<Write>("store_channel_history_changes", {
    rid: account.rid,
    load: await begin(account),
    changes: [{ kind: "remove", id: change.postId, channelId: channel }],
  });
}

function checkAddress(change: ChannelPostChange) {
  if (
    Object.keys(change).sort().join() !== "channelId,kind,postId,rootId" ||
    change.channelId !== channelId ||
    change.rootId !== null
  )
    throw Error("invalid post address");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

export async function checkWindowEvents(
  account: Account,
  other: Account,
  route: (allowed: boolean) => Promise<void>,
) {
  await prepareDeletion(account);
  const entered = deferred(),
    cancelled = deferred();
  const owner = new AbortController();
  const neighbor = new AbortController();
  const isolated = other.observeChannelEvents(async () => {
    throw Error("The notice reached a different signed installation");
  }, neighbor.signal);
  const previousOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
  function setOnline(online: boolean) {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: online,
    });
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  }
  const ids: string[] = [];
  let largest = 0,
    applying = false,
    first = true,
    reconciled = false;
  const observed = account.observeChannelEvents(async (notice, signal) => {
    if (applying) throw Error("overlapping account notifications");
    applying = true;
    try {
      if (notice.kind === "reconcile") {
        if (ids.length !== 40 || reconciled)
          throw Error("misplaced reconciliation");
        reconciled = true;
        return;
      }
      if (!notice.changes.length || notice.changes.length > 32)
        throw Error("invalid burst size");
      largest = Math.max(largest, notice.changes.length);
      for (const change of notice.changes) {
        checkAddress(change);
        if (first) {
          if (change.kind !== "edited" || change.postId !== firstPost)
            throw Error("wrong pending frame");
          first = false;
          entered.resolve();
          await new Promise<void>((done) =>
            signal.addEventListener("abort", () => done(), { once: true }),
          );
          cancelled.resolve();
          return;
        }
        if (reconciled) {
          if (change.kind !== "deleted" || ids.length !== 40 || largest < 2)
            throw Error("missing batched edits or deletion");
          await remove(account, change, "z".repeat(26));
          throw Error("The invalid SQLite history write was accepted");
        }
        if (
          change.kind !== "edited" ||
          change.postId !== String(ids.length + 1).padStart(26, "0")
        )
          throw Error("lost or duplicate replayed post");
        ids.push(change.postId);
      }
    } finally {
      applying = false;
    }
  }, owner.signal);
  let phase = "receive the first edit";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Error("WebView event subscription did not " + phase)),
      14000,
    );
  });
  try {
    await Promise.race([entered.promise, observed, isolated, timeout]);
    phase = "cancel the pending edit";
    setOnline(false);
    await Promise.race([cancelled.promise, observed, timeout]);
    await route(false);
    setOnline(true);
    phase = "apply the replay and reconcile";
    await route(true);
    try {
      await Promise.race([observed, timeout]);
    } catch (error) {
      if (error !== "invalid_history_request") throw error;
      if (!(await account.readSavedPost(channelId, firstPost)))
        throw Error("The failed apply removed the stored post");
      phase = "repeat the unconfirmed deletion";
      const replayed = deferred();
      const retry = account.observeChannelEvents(async (notice) => {
        if (notice.kind !== "posts" || notice.changes.length !== 1)
          throw Error("unexpected notice on explicit retry");
        const [change] = notice.changes;
        checkAddress(change);
        if (change.kind !== "deleted" || change.postId !== firstPost)
          throw Error("explicit retry skipped the unconfirmed deletion");
        if (
          (await remove(account, change, change.channelId)).kind !==
            "applied" ||
          (await account.readSavedPost(channelId, firstPost))
        )
          throw Error(
            "A deleted event with zero delete_at did not remove the cached post",
          );
        replayed.resolve();
      }, owner.signal);
      try {
        await Promise.race([
          replayed.promise,
          retry.then(() => {
            throw Error("retry ended before redelivery");
          }),
          timeout,
        ]);
      } finally {
        owner.abort();
        await retry;
      }
      return;
    }
    throw Error("lost consumer failure");
  } finally {
    clearTimeout(timer);
    owner.abort();
    neighbor.abort();
    if (previousOnline)
      Object.defineProperty(navigator, "onLine", previousOnline);
    else Reflect.deleteProperty(navigator, "onLine");
    await isolated;
  }
}
