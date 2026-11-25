import assert from "node:assert/strict";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkChannelAudience(
  base: string,
  dm: { id: string; postId: string },
  closedId: string,
  owner: { id: string; token: string },
  reader: { id: string; token: string },
) {
  const channels = new ChannelsApi(
    new Configuration({ basePath: base, accessToken: reader.token }),
  );
  const anonymous = new ChannelsApi(new Configuration({ basePath: base }));
  const channel = { channelId: dm.id };
  const baseline = {
    channelId: dm.id,
    memberCount: 2,
    guestCount: 0,
    pinnedpostCount: 0,
    filesCount: 0,
  };
  assert.deepEqual(await channels.getChannelStats(channel), baseline);
  assert.equal(await channels.getChannelMembersTimezones(channel), null);
  for (const [api, channelId, status] of [
    [channels, closedId, 403],
    [anonymous, dm.id, 401],
  ] as const) {
    const refused = (error: unknown) =>
      error instanceof ResponseError && error.response.status === status;
    await assert.rejects(api.getChannelStats({ channelId }), refused);
    await assert.rejects(
      api.getChannelMembersTimezones({ channelId }),
      refused,
    );
  }
  const pin = await fetch(`${base}/api/v4/posts/${dm.postId}/pin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(pin.status, 200);
  assert.deepEqual(
    await channels.getChannelStats({ ...channel, excludeFilesCount: true }),
    {
      ...baseline,
      pinnedpostCount: 1,
      filesCount: -1,
    },
  );

  for (const [user, zone] of [
    [owner, "Europe/Paris"],
    [reader, "Asia/Tokyo"],
  ] as const) {
    const updated = await fetch(`${base}/api/v4/users/${user.id}/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timezone: {
          useAutomaticTimezone: "false",
          manualTimezone: zone,
          automaticTimezone: "",
        },
      }),
    });
    assert.equal(updated.status, 200);
  }
  const timezones = await channels.getChannelMembersTimezones(channel);
  assert.deepEqual(timezones?.sort(), ["Asia/Tokyo", "Europe/Paris"]);
}
