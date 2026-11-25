import assert from "node:assert/strict";
import { loadTeamDirectory } from "../../../src/mattermost/navigation-data.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import {
  visibleConversationLimit,
  workspacePreferences,
} from "../../../src/mattermost/workspace-preferences.ts";
import {
  ChannelsApi,
  Configuration,
  PreferencesApi,
  ResponseError,
  SystemApi,
} from "../../../vendor/mattermost/index.js";

export async function checkSidebarReads(
  base: string,
  token: string,
  userId: string,
  otherUserId: string,
  teamId: string,
  channelId: string,
) {
  const config = new Configuration({ basePath: base, accessToken: token });
  const channels = new ChannelsApi(config);
  const preferences = new PreferencesApi(config);
  const scope = { userId: "me", teamId };
  const initial = await channels.getSidebarCategoriesForTeamForUser(scope);
  const favoritesId = `favorites_${userId}_${teamId}`;
  const channelsId = `channels_${userId}_${teamId}`;
  const directId = `direct_messages_${userId}_${teamId}`;
  assert.deepEqual(initial.order, [favoritesId, channelsId, directId]);
  assert.ok(initial.categories);
  assert.ok(
    initial.categories
      ?.find((c) => c.id === channelsId)
      ?.channelIds?.includes(channelId),
  );
  const favorites = initial.categories.find((c) => c.id === favoritesId);
  assert.equal(favorites?.sortOrder, 0);
  assert.equal(favorites?.sorting, "");
  assert.equal(favorites?.muted, false);
  assert.equal(favorites?.collapsed, false);
  assert.equal(
    initial.categories.find((c) => c.id === directId)?.sorting,
    "recent",
  );

  async function fixture(method: "POST" | "PUT", path: string, body: unknown) {
    const response = await fetch(`${base}/api/v4/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.ok(
      response.ok,
      `Prepare sidebar fixture: ${method} ${path}, HTTP ${response.status}`,
    );
    return response.json();
  }
  const path = `users/me/teams/${teamId}/channels/categories`;
  const custom = await fixture("POST", path, {
    user_id: userId,
    team_id: teamId,
    display_name: "Project rooms",
    type: "custom",
    sorting: "alpha",
    muted: true,
    channel_ids: [channelId],
  });
  assert.match(custom.id, /^[a-z0-9]{26}$/);
  await fixture("PUT", `${path}/${custom.id}`, { ...custom, collapsed: true });
  const order = [directId, custom.id, favoritesId, channelsId];
  await fixture("PUT", `${path}/order`, order);
  const updated = await channels.getSidebarCategoriesForTeamForUser({
    userId,
    teamId,
  });
  assert.deepEqual(updated.order, order);
  const directory = await loadTeamDirectory(config, userId, teamId);
  assert.deepEqual(
    directory.categories.map((category) => category.id),
    order,
  );
  assert.deepEqual(directory.categories[1]?.channelIds, [channelId]);
  assert.deepEqual(
    projectTeamSidebar(directory).categories.find((c) => c.id === custom.id),
    {
      id: custom.id,
      kind: "custom",
      displayName: "Project rooms",
      sorting: "alpha",
      collapsed: true,
      muted: true,
      channelIds: [channelId],
    },
  );
  const row = directory.channels.find((row) => row.channel.id === channelId);
  assert.ok(
    row &&
      row.membership.userId === userId &&
      row.channel.lastRootPostAt &&
      row.membership.mentionCountRoot === 0,
  );
  assert.deepEqual(
    updated.categories?.find((c) => c.id === custom.id),
    {
      id: custom.id,
      userId,
      teamId,
      type: "custom",
      displayName: "Project rooms",
      channelIds: [channelId],
      muted: true,
      collapsed: true,
      sorting: "alpha",
      sortOrder: 10,
    },
  );
  const remaining = updated.categories?.find((c) => c.id === channelsId);
  assert.ok(remaining && !remaining.channelIds?.includes(channelId));

  await fixture("PUT", "users/me/preferences", [
    {
      user_id: userId,
      category: "direct_channel_show",
      name: otherUserId,
      value: "false",
    },
  ]);
  await fixture("PUT", "users/me/preferences", [
    {
      user_id: userId,
      category: "sidebar_settings",
      name: "limit_visible_dms_gms",
      value: "15",
    },
    {
      user_id: userId,
      category: "channel_open_time",
      name: channelId,
      value: "310",
    },
    {
      user_id: userId,
      category: "channel_approximate_view_time",
      name: channelId,
      value: "280",
    },
    {
      user_id: userId,
      category: "display_settings",
      name: "name_format",
      value: "nickname_full_name",
    },
  ]);
  const saved = await preferences.getPreferences({ userId: "me" });
  const system = new SystemApi(config);
  const [settings, license] = await Promise.all([
    system.getClientConfigRaw({ format: "old" }).then((r) => r.raw.json()),
    system.getClientLicenseRaw({ format: "old" }).then((r) => r.raw.json()),
  ]);
  assert.equal(typeof settings.CollapsedThreads, "string");
  const policy = workspacePreferences(userId, saved, settings, license);
  assert.equal(policy.directShown[otherUserId], undefined);
  assert.equal(policy.viewTimes[channelId], 310);
  assert.equal(policy.nameFormat, "nickname_full_name");
  assert.equal(visibleConversationLimit(policy, false), 15);
  assert.equal(visibleConversationLimit(policy, true), 15);
  assert.deepEqual(
    saved.find(
      (p) => p.category === "direct_channel_show" && p.name === otherUserId,
    ),
    {
      userId,
      category: "direct_channel_show",
      name: otherUserId,
      value: "false",
    },
  );
  const denied = (e: unknown) =>
    e instanceof ResponseError && e.response.status === 403;
  await assert.rejects(
    preferences.getPreferences({ userId: otherUserId }),
    denied,
  );
  await assert.rejects(
    channels.getSidebarCategoriesForTeamForUser({
      userId: otherUserId,
      teamId,
    }),
    denied,
  );
}
