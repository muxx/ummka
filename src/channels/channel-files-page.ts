import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import { isMattermostId } from "../mattermost/model-fields.ts";
import { receivedFileDetails } from "../mattermost/received-file.ts";

type AccountFiles = Pick<
  TeamWorkspace["connection"],
  "readFileSearchPage" | "readChannelIdentity"
>;

export async function readChannelFilesPage(
  account: AccountFiles,
  teamId: string,
  channelId: string,
  page: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!isMattermostId(channelId))
    throw new TypeError("Invalid Mattermost channel ID for file search.");
  const result = await account.readFileSearchPage(
    {
      teamId,
      terms: `channel:${channelId}`,
      page,
      isOrSearch: false,
      includeDeletedChannels: false,
      timeZoneOffsetSeconds: 0,
    },
    signal,
  );
  signal.throwIfAborted();
  const items = result.items.map(({ postId, ...file }) => {
    if (file.channelId !== channelId)
      throw new TypeError(
        "Mattermost returned a file outside the requested channel.",
      );
    return { ...receivedFileDetails(file), channelId, postId };
  });
  // The search endpoint returns the same empty page at the end of a list
  // and after the caller loses access to a private channel.
  if (result.items.length === 0) {
    await account.readChannelIdentity(channelId, signal);
    signal.throwIfAborted();
  }
  return { ...result, items };
}
