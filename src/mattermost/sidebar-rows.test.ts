import { expect, test } from "vitest";
import { channelProfile, indexChannelProfiles } from "./channel-profiles.ts";
import { visibleSidebar } from "./sidebar-rows.ts";
import type { TeamSidebar } from "./team-sidebar.ts";
import { workspacePreferences } from "./workspace-preferences.ts";

type Channel = TeamSidebar["data"]["channels"][number] & { createAt?: number };
type Category = TeamSidebar["data"]["categories"][number];
const id = (n: number) => String(n).padStart(26, "0");
const me = id(1),
  peer = id(2);
const profiles = indexChannelProfiles([
  channelProfile({ id: me, username: "me" }),
  channelProfile({ id: peer, username: "peer", nickname: "Alex" }),
]);
function channel(
  n: number,
  kind: "O" | "P" | "D" | "G" = "O",
  changes: Partial<Channel> = {},
): Channel {
  return {
    id: id(n),
    kind,
    name: kind === "D" ? `${me}__${peer}` : `room-${n}`,
    displayName: `Room ${n}`,
    header: "",
    purpose: "",
    deleteAt: 0,
    lastPostAt: 100,
    lastRootPostAt: null,
    totalMsgCount: 10,
    totalMsgCountRoot: 5,
    lastViewedAt: 50,
    msgCount: 10,
    msgCountRoot: 5,
    mentionCount: 0,
    mentionCountRoot: 0,
    urgentMentionCount: 0,
    muted: false,
    ...changes,
  };
}
function category(
  kind: Category["kind"],
  ids: string[],
  changes: Partial<Category> = {},
): Category {
  return {
    id: kind,
    kind,
    channelIds: ids,
    displayName: kind,
    sorting: "manual",
    collapsed: false,
    muted: false,
    ...changes,
  };
}
const preferences = workspacePreferences(me, [], {}, {});
const ctx = {
  userId: me,
  profiles,
  preferences,
  compact: false,
  locale: "en" as const,
};

test("preserves the selected read DM and every unread above the limit, even after manual closure", () => {
  const chats = Array.from({ length: 15 }, (_, i) =>
    channel(10 + i, "D", {
      msgCount: i > 0 && i < 13 ? 9 : 10,
      lastViewedAt: i,
    }),
  );
  const source = {
    data: {
      channels: chats,
      categories: [
        category(
          "direct_messages",
          chats.map((c) => c.id),
        ),
      ],
    },
    selectedChannel: chats[0].id,
  };
  const result = visibleSidebar(source, {
    ...ctx,
    preferences: { ...preferences, limit: 10 },
  });
  expect(result[0].rows.map((r) => r.id)).toEqual(
    chats.slice(0, 13).map((c) => c.id),
  );
  expect(result[0].rows[0].current).toBe(true);
  expect(result[0].rows.filter((r) => r.unread)).toHaveLength(12);
  expect(source.data.categories[0].channelIds).toHaveLength(15);
});

test("applies CRT, muted mentions, managed/category precedence and stable manual order", () => {
  const a = channel(10, "O", { totalMsgCount: 15 }),
    b = channel(11, "O", {
      muted: true,
      mentionCount: 4,
      mentionCountRoot: 2,
      urgentMentionCount: 1,
    });
  const c = channel(12, "P", { deleteAt: 13 }),
    d = channel(13, "O", { deleteAt: 15 }),
    e = channel(14);
  const source = {
    data: {
      channels: [a, b, c, d, e],
      categories: [
        category("favorites", [b.id, c.id, e.id, d.id, a.id], {
          collapsed: true,
        }),
        category("managed", [a.id], { displayName: "Managed" }),
      ],
    },
    selectedChannel: c.id,
  };
  const result = visibleSidebar(source, {
    ...ctx,
    preferences: {
      ...preferences,
      collapsedThreads: true,
      separateUnreads: true,
    },
  });
  expect(result.map((r) => r.kind)).toEqual([
    "unreads",
    "managed",
    "favorites",
  ]);
  expect(result[0].rows[0]).toMatchObject({
    id: b.id,
    muted: true,
    mentions: 2,
    messages: 0,
    unread: true,
    urgent: true,
  });
  expect(result[1].rows.map((r) => r.id)).toEqual([a.id]);
  expect(result[2].rows).toHaveLength(1);
  expect(result[2].rows[0]).toMatchObject({
    id: c.id,
    archived: true,
    current: true,
  });
  const regular = visibleSidebar(source, ctx);
  expect(regular[0].rows[0]).toMatchObject({
    id: a.id,
    messages: 5,
    unread: true,
  });
  expect(regular[1].rows.map((r) => r.id)).toEqual([b.id, c.id]);
});

test("limits by read time, sorts display by activity, and keeps a known conversation in a custom category", () => {
  const old = channel(20, "D", { lastViewedAt: 3, lastPostAt: 500 }),
    recent = channel(21, "G", {
      lastViewedAt: 350,
      name: "group",
      displayName: "me, peer",
    }),
    self = channel(22, "D", { name: `${me}__${me}`, createAt: 900 });
  const missing = channel(23, "D", { name: `${me}__${id(80)}` });
  const policy = {
    ...preferences,
    limit: 2,
    directShown: {
      [peer]: true as const,
      [me]: true as const,
      [id(80)]: true as const,
    },
    groupShown: { [recent.id]: true as const },
    viewTimes: { [old.id]: 501, [self.id]: 600 },
  };
  const source = {
    data: {
      channels: [old, recent, self, missing],
      categories: [
        category("direct_messages", [old.id, recent.id, self.id], {
          sorting: "recent",
        }),
        category("custom", [missing.id]),
      ],
    },
    selectedChannel: null,
  };
  const result = visibleSidebar(source, { ...ctx, preferences: policy });
  expect(result[0].rows.map((r) => r.id)).toEqual([self.id, old.id]);
  expect(result[0].rows[0]).toMatchObject({ title: "me", self: true });
  expect(result[1].rows[0]).toMatchObject({ title: "Direct message" });
});

test("uses the authoritative username matches for groups and does not assign an ambiguous identity", () => {
  const one = channelProfile({ id: peer, username: "same", nickname: "First" });
  const two = channelProfile({
    id: id(3),
    username: "same",
    nickname: "Second",
  });
  expect(indexChannelProfiles([one, two]).byUsername.has("same")).toBe(false);
  const group = channel(75, "G", { displayName: "same, me", msgCount: 8 });
  const source = {
    data: {
      channels: [group],
      categories: [category("direct_messages", [group.id])],
    },
    selectedChannel: group.id,
  };
  const current = channelProfile({ id: me, username: "me" });
  const select = (names: Record<string, string>) =>
    visibleSidebar(source, {
      ...ctx,
      preferences: { ...preferences, nameFormat: "nickname_full_name" },
      profiles: indexChannelProfiles([one, current], names),
    });
  expect(select({ me })[0].rows[0].title).toBe("same, me");
  expect(select({ me, same: peer })[0].rows[0].title).toBe("First");
});

test("sorts names numerically, preserves equal keys, and keeps transient unreads reachable", () => {
  const a = channel(10),
    b = channel(2),
    c = channel(3, "O", { displayName: "Room 2" }),
    muted = channel(4, "O", { displayName: "A", muted: true });
  const source = {
    data: {
      channels: [a, b, c, muted],
      categories: [
        category("channels", [a.id, c.id, b.id, muted.id], {
          sorting: "alpha",
        }),
      ],
    },
    selectedChannel: b.id,
  };
  expect(visibleSidebar(source, ctx)[0].rows.map((v) => v.id)).toEqual([
    c.id,
    b.id,
    a.id,
    muted.id,
  ]);
  const result = visibleSidebar(source, {
    ...ctx,
    unreadOnly: true,
    lastUnread: { id: a.id, hadMentions: true },
  });
  expect(result[0].rows.map((v) => v.id)).toEqual([a.id, b.id]);
  expect(result[0].rows.every((v) => !v.unread)).toBe(true);
});

test("hides a read DM closed after the last view and admits it again after an explicit later view", () => {
  const p = channelProfile({
    id: peer,
    username: "peer",
    deleteAt: 200,
    isBot: true,
    roles: "system_guest",
  });
  const row = channel(60, "D");
  const source = {
    data: {
      channels: [row],
      categories: [category("direct_messages", [row.id])],
    },
    selectedChannel: null,
  };
  const options = {
    ...ctx,
    profiles: indexChannelProfiles([p]),
    preferences: { ...preferences, directShown: { [peer]: true as const } },
  };
  expect(visibleSidebar(source, options)[0].rows).toHaveLength(0);
  const visible = visibleSidebar(source, {
    ...options,
    preferences: { ...options.preferences, viewTimes: { [row.id]: 201 } },
  });
  expect(visible[0].rows[0]).toMatchObject({
    deactivated: true,
    bot: true,
    guest: true,
  });
});

test.each([107, 5000])(
  "returns all %i joined channels with one selected row",
  (size) => {
    const channels = Array.from({ length: size }, (_, n) => channel(n + 3));
    const ids = channels.map((c) => c.id).reverse();
    const source = {
      data: {
        channels,
        categories: [category("channels", ids, { sorting: "alpha" })],
      },
      selectedChannel: ids[0],
    };
    const result = visibleSidebar(source, ctx);
    expect(result[0].rows.map((r) => r.id)).toEqual(channels.map((c) => c.id));
    expect(result[0].rows.filter((r) => r.current)).toHaveLength(1);
  },
);
