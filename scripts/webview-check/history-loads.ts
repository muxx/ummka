import { invoke } from "@tauri-apps/api/core";
import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { expectCode } from "./local-history.ts";

const channel = "v".repeat(26);
const user = "Abc01234567890123456789012";
const postId = "h".repeat(26);
const newId = "j".repeat(26);
const read = {
  kind: "latest",
  channelId: channel,
  collapsedThreads: false,
  limit: 20,
} as const;

function saved(id: string, stamp: number) {
  return {
    kind: "save",
    id,
    channelId: channel,
    userId: user,
    rootId: null,
    createAt: stamp,
    updateAt: stamp,
    editAt: 0,
    type: "",
    message: `Downloaded ${id}`,
    messageSource: null,
    hashtags: "",
    isPinned: false,
  };
}

const page = {
  channelId: channel,
  collapsedThreads: false,
  source: { kind: "latest" },
  order: [newId, postId],
  changes: [saved(newId, 110), saved(postId, 100)],
  prevPostId: "",
  nextPostId: "",
  firstInaccessiblePostTime: 0,
};

type Outcome =
  | { kind: "applied" | "superseded" }
  | { kind: "inaccessible"; firstInaccessiblePostTime: number };
const begin = (rid: number) =>
  invoke<number>("begin_channel_history_load", { rid, channelId: channel });
const store = (rid: number, load: number, page: unknown) =>
  invoke<Outcome>("store_channel_history_page", { rid, load, page });

export async function prepareHistoryLoads(origin: string) {
  const base = `${origin}/offline-history/one`;
  const first = await openAccountRestConnection(base, user);
  const second = await openAccountRestConnection(base, user);
  const other = await openAccountRestConnection(
    `${origin}/offline-history/two`,
    "b".repeat(26),
  );
  let abandoned: number;
  try {
    const ticket = await begin(first.rid);
    for (const rid of [second.rid, other.rid])
      await expectCode(store(rid, ticket, page), "unknown_history_load");
    if ((await store(first.rid, ticket, page)).kind !== "applied")
      throw Error("initial local history write");
    await expectCode(store(first.rid, ticket, page), "unknown_history_load");

    for (const invalid of [
      null,
      { ...page, channelId: "z".repeat(26) },
      { ...page, order: [newId, newId] },
    ]) {
      const bad = await begin(first.rid);
      await expectCode(
        store(first.rid, bad, invalid),
        "invalid_history_request",
      );
      await expectCode(store(first.rid, bad, page), "unknown_history_load");
    }
    const cancelled = await begin(first.rid);
    await invoke("cancel_channel_history_load", {
      rid: first.rid,
      load: cancelled,
    });
    await expectCode(store(first.rid, cancelled, page), "unknown_history_load");

    const archived = await store(first.rid, await begin(first.rid), {
      ...page,
      collapsedThreads: true,
      source: { kind: "focused", postId },
      order: [],
      changes: [],
      firstInaccessiblePostTime: 90,
    });
    if (
      archived.kind !== "inaccessible" ||
      archived.firstInaccessiblePostTime !== 90
    )
      throw Error("archive boundary lost on local history write");

    const changes = (rid: number, load: number, updates: unknown) =>
      invoke<Outcome>("store_channel_history_changes", {
        rid,
        load,
        changes: updates,
      });
    const edit = {
      ...saved(newId, 110),
      updateAt: 112,
      editAt: 112,
      message: "peer edit",
    };
    const editTicket = await begin(first.rid);
    await expectCode(
      changes(other.rid, editTicket, [edit]),
      "unknown_history_load",
    );
    const before = await first.readChannelWindow(read);
    if ((await changes(first.rid, editTicket, [edit])).kind !== "applied")
      throw Error("point edit not stored");
    const after = await first.readChannelWindow(read);
    if (
      !before ||
      !after ||
      after.posts.find((post) => post.id === newId)?.message !== "peer edit" ||
      before.posts.map((post) => post.id).join() !==
        after.posts.map((post) => post.id).join()
    )
      throw Error("point edit changed timeline order");
    const invalidTicket = await begin(first.rid);
    await expectCode(
      changes(first.rid, invalidTicket, Array(201).fill(edit)),
      "invalid_history_request",
    );
    await expectCode(
      changes(first.rid, invalidTicket, []),
      "unknown_history_load",
    );

    const old = await begin(first.rid);
    const removal = [{ kind: "remove", id: postId, channelId: channel }];
    if (
      (await changes(second.rid, await begin(second.rid), removal)).kind !==
        "applied" ||
      (await store(first.rid, old, page)).kind !== "superseded"
    )
      throw Error("late page restored a removed post");

    abandoned = await begin(second.rid);
  } finally {
    await Promise.all([first.close(), second.close(), other.close()]);
  }
  await expectCode(store(second.rid, abandoned, page), "unknown_connection");
}

export async function verifyHistoryLoadsAfterRestart(origin: string) {
  for (const [name, uid] of [
    ["one", user],
    ["two", "b".repeat(26)],
  ] as const) {
    const connection = await openAccountRestConnection(
      `${origin}/offline-history/${name}`,
      uid,
    );
    try {
      const result = await connection.readChannelWindow(read);
      if (
        name === "one"
          ? result?.posts.length !== 1 || result.posts[0]?.id !== newId
          : result !== null
      )
        throw Error(
          "wrong durable channel after independent writes and process restart",
        );
    } finally {
      await connection.close();
    }
  }
}
