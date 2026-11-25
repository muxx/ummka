import assert from "node:assert/strict";
import { openPostNavigation } from "../../../src/channels/post-navigation.ts";
import {
  readFileAnchor,
  readPostAnchor,
} from "../../../src/mattermost/message-anchors.ts";
import {
  changeOwnMembership,
  type MembershipChange,
  type MembershipTarget,
} from "../../../src/mattermost/own-membership.ts";
import { readPostDestination } from "../../../src/mattermost/post-destination.ts";
import {
  ChannelsApi,
  type Configuration,
  FilesApi,
  PostsApi,
  TeamsApi,
} from "../../../vendor/mattermost/index.js";
import { expectedNavigationPost } from "./search-target.ts";

export async function checkJoinPostTarget(
  owner: Configuration,
  viewer: Configuration,
  userId: string,
  teamId: string,
  channelId: string,
  otherTeamId: string,
) {
  const created = await new PostsApi(owner).createPost({
    createPostRequest: { channelId, message: "Synthetic navigation check" },
  });
  assert.ok(created.id);
  const posts = new PostsApi(viewer),
    files = new FilesApi(viewer),
    channels = new ChannelsApi(viewer);
  const account = {
    readFileAnchor: (id: string) => readFileAnchor(files, id),
    readPostAnchor: (id: string) => readPostAnchor(posts, id),
    readPostDestination: (id: string) => readPostDestination(posts, id),
    changeOwnMembership: (target: MembershipTarget, change: MembershipChange) =>
      changeOwnMembership(viewer, userId, target, change),
  };
  const member = async (scope: string, room: string) =>
    (
      await channels.getChannelMembersForUser({ userId: "me", teamId: scope })
    ).some((row) => row.channelId === room);
  assert.equal(await member(teamId, channelId), false);
  const navigation = openPostNavigation(
    account,
    { kind: "post", id: created.id },
    teamId,
    async () => {
      throw Error("Unexpected consent for a public channel in the joined team");
    },
  );
  const first = navigation.open();
  assert.equal(navigation.open(), first);
  assert.deepEqual(await first, {
    target: {
      kind: "ready",
      postId: created.id,
      channelId,
      teamId,
      rootId: null,
      post: expectedNavigationPost(created),
    },
    joined: [{ kind: "channel", id: channelId }],
  });
  assert.equal(await member(teamId, channelId), true);
  assert.deepEqual(
    await account.changeOwnMembership(
      { kind: "channel", id: channelId },
      "leave",
    ),
    { kind: "applied" },
  );
  assert.equal(await member(teamId, channelId), false);

  const teams = new TeamsApi(viewer);
  const joinedTeam = async () =>
    (await teams.getTeamsForUser({ userId: "me" })).some(
      (row) => row.id === otherTeamId,
    );
  assert.equal(await joinedTeam(), false);
  const rooms = await new ChannelsApi(owner).getChannelsForTeamForUser({
    teamId: otherTeamId,
    userId: "me",
  });
  const defaultRoom = rooms.find((row) => row.name === "town-square");
  assert.ok(defaultRoom?.id);
  const destinationPost = await new PostsApi(owner).createPost({
    createPostRequest: {
      channelId: defaultRoom.id,
      message: "Synthetic team navigation check",
    },
  });
  assert.ok(destinationPost.id);
  const source = { kind: "post", id: destinationPost.id } as const;
  for (const approve of [false, true]) {
    let asked = 0;
    const attempt = openPostNavigation(
      account,
      source,
      teamId,
      async (request) => {
        asked++;
        assert.equal(request.kind, "joinTeam");
        assert.equal(request.team.id, otherTeamId);
        assert.equal(request.channel.id, defaultRoom.id);
        return approve;
      },
    );
    const result = await attempt.open();
    assert.equal(asked, 1);
    assert.deepEqual(
      result,
      approve
        ? {
            target: {
              kind: "ready",
              postId: destinationPost.id,
              rootId: null,
              post: expectedNavigationPost(destinationPost),
              teamId: otherTeamId,
              channelId: defaultRoom.id,
            },
            joined: [{ kind: "team", id: otherTeamId }],
          }
        : { target: { kind: "cancelled" }, joined: [] },
    );
    assert.equal(await joinedTeam(), approve);
    if (approve) assert.equal(await member(otherTeamId, defaultRoom.id), true);
  }
  assert.deepEqual(
    await account.changeOwnMembership(
      { kind: "team", id: otherTeamId },
      "leave",
    ),
    { kind: "applied" },
  );
  assert.equal(await joinedTeam(), false);
}
