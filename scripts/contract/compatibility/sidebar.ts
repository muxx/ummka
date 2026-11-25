import assert from "node:assert/strict";
import {
  openingChannel,
  workspaceProfileQuery,
} from "../../../src/channels/workspace-data.ts";
import { indexChannelProfiles } from "../../../src/mattermost/channel-profiles.ts";
import {
  loadAccountDirectory,
  loadTeamDirectory,
} from "../../../src/mattermost/navigation-data.ts";
import { visibleSidebar } from "../../../src/mattermost/sidebar-rows.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import {
  effectiveWorkspacePreferences,
  sidebarPreferences,
  visibleConversationLimit,
  workspacePreferences,
} from "../../../src/mattermost/workspace-preferences.ts";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import {
  ChannelsApi,
  Configuration,
  PreferencesApi,
  PreferenceToJSON,
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
  directIdToRead: string,
  privateChannelId: string,
) {
  const config = new Configuration({ basePath: base, accessToken: token });
  const channels = new ChannelsApi(config);
  const response = await channels.getChannelsForTeamForUserRaw({
    userId,
    teamId,
  });
  const raw: {
    id: string;
    shared: boolean | null;
    group_constrained: boolean | null;
  }[] = await response.raw.clone().json();
  const decoded = await response.value();
  for (const id of [channelId, directIdToRead, privateChannelId]) {
    const wire = raw.find((channel) => channel.id === id);
    const typed = decoded.find((channel) => channel.id === id);
    assert.ok(wire && typed);
    assert.ok(Object.hasOwn(wire, "group_constrained"));
    assert.equal(wire.group_constrained, null);
    if (id === privateChannelId) assert.equal(typed.type, "P");
    assert.equal(typed.groupConstrained, wire.group_constrained);
    assert.ok(Object.hasOwn(wire, "shared"));
    assert.ok(wire.shared === false || wire.shared === null);
    assert.equal(typed.shared ?? null, wire.shared);
  }
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
  // Both compatibility servers return JSON null after deleting the last preference.
  const before = await loadAccountDirectory(config, userId);
  assert.ok(
    before.preferences.length > 0 &&
      before.teams.some(({ team }) => team.id === teamId),
  );
  const existing = before.preferences.map(PreferenceToJSON);
  await fixture("POST", "users/me/preferences/delete", existing);
  try {
    const empty = await preferences.getPreferencesRaw({ userId: "me" });
    assert.equal(await empty.raw.clone().json(), null);
    assert.equal(await empty.value(), null);
    const directory = await loadAccountDirectory(config, userId);
    assert.deepEqual(directory, { teams: before.teams, preferences: [] });
  } finally {
    await fixture("PUT", "users/me/preferences", existing);
  }
  const restored = await loadAccountDirectory(config, userId);
  assert.deepEqual(
    new Set(restored.preferences.map((p) => JSON.stringify(p))),
    new Set(before.preferences.map((p) => JSON.stringify(p))),
  );
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
  await fixture("POST", "channels/members/me/view", {
    channel_id: directIdToRead,
    collapsed_threads_supported: true,
  });
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
      name: "old-channel-key",
      value: "602",
    },
    {
      user_id: userId,
      category: "channel_approximate_view_time",
      name: "old-view-key",
      value: "unrelated",
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
    {
      user_id: userId,
      category: "advanced_settings",
      name: "send_on_ctrl_enter",
      value: "true",
    },
    {
      user_id: userId,
      category: "advanced_settings",
      name: "code_block_ctrl_enter",
      value: "false",
    },
  ]);
  const saved = await preferences.getPreferences({ userId: "me" });
  assert.ok(saved);
  assert.ok(
    saved.some(
      (p) => p.category === "channel_open_time" && p.name === "old-channel-key",
    ),
  );
  assert.ok(
    saved.some(
      (p) =>
        p.category === "channel_approximate_view_time" &&
        p.name === "old-view-key",
    ),
  );
  const joined = await loadAccountDirectory(config, userId);
  assert.ok(joined.teams.some(({ team }) => team.id === teamId));
  const system = new SystemApi(config);
  const [settings, license] = await Promise.all([
    system.getClientConfigRaw({ format: "old" }).then((r) => r.raw.json()),
    system.getClientLicenseRaw({ format: "old" }).then((r) => r.raw.json()),
  ]);
  assert.equal(typeof settings.CollapsedThreads, "string");
  const policy = workspacePreferences(userId, saved, settings, license);
  const serverPolicy = await loadWorkspaceServerPolicy(config);
  const received = sidebarPreferences(userId, saved);
  assert.deepEqual(
    effectiveWorkspacePreferences(received, serverPolicy),
    policy,
  );
  const storedChannel = projectTeamSidebar(directory).channels.find(
    (c) => c.id === channelId,
  );
  assert.equal(storedChannel?.shared, false);
  assert.ok(storedChannel?.createAt && storedChannel.createAt > 0);
  assert.equal(policy.directShown[otherUserId], undefined);
  assert.equal(policy.viewTimes[channelId], 310);
  assert.equal(Object.hasOwn(policy.viewTimes, "old-channel-key"), false);
  assert.equal(Object.hasOwn(policy.viewTimes, "old-view-key"), false);
  assert.deepEqual(policy.composerKeys, {
    sendOnCtrlEnter: true,
    codeBlockOnCtrlEnter: false,
  });
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
  const selectedSnapshot = {
    data: projectTeamSidebar(directory),
    selectedChannel: channelId,
  };
  assert.equal(openingChannel(selectedSnapshot, "en")?.id, channelId);
  assert.ok(
    selectedSnapshot.data.channels.some(
      (c) => c.id === directIdToRead && c.kind === "D",
    ),
  );
  const profiles = workspaceProfileQuery(
    userId,
    selectedSnapshot,
    policy,
    null,
  );
  assert.ok(profiles.ids.includes(userId));
  assert.ok(!profiles.ids.includes(otherUserId));
  await fixture("PUT", "users/me/preferences", [
    {
      user_id: userId,
      category: "direct_channel_show",
      name: otherUserId,
      value: "true",
    },
  ]);
  const updatedPreferences = await preferences.getPreferences({ userId: "me" });
  assert.ok(updatedPreferences);
  const visible = workspacePreferences(
    userId,
    updatedPreferences,
    settings,
    license,
  );
  assert.ok(
    workspaceProfileQuery(userId, selectedSnapshot, visible, null).ids.includes(
      otherUserId,
    ),
  );
  const sections = visibleSidebar(selectedSnapshot, {
    preferences: policy,
    userId,
    profiles: indexChannelProfiles([]),
    locale: "en",
    compact: false,
  });
  const ownSection = sections.find((s) => s.id === custom.id);
  assert.equal(ownSection?.muted, true);
  assert.equal(ownSection?.collapsed, true);
  const active = sections.flatMap((s) => s.rows).filter((r) => r.current);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, channelId);
  assert.equal(active[0].title, row.channel.displayName);
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
