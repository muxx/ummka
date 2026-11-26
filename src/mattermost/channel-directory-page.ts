import type { Channel, ChannelsApi } from "../../vendor/mattermost/index.js";
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
  const items = directoryItems(rows, teamId, kind);
  return { items, hasMore: items.length === pageSize };
}

export async function searchChannelDirectory(
  channels: Pick<ChannelsApi, "autocompleteChannelsForTeam">,
  teamId: string,
  name: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(teamId) || typeof name !== "string" || !name.trim())
    throw new TypeError("Invalid Mattermost channel directory search.");
  const rows = await channels.autocompleteChannelsForTeam(
    { teamId, name: name.trim() },
    { signal },
  );
  signal?.throwIfAborted();
  return directoryItems(rows, teamId, "search");
}

function directoryItems(
  rows: Channel[],
  teamId: string,
  kind: DirectoryPageQuery["kind"] | "search",
) {
  if (!Array.isArray(rows) || rows.length > pageSize)
    throw new TypeError("Invalid Mattermost channel directory page.");

  const seen = new Set<string>();
  return rows.map((channel) => {
    if (
      !isMattermostId(channel?.id) ||
      seen.has(channel.id) ||
      channel.teamId !== teamId ||
      (channel.type !== "O" && channel.type !== "P") ||
      !isMattermostTime(channel.deleteAt, 0) ||
      (kind === "public" && (channel.type !== "O" || channel.deleteAt !== 0)) ||
      (kind === "archived" && channel.deleteAt === 0) ||
      typeof channel.name !== "string" ||
      !channel.name ||
      typeof channel.displayName !== "string" ||
      !channel.displayName ||
      (channel.header != null && typeof channel.header !== "string") ||
      (channel.purpose != null && typeof channel.purpose !== "string")
    )
      throw new TypeError("Invalid Mattermost channel directory entry.");
    seen.add(channel.id);
    return {
      id: channel.id,
      kind: channel.type,
      name: channel.name,
      displayName: channel.displayName,
      ...(channel.header ? { header: channel.header } : {}),
      purpose: channel.purpose ?? "",
      deleteAt: channel.deleteAt,
    };
  });
}
