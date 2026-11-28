import { expect, it, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { readChannelFilesPage } from "./channel-files-page.ts";

type Account = Parameters<typeof readChannelFilesPage>[0];
const channel = "c".repeat(26);
const team = "t".repeat(26);
const empty = { items: [], isEnd: true, firstInaccessibleFileTime: 0 };
function account() {
  return {
    readChannelIdentity: vi.fn<Account["readChannelIdentity"]>(),
    readFileSearchPage: vi.fn<Account["readFileSearchPage"]>(),
  };
}

it("keeps the channel filter, server order and retention boundary on every page", async () => {
  const api = account();
  const signal = new AbortController().signal;
  const page = {
    items: ["b", "a"].map((c) => ({
      id: c.repeat(26),
      name: "same.txt",
      channelId: channel,
      postId: null,
    })),
    isEnd: false,
    firstInaccessibleFileTime: 99,
  };
  api.readFileSearchPage.mockResolvedValue(page);
  expect(await readChannelFilesPage(api, team, channel, 1, signal)).toEqual(
    page,
  );
  expect(api.readFileSearchPage).toHaveBeenCalledExactlyOnceWith(
    {
      teamId: team,
      terms: `channel:${channel}`,
      page: 1,
      isOrSearch: false,
      includeDeletedChannels: false,
      timeZoneOffsetSeconds: 0,
    },
    signal,
  );
  expect(api.readChannelIdentity).not.toHaveBeenCalled();
});

it("verifies access before accepting an empty page", async () => {
  const api = account();
  const signal = new AbortController().signal;
  api.readFileSearchPage.mockResolvedValue(empty);
  api.readChannelIdentity.mockResolvedValue({
    id: channel,
    teamId: team,
    name: "releases",
    displayName: "Releases",
    kind: "P",
    deleteAt: 0,
  });
  expect(await readChannelFilesPage(api, team, channel, 0, signal)).toEqual(
    empty,
  );
  expect(api.readChannelIdentity).toHaveBeenCalledExactlyOnceWith(
    channel,
    signal,
  );
  const lostAccess = new Error("membership revoked");
  api.readChannelIdentity.mockRejectedValue(lostAccess);
  await expect(
    readChannelFilesPage(api, team, channel, 1, signal),
  ).rejects.toBe(lostAccess);
});

it("rejects a malformed channel filter and a response containing another channel's file", async () => {
  const api = account();
  const signal = new AbortController().signal;
  await expect(
    readChannelFilesPage(api, team, "c extra", 0, signal),
  ).rejects.toThrow();
  expect(api.readFileSearchPage).not.toHaveBeenCalled();
  api.readFileSearchPage.mockResolvedValue({
    ...empty,
    items: [channel, "s".repeat(26)].map((channelId, i) => ({
      id: String(i).repeat(26),
      channelId,
      postId: null,
      name: "same.txt",
    })),
  });
  await expect(
    readChannelFilesPage(api, team, channel, 0, signal),
  ).rejects.toThrow("outside");
});

it("drops a late empty result after leaving without starting another read", async () => {
  const api = account();
  const controller = new AbortController();
  api.readFileSearchPage.mockImplementation(async () => {
    controller.abort(new Error("left files"));
    return empty;
  });
  await expect(
    readChannelFilesPage(api, team, channel, 0, controller.signal),
  ).rejects.toBe(controller.signal.reason);
  expect(api.readChannelIdentity).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 500])(
  "preserves an identity HTTP %s error and only reports a channel denial",
  async (status) => {
    const api = account();
    const channelDenied = vi.fn();
    const denied = new ResponseError(new Response(null, { status }));
    api.readFileSearchPage.mockResolvedValue(empty);
    api.readChannelIdentity.mockRejectedValue(denied);
    await expect(
      readChannelFilesPage(
        api,
        team,
        channel,
        0,
        new AbortController().signal,
        channelDenied,
      ),
    ).rejects.toBe(denied);
    expect(channelDenied).toHaveBeenCalledTimes(
      status === 403 || status === 404 ? 1 : 0,
    );
  },
);
