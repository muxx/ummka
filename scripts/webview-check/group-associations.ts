import {
  type Configuration,
  GroupsApi,
} from "../../vendor/mattermost/index.js";

export async function checkGroupAssociations(
  root: Configuration,
  prefixed: Configuration,
  teamId: string,
  channelId: string,
) {
  const active = new GroupsApi(prefixed);
  const other = new GroupsApi(root);
  const all = { teamId, filterAllowReference: true, paginate: false };
  const page = { teamId, filterAllowReference: true, page: 1, perPage: 2 };
  const team = await active.getGroupsByTeam(all);
  if (
    team.totalGroupCount !== 1 ||
    team.groups.length !== 1 ||
    team.groups[0].schemeAdmin !== undefined ||
    !team.groups[0].allowReference ||
    team.groups[0].remoteId !== "directory-record"
  )
    throw Error("generated associated team group");
  const channels = await active.getGroupsAssociatedToChannelsByTeam(all);
  const first = channels.groups[channelId];
  const second = channels.groups["d".repeat(26)];
  if (
    first?.length !== 1 ||
    second?.length !== 1 ||
    first[0].schemeAdmin !== false ||
    second[0].schemeAdmin !== true ||
    first[0].id !== "g".repeat(26) ||
    second[0].id !== first[0].id ||
    !first[0].allowReference ||
    first[0].remoteId !== "directory-record"
  )
    throw Error("generated associations for separate channels");
  const emptyTeam = await other.getGroupsByTeam(page);
  const emptyChannels = await other.getGroupsAssociatedToChannelsByTeam(page);
  if (
    emptyTeam.totalGroupCount !== 0 ||
    emptyTeam.groups.length !== 0 ||
    Object.keys(emptyChannels.groups).length !== 0
  )
    throw Error("empty group associations");
}
