import { type Configuration, PostsApi } from "../../vendor/mattermost/index.js";

export async function checkCreatePost(
  root: Configuration,
  prefixed: Configuration,
  channelId: string,
) {
  const post = await new PostsApi(root).createPost({
    createPostRequest: {
      channelId,
      message: "Root **text**",
      pendingPostId: "fixture:root",
    },
  });
  if (
    post.id !== "v".repeat(26) ||
    post.channelId !== channelId ||
    post.pendingPostId !== "fixture:root"
  )
    throw Error("root post creation lost its identity");
  const message = "Ответ 👋\nв треде";
  const reply = await new PostsApi(prefixed).createPost({
    setOnline: false,
    createPostRequest: {
      channelId,
      rootId: post.id,
      pendingPostId: "fixture:reply",
      message,
    },
  });
  if (
    reply.rootId !== post.id ||
    reply.id === post.id ||
    reply.message !== message ||
    reply.pendingPostId !== "fixture:reply"
  )
    throw Error("reply creation lost its root or message");
}
