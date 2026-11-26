import {
  type Configuration,
  FilesApi,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";

export async function checkPostContext(
  root: Configuration,
  prefixed: Configuration,
) {
  const query = { postId: "p".repeat(26) };
  const fileQuery = { fileId: "f".repeat(26) };
  const attachments = await new PostsApi(prefixed).getFileInfosForPost(query);
  if (
    attachments?.length !== 2 ||
    attachments[0]?.name !== "zebra.txt" ||
    attachments[1]?.name !== "apple.txt" ||
    !attachments.every(
      (info, index) =>
        info.id === String(index + 1).repeat(26) &&
        info.channelId === "c".repeat(26) &&
        info.postId === query.postId &&
        info.size === 24 + index &&
        info.mimeType === "text/plain",
    )
  ) {
    throw Error("Post attachment metadata changed shape or order");
  }
  const file = await new FilesApi(prefixed).getFileInfo(fileQuery);
  if (
    file.id !== fileQuery.fileId ||
    file.postId !== query.postId ||
    file.channelId !== "c".repeat(26) ||
    file.name !== "fixture.txt"
  )
    throw Error("Single file metadata did not identify its post");
  try {
    await new FilesApi(root).getFileInfo(fileQuery);
    throw Error("Expected a file history restriction");
  } catch (error) {
    if (
      !(error instanceof ResponseError) ||
      error.response.status !== 403 ||
      error.response.headers.get("first-inaccessible-file-time") !== "1" ||
      (await error.response.json()).id !== "app.file.cloud.get.app_error"
    )
      throw error;
  }
  const single = await new PostsApi(prefixed).getPost(query);
  if (
    single.id !== query.postId ||
    single.channelId !== "c".repeat(26) ||
    single.rootId !== "r".repeat(26)
  )
    throw Error("Single post did not preserve the requested reply");
  try {
    await new PostsApi(root).getPost(query);
    throw Error("Expected a history restriction");
  } catch (error) {
    if (
      !(error instanceof ResponseError) ||
      error.response.status !== 403 ||
      error.response.headers.get("first-inaccessible-post-time") !== "1" ||
      (await error.response.json()).id !== "app.post.cloud.get.app_error"
    )
      throw error;
  }
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
    page.order?.length !== 1 ||
    page.order[0] !== query.postId ||
    !page.posts ||
    Object.keys(page.posts).length !== 1 ||
    page.posts[query.postId]?.rootId !== rootId ||
    page.posts[query.postId]?.channelId !== member.channelId ||
    page.firstInaccessiblePostTime !== 0 ||
    page.hasNext !== false
  )
    throw Error(
      "Generated thread did not preserve the focused reply and its root ID",
    );
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
