import assert from "node:assert/strict";
import { reopenKnownConversation } from "../../../src/mattermost/known-conversation-visibility.ts";
import { loadTeamDirectory } from "../../../src/mattermost/navigation-data.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import { sidebarPreferences } from "../../../src/mattermost/workspace-preferences.ts";
import {
  type Configuration,
  type Preference,
  PreferencesApi,
} from "../../../vendor/mattermost/index.js";

export async function checkKnownConversationVisibility(
  user: { config: Configuration; id: string },
  peer: { config: Configuration; id: string },
  teamId: string,
  directId: string,
  groupId: string,
  version: string,
) {
  const mine = new PreferencesApi(user.config);
  const theirs = new PreferencesApi(peer.config);
  const me = { userId: "me" };
  async function read(api: PreferencesApi) {
    const rows = await api.getPreferences(me);
    assert.ok(rows, "Seeded preferences should be present");
    return rows;
  }
  const hidden = (userId: string, peerId: string) => [
    { userId, category: "direct_channel_show", name: peerId, value: "false" },
    { userId, category: "group_channel_show", name: groupId, value: "false" },
    { userId, category: "channel_open_time", name: directId, value: "1" },
    { userId, category: "channel_open_time", name: groupId, value: "2" },
  ];
  const ownKeys = hidden(user.id, peer.id);
  await mine.updatePreferences({ ...me, preference: ownKeys });
  await theirs.updatePreferences({
    ...me,
    preference: hidden(peer.id, user.id),
  });
  const before = await read(mine);
  const peerBefore = await read(theirs);
  const current = sidebarPreferences(user.id, before);
  assert.equal(current.directShown[peer.id], undefined);
  assert.equal(current.groupShown[groupId], undefined);
  const sidebar = projectTeamSidebar(
    await loadTeamDirectory(user.config, user.id, teamId),
  );
  const started = Date.now();
  for (const id of [directId, groupId]) {
    assert.equal(
      await reopenKnownConversation(user.config, user.id, id, sidebar, current),
      "confirmed",
    );
  }
  const after = await read(mine);
  for (const [category, name, value] of [
    ["direct_channel_show", peer.id, "true"],
    ["group_channel_show", groupId, "true"],
    ["channel_open_time", directId, null],
    ["channel_open_time", groupId, null],
  ] as const) {
    const rows = after.filter(
      (p) => p.category === category && p.name === name,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, user.id);
    if (value !== null) assert.equal(rows[0].value, value);
    else {
      assert.match(rows[0].value ?? "", /^[1-9]\d+$/);
      assert.ok(
        Number(rows[0].value) >= started && Number(rows[0].value) <= Date.now(),
      );
    }
  }
  const preserved = (entries: Preference[]) =>
    new Set(
      entries
        .filter(
          (p) =>
            !ownKeys.some(
              (updated) =>
                updated.category === p.category && updated.name === p.name,
            ),
        )
        .map((p) => JSON.stringify(p)),
    );
  assert.deepEqual(preserved(after), preserved(before));
  assert.deepEqual(
    new Set((await read(theirs)).map((p) => JSON.stringify(p))),
    new Set(peerBefore.map((p) => JSON.stringify(p))),
  );
  const saved = sidebarPreferences(user.id, after);
  for (const id of [directId, groupId])
    assert.equal(
      await reopenKnownConversation(user.config, user.id, id, sidebar, saved),
      "alreadyShown",
    );
  assert.deepEqual(
    new Set((await read(mine)).map((p) => JSON.stringify(p))),
    new Set(after.map((p) => JSON.stringify(p))),
  );
  console.log(
    `Mattermost ${version} verified private DM and group visibility with independent peer preferences.`,
  );
}
