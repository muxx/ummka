import { expect, test } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountChannelAudience } from "../mattermost/channel-audience.ts";
import { readBroadcastDecision } from "./broadcast-audience.ts";

const channelId = "c".repeat(26);
const policy = {
  canMentionChannel: true,
  canMentionGroups: false,
  confirmNotifications: true,
  maxNotificationsPerChannel: 7n,
};

function stats(count: unknown, id = channelId) {
  return Response.json({
    channel_id: id,
    member_count: count,
    files_count: -1,
    guest_count: 0,
    pinnedpost_count: 0,
  });
}

function fixture(
  reply: (
    step: string,
    signal?: AbortSignal | null,
  ) => Response | Promise<Response>,
) {
  const visits: string[] = [];
  const config = new Configuration({
    basePath: "https://chat.example.org/team/chat",
    fetchApi: async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://chat.example.org");
      expect(init?.method).toBe("GET");
      const step = url.pathname.split("/").at(-1) ?? "";
      expect(["stats", "timezones"]).toContain(step);
      expect(url.pathname).toBe(
        `/team/chat/api/v4/channels/${channelId}/${step}`,
      );
      expect(url.search).toBe(
        step === "stats" ? "?exclude_files_count=true" : "",
      );
      visits.push(step);
      return reply(step, init?.signal);
    },
  });
  return { account: accountChannelAudience(config, (read) => read()), visits };
}

test("ordinary text and missing permission need no channel counts", async () => {
  const { account, visits } = fixture(() => {
    throw Error("Unexpected request.");
  });
  expect(
    (await readBroadcastDecision(account, channelId, [], policy)).confirmation,
  ).toBeNull();
  expect(
    (
      await readBroadcastDecision(account, channelId, ["@here"], {
        ...policy,
        canMentionChannel: false,
      })
    ).channelSuppression,
  ).toBe("permission");
  expect(visits).toEqual([]);
});

test.each([
  [5, true, null],
  [6, false, null],
  [7, true, "limit"],
  [8, false, "limit"],
] as const)(
  "reads only statistics for %i members and confirm=%s",
  async (members, confirmNotifications, suppression) => {
    const { account, visits } = fixture(() => stats(members));
    const result = await readBroadcastDecision(
      account,
      channelId,
      ["@channel"],
      { ...policy, confirmNotifications },
    );
    expect(result.confirmation).toBeNull();
    expect(result.channelSuppression).toBe(suppression);
    expect(visits).toEqual(["stats"]);
  },
);

test.each([
  [null, 0],
  [[], 0],
  [["Europe/Moscow", "Asia/Tokyo"], 2],
] as const)(
  "reads timezones once when the channel decision asks for confirmation",
  async (zones, count) => {
    const { account, visits } = fixture((step) =>
      step === "stats" ? stats(6) : Response.json(zones),
    );
    const result = await readBroadcastDecision(
      account,
      channelId,
      ["@here", "@all"],
      policy,
    );
    expect(result.confirmation).toEqual({
      kind: "channel",
      mentions: ["@here", "@all"],
      members: 5,
      timezones: count,
    });
    expect(visits).toEqual(["stats", "timezones"]);
  },
);

test("rejects a foreign, incomplete or malformed response and preserves HTTP errors", async () => {
  for (const bad of [
    stats(6, "x".repeat(26)),
    stats(-1),
    stats(5.5),
    stats("6"),
    stats(undefined),
    Response.json(null),
  ]) {
    const { account, visits } = fixture(() => bad);
    await expect(
      readBroadcastDecision(account, channelId, ["@all"], policy),
    ).rejects.toThrow();
    expect(visits).toEqual(["stats"]);
  }
  for (const bad of [{}, [17]]) {
    const { account } = fixture((step) =>
      step === "stats" ? stats(6) : Response.json(bad),
    );
    await expect(
      readBroadcastDecision(account, channelId, ["@all"], policy),
    ).rejects.toThrow("Invalid Mattermost channel timezones");
  }
  const { account, visits } = fixture(
    () => new Response(null, { status: 403 }),
  );
  await expect(
    readBroadcastDecision(account, "invalid", ["@all"], policy),
  ).rejects.toThrow("channel ID");
  expect(visits).toEqual([]);
  await expect(
    readBroadcastDecision(account, channelId, ["@all"], policy),
  ).rejects.toBeInstanceOf(ResponseError);
  expect(visits).toEqual(["stats"]);
});

test.each(["before", "stats", "timezones"])(
  "discard a decision when cancelled at %s",
  async (when) => {
    const controller = new AbortController();
    const reason = Error("Composer switched to another channel.");
    const { account, visits } = fixture((step, signal) => {
      expect(signal).toBe(controller.signal);
      if (step === when) controller.abort(reason);
      return step === "stats" ? stats(6) : Response.json(["Europe/Moscow"]);
    });
    if (when === "before") controller.abort(reason);
    await expect(
      readBroadcastDecision(
        account,
        channelId,
        ["@here"],
        policy,
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(visits).toEqual(
      when === "before"
        ? []
        : when === "stats"
          ? ["stats"]
          : ["stats", "timezones"],
    );
  },
);
