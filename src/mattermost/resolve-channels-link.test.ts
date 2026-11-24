import { beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import type { ChannelsTarget } from "./channels-link.ts";
import { listInstallations } from "./installation-registry.ts";
import { resolveChannelsLink } from "./resolve-channels-link.ts";

vi.mock("./installation-registry.ts", () => ({ listInstallations: vi.fn() }));
const list = vi.mocked(listInstallations);
const root = "https://chat.example.test";
const parent = `${root}/mm`;
const inner = `${parent}/Team%2FOne//East`;
const id = "c18xpcpusjd88en1g4j7us31ur";
beforeEach(() => list.mockReset());

test("opens the referenced installation's permalink across servers", async () => {
  list.mockResolvedValue(["https://other.example.test", root]);
  const result = resolveChannelsLink(
    ` HTTPS://CHAT.example.test:443/team/pl/${id} `,
  );
  expectTypeOf(result).toEqualTypeOf<Promise<ChannelsTarget | null>>();
  expect(await result).toEqual({
    serverUrl: root,
    kind: "permalink",
    team: "team",
    postId: id,
  });
  expect(list).toHaveBeenCalledExactlyOnceWith();
});

test.each([
  [root, parent, inner],
  [root, inner, parent],
  [parent, root, inner],
  [parent, inner, root],
  [inner, root, parent],
  [inner, parent, root],
])("matches the deepest installation in order %s, %s, %s", async (...order) => {
  list.mockResolvedValue(order);
  expect(
    await resolveChannelsLink(`${inner}/team/messages/%40Ada%3Aremote`),
  ).toEqual({
    serverUrl: inner,
    kind: "conversation",
    route: "messages",
    team: "team",
    identifier: "@Ada:remote",
    postId: null,
  });
  expect(list).toHaveBeenCalledExactlyOnceWith();
});

test.each([
  "https://chat.example.test:8443/mm",
  "http://chat.example.test/mm",
  "https://child.chat.example.test/mm",
  "https://chat.example.test.evil.test/mm",
  "https://chat.example.test/MM",
  "https://chat.example.test/mm-extra",
  "https://chat.example.test/mm%2Fteam",
])(
  "keeps an adjacent installation outside the registered base: %s",
  async (other) => {
    list.mockResolvedValue([parent]);
    expect(await resolveChannelsLink(`${other}/team/pl/${id}`)).toBeNull();
    expect(list).toHaveBeenCalledExactlyOnceWith();
  },
);

test.each([
  [`${root}/alpha/channels`, `${root}/alpha/channels/town-square`],
  [`${root}/alpha/channels/town-square`, `${root}/alpha/channels/town-square`],
  [`${root}/alpha/channels/town-square`, `${root}/alpha/channels/town-square/`],
])(
  "a nested installation owns its URL even when it has no Channels target",
  async (nested, href) => {
    list.mockResolvedValue([root, nested]);
    expect(await resolveChannelsLink(href)).toBeNull();
  },
);

test.each([
  "relative",
  "mattermost://chat.example.test/team/threads",
  `https://user@chat.example.test/team/pl/${id}`,
  `${root}/team/threads?`,
  `${root}/team/threads#`,
  `${root}/team/%00/room`,
])("rejects invalid input before accessing storage: %s", async (href) => {
  expect(await resolveChannelsLink(href)).toBeNull();
  expect(list).not.toHaveBeenCalled();
});

test("uses the current registry on each call and preserves a failed read", async () => {
  list
    .mockResolvedValueOnce([parent])
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce("storage");
  const href = `${parent}/_redirect/pl/${id}`;
  expect(await resolveChannelsLink(href)).toEqual({
    serverUrl: parent,
    kind: "permalink",
    team: null,
    postId: id,
  });
  expect(await resolveChannelsLink(href)).toBeNull();
  await expect(resolveChannelsLink(href)).rejects.toBe("storage");
  expect(list).toHaveBeenCalledTimes(3);
});
