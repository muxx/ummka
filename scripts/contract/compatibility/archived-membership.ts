import assert from "node:assert/strict";
import { readOwnChannelMembership } from "../../../src/mattermost/own-channel-membership.ts";
import { changeOwnMembership } from "../../../src/mattermost/own-membership.ts";
import {
  ChannelsApi,
  type Configuration,
  PostsApi,
  ResponseError,
  SystemApi,
} from "../../../vendor/mattermost/index.js";

export async function checkArchivedOwnChannelMembership(
  member: Configuration,
  userId: string,
  teamId: string,
  channelId: string,
  adminHeaders: { Authorization: string },
  version: string,
) {
  const channels = new ChannelsApi(member);
  const read = () =>
    readOwnChannelMembership(member, userId, teamId, channelId);
  const members = await channels.getChannelMembers({ channelId });
  assert.deepEqual(
    members.map((row) => row.userId),
    [userId],
  );
  assert.equal(await read(), "member");

  const archive = await fetch(
    `${member.basePath}/api/v4/channels/${channelId}`,
    {
      method: "DELETE",
      headers: adminHeaders,
    },
  );
  assert.equal(archive.status, 200);
  assert.equal((await archive.json()).status, "OK");
  assert.equal(await read(), "member");

  const legacy = version === "10.10.1";
  const config = await new SystemApi(member).getClientConfigRaw({
    format: "old",
  });
  const original = (await config.raw.json()).ExperimentalViewArchivedChannels;
  if (legacy) assert.ok(original === "true" || original === "false");
  else assert.equal(original, undefined);

  async function setArchiveVisibility(enabled: boolean) {
    const patched = await fetch(`${member.basePath}/api/v4/config/patch`, {
      method: "PUT",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        TeamSettings: { ExperimentalViewArchivedChannels: enabled },
      }),
    });
    assert.equal(patched.status, 200);
    await patched.body?.cancel();
  }

  try {
    if (original === "true") await setArchiveVisibility(false);
    const posts = new PostsApi(member).getPostsForChannel({
      channelId,
      perPage: 1,
    });
    if (legacy) {
      await assert.rejects(
        posts,
        (e: unknown) => e instanceof ResponseError && e.response.status === 403,
      );
    } else {
      assert.ok(Array.isArray((await posts).order));
    }
    assert.equal(await read(), "member");
    assert.deepEqual(
      await changeOwnMembership(
        member,
        userId,
        { kind: "channel", id: channelId },
        "leave",
      ),
      { kind: "applied" },
    );
    assert.equal(await read(), "absent");
  } finally {
    if (original === "true") await setArchiveVisibility(true);
  }
  console.log(
    `Mattermost ${version} verified archived channel membership and the last member leaving a private archive.`,
  );
}
