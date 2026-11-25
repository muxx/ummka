import { invoke } from "@tauri-apps/api/core";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { expectCode } from "./local-history.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channelId = "receiptchannel".padEnd(26, "0");
const root = "receiptroot".padEnd(26, "0");
const reply = "receiptreply".padEnd(26, "0");
const duplicate = "receiptduplicate".padEnd(26, "0");
const message = "Two people could send this exact text";

async function stage(account: Account, rootId?: string) {
  const saved = await account.saveDraft({
    channelId,
    rootId,
    expectedRevision: null,
    message,
  });
  if (saved.kind !== "saved" || !saved.draft.revision)
    throw Error("Expected a saved fixture draft");
  const result = await account.stagePost({
    channelId,
    rootId,
    revision: saved.draft.revision,
  });
  if (result.kind !== "created") throw Error("Expected a staged fixture post");
  return result.post.pendingId;
}

export async function checkReceipts(
  account: Account,
  other: Account,
  userId: string,
) {
  const pendingId = await stage(account);
  const post = {
    id: root,
    userId,
    channelId,
    rootId: "",
    message,
    deleteAt: 0,
  };
  const http = { kind: "response", requestPendingId: pendingId } as const;
  const posted = { kind: "posted" } as const;
  if (
    (await account.confirmPostDelivery(posted, post)) ||
    (await account.confirmPostDelivery(http, {
      ...post,
      userId: "x".repeat(26),
    })) ||
    (await other.confirmPostDelivery(http, post)) ||
    (await account.confirmPostDelivery(http, {
      ...post,
      pendingPostId: "wrong request",
    }))
  )
    throw Error("An unrelated response confirmed a staged message");

  if (
    !(await account.confirmPostDelivery(posted, {
      ...post,
      pendingPostId: pendingId,
    })) ||
    !(await account.confirmPostDelivery(http, post)) ||
    (await account.confirmPostDelivery(http, { ...post, id: duplicate })) ||
    (await account.retireDeliveredPosts([root])) !== 0
  )
    throw Error(
      "A delivery receipt must keep the first canonical identity until history contains it",
    );

  const requestPendingId = await stage(account, root);
  if (
    !(await account.confirmPostDelivery(
      { kind: "response", requestPendingId },
      { ...post, id: reply, rootId: root },
    ))
  )
    throw Error(
      "HTTP delivery without an echoed pending ID did not match its request",
    );

  const ids = [duplicate, root];
  const load = await invoke<number>("begin_channel_history_load", {
    rid: account.rid,
    channelId,
  });
  const written = await invoke<{ kind: string }>("store_channel_history_page", {
    rid: account.rid,
    load,
    page: {
      channelId,
      collapsedThreads: false,
      source: { kind: "latest" },
      order: ids,
      prevPostId: "",
      nextPostId: "",
      firstInaccessiblePostTime: 0,
      changes: ids.map((id, index) => ({
        kind: "save",
        id,
        userId,
        channelId,
        rootId: null,
        createAt: 102 - index,
        updateAt: 102 - index,
        editAt: 0,
        type: "",
        message,
        messageSource: null,
        hashtags: "",
        isPinned: false,
      })),
    },
  });
  if (written.kind !== "applied")
    throw Error("Could not persist canonical delivery history");
  await expectCode(
    account.retireDeliveredPosts([root, "bad"]),
    "invalid_history_request",
  );
  await expectCode(
    account.retireDeliveredPosts(Array(201).fill(root)),
    "invalid_history_request",
  );
  if (
    (await account.retireDeliveredPosts([root, duplicate, root])) !== 1 ||
    (await account.retireDeliveredPosts([root])) !== 0
  )
    throw Error("Only the locally retained, confirmed row should retire");
  await checkReceiptsRestore(account, true);
}

export async function checkReceiptsRestore(account: Account, saved: boolean) {
  const [pending, replies, history] = await Promise.all([
    account.readPendingPosts({ channelId, after: 0, limit: 10 }),
    account.readPendingPosts({ channelId, rootId: root, after: 0, limit: 10 }),
    account.readChannelWindow({
      kind: "latest",
      channelId,
      collapsedThreads: false,
      limit: 10,
    }),
  ]);
  if (
    pending.length ||
    (saved
      ? replies.length !== 1 ||
        replies[0]?.confirmedPostId !== reply ||
        replies[0].message !== message ||
        history?.posts.map((post) => post.id).join(",") !==
          [duplicate, root].join(",")
      : replies.length || history !== null)
  )
    throw Error(
      "Delivery history and its retained receipt must belong to the restored account",
    );
}
