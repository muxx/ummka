import { invoke } from "@tauri-apps/api/core";
import type { ChannelWindowQuery } from "../../src/mattermost/local-history.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "../../src/mattermost/native-rest.ts";

const channelId = "c".repeat(26);
const root = "r".repeat(26);
const reply = "p".repeat(26);
const user = "Abc01234567890123456789012";
const latest = {
  kind: "latest",
  channelId,
  collapsedThreads: false,
  limit: 200,
} satisfies ChannelWindowQuery;

export async function expectCode(promise: Promise<unknown>, expected: string) {
  try {
    await promise;
  } catch (error) {
    if (error === expected) return;
    throw Error(
      `local history expected ${expected}, received ${String(error)}`,
    );
  }
  throw Error(`local history unexpectedly succeeded, expected ${expected}`);
}

// All subsequent reads run in newly launched host processes with this installation unavailable.
export async function checkUnavailableHistoryServer(origin: string) {
  const connection = await openAccountRestConnection(
    `${origin}/offline-history/one`,
    user,
  );
  try {
    const response = await connection.fetchApi(
      `${connection.basePath}/api/v4/users/me`,
    );
    if (response.status !== 503)
      throw Error("history fixture must be unavailable");
    await response.text();
  } finally {
    await connection.close();
  }
}

export async function checkOfflineWindows(origin: string) {
  for (const [name, userId] of [
    ["one", user],
    ["two", "b".repeat(26)],
  ] as const) {
    const base = `${origin}/offline-history/${name}`;
    const connection = await openAccountRestConnection(base, userId);
    try {
      const full = await connection.readChannelWindow(latest);
      const head = full?.posts[0];
      if (
        full?.posts.length !== 2 ||
        head?.id !== reply ||
        head.rootId !== root ||
        head.message !== `Offline reply for ${name}` ||
        full.posts[1]?.id !== root ||
        !full.posts[1].isPinned ||
        full.posts[1].messageSource !==
          "![sky](https://images.example.test/sky.png)" ||
        full.firstInaccessiblePostTime !== 70 ||
        full.newer.kind !== "end" ||
        full.older.kind !== "more" ||
        full.older.postId !== "q".repeat(26)
      )
        throw Error("wrong persisted offline account or post projection");

      const top = await connection.readChannelWindow({ ...latest, limit: 1 });
      if (
        top?.posts.length !== 1 ||
        top.older.kind !== "more" ||
        top.older.postId !== root
      )
        throw Error("offline latest limit or continuation");
      const around = {
        kind: "around",
        channelId,
        collapsedThreads: false,
        postId: root,
        newer: 0,
        older: 0,
      } satisfies ChannelWindowQuery;
      const middle = await connection.readChannelWindow(around);
      if (
        middle?.posts.length !== 1 ||
        middle.posts[0]?.id !== root ||
        middle.newer.kind !== "more" ||
        middle.newer.postId !== reply
      )
        throw Error("offline around anchor or continuation");
      const collapsed = await connection.readChannelWindow({
        ...latest,
        collapsedThreads: true,
      });
      if (
        collapsed?.posts.length !== 1 ||
        collapsed.posts[0]?.id !== root ||
        (await connection.readChannelWindow({
          ...around,
          collapsedThreads: true,
          postId: reply,
        })) !== null
      )
        throw Error(
          "hidden thread reply was made visible in the collapsed window",
        );
      const empty = await connection.readChannelWindow({
        ...latest,
        channelId: "f".repeat(26),
      });
      if (
        empty?.posts.length !== 0 ||
        empty.newer.kind !== "end" ||
        empty.older.kind !== "end" ||
        (await connection.readChannelWindow({
          ...latest,
          channelId: "u".repeat(26),
        })) !== null
      )
        throw Error("known empty and unknown channel histories differ");
      for (const query of [
        { ...latest, limit: 0 },
        { ...latest, limit: 201 },
        { ...around, newer: 100, older: 100 },
        { ...around, postId: "invalid" },
      ]) {
        await expectCode(
          connection.readChannelWindow(query),
          "invalid_history_request",
        );
      }
    } finally {
      await connection.close();
    }
    await expectCode(
      connection.readChannelWindow(latest),
      "unknown_connection",
    );
  }
  const publicConnection = await openNativeRestConnection(
    `${origin}/offline-history/one`,
  );
  try {
    await expectCode(
      invoke("read_channel_window", {
        rid: publicConnection.rid,
        query: latest,
      }),
      "session_unavailable",
    );
  } finally {
    await publicConnection.close();
  }
}
