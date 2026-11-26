import { expect, test } from "vitest";
import { channelProfile, indexChannelProfiles } from "./channel-profiles.ts";
import { prepareKnownConversationSearch } from "./known-conversation-search.ts";
import type { TeamSidebar } from "./team-sidebar.ts";
import { workspacePreferences } from "./workspace-preferences.ts";

type Channel = TeamSidebar["data"]["channels"][number];
const id = (n: number) => String(n).padStart(26, "0");
const me = id(1),
  peer = id(2);
const person = channelProfile({
  id: peer,
  username: "bear",
  firstName: "Семён",
  lastName: "Серов",
  nickname: "Умка",
  remoteId: id(88),
  props: { RemoteUsername: "remote.bear" },
  deleteAt: 2,
});
const ctx = {
  userId: me,
  profiles: indexChannelProfiles([person]),
  preferences: workspacePreferences(me, [], {}, {}),
  locale: "ru" as const,
};
function channel(
  n: number,
  title: string,
  changes: Partial<Channel> = {},
): Channel {
  return {
    id: id(n),
    kind: "O",
    name: `channel-${n}`,
    displayName: title,
    header: "header-only",
    purpose: "purpose-only",
    createAt: 9,
    deleteAt: 0,
    lastPostAt: 100,
    lastRootPostAt: null,
    totalMsgCount: 1,
    totalMsgCountRoot: null,
    lastViewedAt: 0,
    msgCount: 1,
    msgCountRoot: null,
    mentionCount: null,
    mentionCountRoot: null,
    urgentMentionCount: null,
    muted: false,
    ...changes,
  };
}
function snapshot(
  channels: Channel[],
  selectedChannel: string | null = null,
): TeamSidebar {
  return { data: { channels, categories: [] }, selectedChannel };
}

test("prefix matches precede substrings and archives, independent of the input order", () => {
  const rows = [
    channel(10, "Общий план", { lastViewedAt: 500 }),
    channel(11, "Планирование", { kind: "P" }),
    channel(12, "Старый канал", {
      name: "план-архив",
      deleteAt: 1,
      lastViewedAt: 900,
    }),
    channel(13, "Смета", { name: "план-смета", lastViewedAt: 50 }),
  ];
  for (const channels of [rows, [...rows].reverse()]) {
    const search = prepareKnownConversationSearch(snapshot(channels), ctx, []);
    expect(search("  #ПЛАН  ").map((row) => row.id)).toEqual(
      [13, 11, 10, 12].map(id),
    );
    expect(search("план").at(-1)?.archived).toBe(true);
    expect(search("~канал").map((row) => row.id)).toEqual([id(12)]);
    expect(search("purpose-only")).toEqual([]);
    expect(search("header-only")).toEqual([]);
  }
});

test("hidden DMs and groups match known human names without exposing wire identifiers", () => {
  const dm = channel(21, "", { kind: "D", name: `${peer}__${me}` });
  const group = channel(22, "bear, fox", {
    kind: "G",
    name: "group-wire-name",
  });
  const missing = channel(23, "", { kind: "D", name: `${me}__${id(3)}` });
  const emptyGroup = channel(24, "", { kind: "G", name: "opaque-group-name" });
  const team = snapshot([dm, group, missing, emptyGroup], missing.id);
  const search = prepareKnownConversationSearch(team, ctx, []);
  for (const term of [" @BEAR ", "семен", "УМКА", "remote.bear"])
    expect(
      search(term)
        .map((row) => row.id)
        .sort(),
    ).toEqual([dm.id, group.id]);
  expect(search("fox").map((row) => row.id)).toEqual([group.id]);
  expect(search("умка").find((row) => row.id === dm.id)?.deactivated).toBe(
    true,
  );
  for (const term of [peer, "group-wire-name", "opaque-group-name"])
    expect(search(term)).toEqual([]);
  expect(search("")[0]?.title).toBe("Личное сообщение");
  const emptyGroupRecent = prepareKnownConversationSearch(team, ctx, [
    emptyGroup.id,
  ])("");
  expect(emptyGroupRecent[1]?.title).toBe("Групповая переписка");

  const previousAccount = prepareKnownConversationSearch(
    snapshot([]),
    { ...ctx, userId: id(3) },
    [dm.id],
  );
  expect(previousAccount("bear")).toEqual([]);
  expect(previousAccount("")).toEqual([]);
  const withoutProfiles = prepareKnownConversationSearch(
    team,
    {
      ...ctx,
      locale: "en",
      profiles: indexChannelProfiles([]),
    },
    [],
  );
  expect(withoutProfiles("Умка")).toEqual([]);
  expect(withoutProfiles("")[0]?.title).toBe("Direct message");
});

test.each([
  ["en", "Group message"],
  ["ru", "Групповая переписка"],
] as const)(
  "an opaque group display name stays out of %s recents and search keys",
  (locale, label) => {
    const wireName = "opaque-group-name";
    const group = channel(29, wireName, { kind: "G", name: wireName });
    const search = prepareKnownConversationSearch(
      snapshot([group], group.id),
      {
        ...ctx,
        locale,
        profiles: indexChannelProfiles([]),
      },
      [],
    );
    expect({
      title: search("")[0]?.title,
      byName: search(wireName).length,
      byPart: search("opaque").length,
    }).toEqual({ title: label, byName: 0, byPart: 0 });
  },
);

test("recents use visits, not last post, skip departed rows and keep at most eight contacts", () => {
  const known = Array.from({ length: 10 }, (_, i) =>
    channel(30 + i, `Room ${i}`, { lastViewedAt: i + 1 }),
  );
  const untouched = channel(50, "New messages", {
    lastPostAt: 1000,
    totalMsgCount: 200,
  });
  const team = snapshot([...known, untouched], id(31));
  const search = prepareKnownConversationSearch(
    team,
    {
      ...ctx,
      preferences: { ...ctx.preferences, viewTimes: { [id(30)]: 500 } },
    },
    [id(32), id(999), id(32), id(31)],
  );
  for (const probe of ["", " ", "#", "~", "@"]) {
    expect(search(probe).map((row) => row.id)).toEqual(
      [31, 32, 30, 39, 38, 37, 36, 35].map(id),
    );
  }
  expect(
    prepareKnownConversationSearch(snapshot([untouched]), ctx, [])(""),
  ).toEqual([]);
  expect(
    prepareKnownConversationSearch(snapshot([untouched]), ctx, [id(31)])(
      "#Room",
    ),
  ).toEqual([]);
});

test("all known conversations compete for fourteen slots before the result is limited", () => {
  const rows = Array.from({ length: 28 }, (_, i) =>
    channel(100 + i, i < 16 ? `Other match ${i}` : `Match ${i}`, {
      lastViewedAt: 400 - i,
    }),
  );
  const result = prepareKnownConversationSearch(
    snapshot(rows),
    ctx,
    [],
  )("match");
  expect(result.map((row) => row.id)).toEqual([
    ...rows.slice(16).map((row) => row.id),
    rows[0].id,
    rows[1].id,
  ]);
});

test("equal visit times use localized numeric titles and a stable identity", () => {
  const rooms = [
    channel(81, "Room 11"),
    channel(83, "Room 2"),
    channel(82, "Room 2"),
  ];
  const search = prepareKnownConversationSearch(
    snapshot(rooms),
    { ...ctx, locale: "en" },
    [],
  );
  expect(search("room").map((row) => row.id)).toEqual([82, 83, 81].map(id));
});
