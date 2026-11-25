import {
  ChannelsApi,
  type Configuration,
  type Group,
  GroupsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

const pageSize = 60;

function validateGroups(rows: Group[]): (Group & { id: string })[] {
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (group): group is Group & { id: string } =>
        group != null &&
        isMattermostId(group.id) &&
        typeof group.allowReference === "boolean" &&
        (group.name == null || typeof group.name === "string") &&
        typeof group.source === "string" &&
        isMattermostTime(group.deleteAt, 0),
    )
  )
    throw new TypeError("Invalid Mattermost group directory.");
  return rows;
}

export function accountMentionGroups(
  config: Configuration,
  whileOpen: <T>(read: () => Promise<T>) => Promise<T>,
) {
  const groups = new GroupsApi(config);
  const channels = new ChannelsApi(config);
  return {
    searchMentionGroups(q: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        if (!q) throw new TypeError("Missing group search term.");
        const results = new Map<string, Group>();
        for (let page = 0; ; page++) {
          signal?.throwIfAborted();
          const rows = validateGroups(
            await groups.getGroups(
              { q, page, perPage: pageSize, filterAllowReference: true },
              { signal },
            ),
          );
          signal?.throwIfAborted();
          const previous = results.size;
          for (const row of rows) results.set(row.id, row);
          if (rows.length < pageSize) return [...results.values()];
          if (results.size === previous)
            throw new TypeError(
              "Mattermost group search page did not advance.",
            );
        }
      });
    },
    readAssociatedMentionGroups(
      teamId: string,
      channelId: string | null,
      signal?: AbortSignal,
    ) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (
          !isMattermostId(teamId) ||
          (channelId !== null && !isMattermostId(channelId))
        )
          throw new TypeError("Invalid Mattermost group association context.");
        const params = { teamId, filterAllowReference: true, paginate: false };
        if (channelId === null) {
          const result = await groups.getGroupsByTeam(params, { signal });
          return validateGroups(result.groups);
        }
        const result = await groups.getGroupsAssociatedToChannelsByTeam(
          params,
          { signal },
        );
        if (
          !result.groups ||
          typeof result.groups !== "object" ||
          Array.isArray(result.groups)
        )
          throw new TypeError("Invalid Mattermost channel group map.");
        return Object.hasOwn(result.groups, channelId)
          ? validateGroups(result.groups[channelId])
          : [];
      });
    },
    readMentionGroupCounts(channelId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!isMattermostId(channelId))
          throw new TypeError("Invalid Mattermost channel ID.");
        const rows = await channels.getChannelMemberCountsByGroup(
          { channelId, includeTimezones: true },
          { signal },
        );
        const counts = new Map<
          string,
          { members: number; timezones: number }
        >();
        for (const row of rows) {
          const id = row.groupId;
          const members = row.channelMemberCount;
          const timezones = row.channelMemberTimezonesCount;
          if (
            !isMattermostId(id) ||
            counts.has(id) ||
            !Number.isSafeInteger(members) ||
            members < 0 ||
            !Number.isSafeInteger(timezones) ||
            timezones < 0 ||
            timezones > members
          )
            throw new TypeError("Invalid Mattermost group member counts.");
          counts.set(id, { members, timezones });
        }
        return counts;
      });
    },
  };
}
