import type { ChannelsApi } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

export interface DirectoryPageQuery {
  teamId: string;
  kind: "public" | "archived";
  page: number;
}

const pageSize = 50;

export async function readChannelDirectoryPage(
  channels: Pick<
    ChannelsApi,
    "getPublicChannelsForTeam" | "getDeletedChannelsForTeam"
  >,
  { teamId, kind, page }: DirectoryPageQuery,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(teamId) || (kind !== "public" && kind !== "archived"))
    throw new TypeError("Invalid Mattermost channel directory scope.");
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    !Number.isSafeInteger(page * pageSize)
  )
    throw new RangeError("Invalid Mattermost channel directory page.");
  const request = { teamId, page, perPage: pageSize };
  const rows =
    kind === "public"
      ? await channels.getPublicChannelsForTeam(request, { signal })
      : await channels.getDeletedChannelsForTeam(request, { signal });
  signal?.throwIfAborted();
  if (!Array.isArray(rows) || rows.length > pageSize)
    throw new TypeError("Invalid Mattermost channel directory page.");

  const seen = new Set<string>();
  const items = rows.map((channel) => {
    if (
      !isMattermostId(channel?.id) ||
      seen.has(channel.id) ||
      channel.teamId !== teamId ||
      (channel.type !== "O" && channel.type !== "P") ||
      !isMattermostTime(channel.deleteAt, 0) ||
      (kind === "public"
        ? channel.type !== "O" || channel.deleteAt !== 0
        : channel.deleteAt === 0) ||
      typeof channel.name !== "string" ||
      !channel.name ||
      typeof channel.displayName !== "string" ||
      !channel.displayName ||
      (channel.purpose != null && typeof channel.purpose !== "string")
    )
      throw new TypeError("Invalid Mattermost channel directory entry.");
    seen.add(channel.id);
    return {
      id: channel.id,
      kind: channel.type,
      name: channel.name,
      displayName: channel.displayName,
      purpose: channel.purpose ?? "",
      deleteAt: channel.deleteAt,
    };
  });
  return { items, hasMore: items.length === pageSize };
}
