import type { PostsApi } from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export async function readPostDestination(
  api: Pick<PostsApi, "getPostInfo">,
  postId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(postId))
    throw new TypeError("Invalid Mattermost post ID.");
  const info = await api.getPostInfo({ postId }, { signal });
  signal?.throwIfAborted();
  const {
    channelId,
    channelType,
    channelDisplayName,
    hasJoinedChannel,
    teamId,
    teamType,
    teamDisplayName,
    hasJoinedTeam,
  } = info;
  if (
    !isMattermostId(channelId) ||
    typeof channelDisplayName !== "string" ||
    typeof hasJoinedChannel !== "boolean" ||
    typeof hasJoinedTeam !== "boolean"
  )
    throw new TypeError("Invalid Mattermost post destination.");
  if (channelType === "D" || channelType === "G") {
    if (
      teamId !== "" ||
      teamType !== "" ||
      teamDisplayName !== "" ||
      hasJoinedTeam
    )
      throw new TypeError("Unexpected team on a direct or group conversation.");
    return {
      postId,
      channel: {
        id: channelId,
        kind: channelType,
        displayName: channelDisplayName,
        joined: hasJoinedChannel,
      },
      team: null,
    } as const;
  }
  if (
    (channelType !== "O" && channelType !== "P") ||
    !isMattermostId(teamId) ||
    (teamType !== "O" && teamType !== "I") ||
    typeof teamDisplayName !== "string"
  )
    throw new TypeError(
      "Invalid Mattermost channel or team in a post destination.",
    );
  return {
    postId,
    channel: {
      id: channelId,
      kind: channelType,
      displayName: channelDisplayName,
      joined: hasJoinedChannel,
    },
    team: {
      id: teamId,
      kind: teamType,
      displayName: teamDisplayName,
      joined: hasJoinedTeam,
    },
  } as const;
}
