import { type Configuration, PostsApi } from "../../vendor/mattermost/index.js";

export async function checkPostContext(
  root: Configuration,
  prefixed: Configuration,
) {
  const query = { postId: "p".repeat(26) };
  const member = await new PostsApi(root).getPostInfo(query);
  const direct = await new PostsApi(prefixed).getPostInfo(query);
  if (
    member.channelId !== "c".repeat(26) ||
    member.channelType !== "O" ||
    member.channelDisplayName !== "Town Square" ||
    member.hasJoinedChannel !== true ||
    member.teamId !== "Team0123456789012345678901" ||
    member.teamType !== "O" ||
    member.teamDisplayName !== "Fixture" ||
    member.hasJoinedTeam !== true ||
    direct.channelType !== "D" ||
    direct.hasJoinedChannel !== true ||
    direct.teamId !== "" ||
    direct.teamType !== "" ||
    direct.teamDisplayName !== "" ||
    direct.hasJoinedTeam !== false
  )
    throw Error("Generated post info lost the channel, team or membership");
}
