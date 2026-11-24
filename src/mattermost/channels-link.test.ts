import { describe, expect, expectTypeOf, it } from "vitest";
import { type ChannelsTarget, parseChannelsLink } from "./channels-link.ts";

const postId = "c18xpcpusjd88en1g4j7us31ur";
const userId = "u".repeat(26);
const group = "a".repeat(40);

describe.each(["https://chat.example.test", "https://chat.example.test/mm"])(
  "links on %s",
  (serverUrl) => {
    it.each([
      ["channels", "town-square", "town-square"],
      ["channels", userId, userId],
      ["channels", `${userId}__${postId}`, `${userId}__${postId}`],
      ["messages", "@alice", "@alice"],
      ["messages", "%40Ada%3Aremote", "@Ada:remote"],
      ["messages", "Ada%40example.test", "Ada@example.test"],
      ["messages", userId, userId],
      ["messages", group, group],
    ])(
      "preserves the %s identifier %s and optional post",
      (route, encoded, identifier) => {
        const url = `${serverUrl}/spin-punch/${route}/${encoded}`;
        const expected = {
          kind: "conversation",
          serverUrl,
          team: "spin-punch",
          route,
          identifier,
        };
        expect(parseChannelsLink(serverUrl, url)).toEqual({
          ...expected,
          postId: null,
        });
        expect(parseChannelsLink(serverUrl, `${url}/${postId}/`)).toEqual({
          ...expected,
          postId,
        });
      },
    );

    it("preserves the team on a permalink and defers it on _redirect", () => {
      for (const team of ["spin-punch", "_redirect"]) {
        const target = parseChannelsLink(
          serverUrl,
          `${serverUrl}/${team}/pl/${postId}`,
        );
        expectTypeOf(target).toEqualTypeOf<ChannelsTarget | null>();
        expect(target).toEqual({
          kind: "permalink",
          serverUrl,
          team: team === "_redirect" ? null : team,
          postId,
        });
      }
    });

    it("distinguishes a thread list, a specific thread and a channel named threads", () => {
      const url = `${serverUrl}/team/threads`;
      const expected = { kind: "threads", serverUrl, team: "team" };
      expect(parseChannelsLink(serverUrl, url)).toEqual({
        ...expected,
        threadId: null,
      });
      expect(parseChannelsLink(serverUrl, `${url}/${postId}`)).toEqual({
        ...expected,
        threadId: postId,
      });
      expect(
        parseChannelsLink(serverUrl, `${serverUrl}/team/channels/threads`),
      ).toEqual({
        kind: "conversation",
        serverUrl,
        team: "team",
        route: "channels",
        identifier: "threads",
        postId: null,
      });
    });
  },
);

it("keeps the installation's canonical authority and exact encoded mount", () => {
  const server = " HTTPS://CHAT.Example.Test:443/Big%20Team//A%2FB/// ";
  const serverUrl = "https://chat.example.test/Big%20Team//A%2FB";
  const target = {
    kind: "conversation",
    serverUrl,
    team: "blue",
    route: "channels",
    identifier: "town-square",
    postId: null,
  };
  expect(
    parseChannelsLink(server, `${serverUrl}/blue/channels/town-square`),
  ).toEqual(target);
  for (const other of [
    "https://chat.example.test/Big%20Team/A%2FB",
    "https://chat.example.test/Big%20Team//A/B",
    "https://chat.example.test/Big%20Team//A%2Fb",
    "https://chat.example.test/big%20Team//A%2FB",
    `${serverUrl}-two`,
    "https://other.example.test/Big%20Team//A%2FB",
    "http://chat.example.test/Big%20Team//A%2FB",
    "https://chat.example.test:8443/Big%20Team//A%2FB",
  ]) {
    expect(
      parseChannelsLink(server, `${other}/blue/channels/town-square`),
    ).toBeNull();
  }
});

it("associates the same path with the supplied server", () => {
  for (const serverUrl of [
    "http://[::1]:8065",
    "https://chat.example.test/mm-two",
  ]) {
    expect(
      parseChannelsLink(serverUrl, `${serverUrl}/team/pl/${postId}`),
    ).toEqual({ kind: "permalink", serverUrl, team: "team", postId });
  }
  expect(
    parseChannelsLink(
      "https://chat.example.test/mm",
      `https://chat.example.test/mm-two/team/pl/${postId}`,
    ),
  ).toBeNull();
});

it("matches the public Mattermost WebApp's redirect permalink example", () => {
  const serverUrl = "http://my.site.com";
  expect(
    parseChannelsLink(
      serverUrl,
      "http://my.site.com/_redirect/pl/c18xpcpusjd88en1g4j7us31ur",
    ),
  ).toEqual({
    kind: "permalink",
    serverUrl,
    team: null,
    postId,
  });
});

it("accepts only teams that the server can create", () => {
  const serverUrl = "https://chat.example.test";
  for (const team of [
    "aa",
    "aa__bb",
    "spin--punch",
    "spin-punch-admin",
    "a".repeat(64),
  ]) {
    expect(
      parseChannelsLink(serverUrl, `${serverUrl}/${team}/threads`),
    ).toEqual({
      kind: "threads",
      serverUrl,
      team,
      threadId: null,
    });
  }
  for (const team of [
    "a",
    "a".repeat(65),
    "spin_punch",
    "a__b-c",
    "a__b__c",
    "-ab",
    "ab-",
    "Team",
    "admin-tools",
    "apiculture",
    "_redirect",
    "_popout",
  ]) {
    expect(
      parseChannelsLink(serverUrl, `${serverUrl}/${team}/channels/town-square`),
    ).toBeNull();
  }
});

it("gives a top-level WebApp page precedence over all team routes", () => {
  const base = "https://chat.example.test";
  for (const path of [
    "channels/town-square",
    "messages/@alice",
    "threads",
    `pl/${postId}`,
  ]) {
    expect(
      parseChannelsLink(base, `${base}/preparing-workspace/${path}`),
    ).toBeNull();
  }
  expect(
    parseChannelsLink(base, `${base}/preparing-workspace-two/threads`),
  ).toEqual({
    kind: "threads",
    serverUrl: base,
    team: "preparing-workspace-two",
    threadId: null,
  });
});

it.each([
  "/",
  "/team/",
  "/team/channels",
  "/team/channels/",
  "/team//channels/town-square",
  "/team/channels/.name",
  "/team/channels/two//",
  "/team/Channels/town-square",
  "/team/channels/hello%2Fworld",
  "/team/messages/%2540Ada",
  "/team/messages/%C3%28",
  "/team/messages/%",
  "/team/messages/A%5CB",
  "/team/messages/u%00v",
  "/team/pl",
  "/team/pl/short",
  `/team/pl/${postId.toUpperCase()}`,
  `/team/pl/${postId}/extra`,
  "/team/threads//",
  `/team/threads/${postId}/extra`,
  "/team/channels/town-square/short",
  `/team/channels/town-square/${postId}/extra`,
  "/_redirect/threads",
  "/login/desktop",
  "/api/v4/system/ping",
  "/admin_console/channels/town-square",
  "/team/_playbooks/id/run",
  "/team/drafts",
  "/team/channels/town-square?",
  "/team/channels/town-square?action=open_invitation_modal",
  "/team/channels/town-square#",
  "/team/channels/town-square#section",
])("leaves an unsupported path unhandled (%s)", (path) => {
  const base = "https://chat.example.test";
  expect(parseChannelsLink(base, base + path)).toBeNull();
});

it("rejects malformed and non-HTTP links while keeping a bad installation distinguishable", () => {
  for (const href of [
    "",
    "/team/channels/town-square",
    "//chat.example.test/team/channels/town-square",
    "https:///chat.example.test/team/threads",
    "mattermost://chat.example.test/team/threads",
    "https://@chat.example.test/team/threads",
    "https://person@chat.example.test/team/threads",
    "https://chat.example.test:65536/team/threads",
  ]) {
    expect(parseChannelsLink("https://chat.example.test", href)).toBeNull();
  }
  expect(() => parseChannelsLink("/bad-installation", "/bad-link")).toThrow(
    new TypeError("Invalid Mattermost server URL"),
  );
});
