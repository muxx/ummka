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

  const rootId = "r".repeat(26);
  const page = await new PostsApi(root).getPostThread({
    ...query,
    perPage: 60,
    direction: "down",
    skipFetchThreads: false,
    collapsedThreads: true,
    collapsedThreadsExtended: true,
  });
  if (
    page.order?.join(",") !== `${query.postId},${rootId}` ||
    page.posts?.[query.postId]?.rootId !== rootId ||
    page.posts?.[rootId]?.channelId !== member.channelId ||
    page.firstInaccessiblePostTime !== 0 ||
    page.hasNext !== false
  )
    throw Error("Generated thread lost its focused reply or root");
  const archive = await new PostsApi(prefixed).getPostThread({
    ...query,
    perPage: 1,
    direction: "up",
    fromPost: rootId,
    fromCreateAt: 1000,
  });
  if (
    archive.order?.length !== 0 ||
    archive.posts !== undefined ||
    archive.hasNext !== undefined ||
    archive.firstInaccessiblePostTime !== 1800
  )
    throw Error("Generated thread lost its archive boundary");
}
