import { type Configuration, PostsApi } from "../../vendor/mattermost/index.js";

export async function checkPostMutations(
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
  if (!reply.id) throw Error("reply has no identity");
  const api = new PostsApi(prefixed);
  const edited = await api.patchPost({
    postId: reply.id,
    patchPostRequest: { message: "Отредактировано ✎", props: { note: true } },
  });
  if (
    edited.id !== reply.id ||
    edited.rootId !== post.id ||
    edited.message !== "Отредактировано ✎"
  )
    throw Error("partial post edit lost its root or message");
  const history = await api.getEditHistoryForPost({ postId: reply.id });
  if (
    history.length !== 2 ||
    !history.every(
      (row) =>
        row.originalId === reply.id &&
        row.rootId === post.id &&
        row.channelId === channelId,
    ) ||
    history[0].id !== "d".repeat(26) ||
    history[0].message !== "Second revision" ||
    history[0].editAt !== 200 ||
    history[0].deleteAt !== 300 ||
    history[1].id !== "b".repeat(26) ||
    history[1].message !== "First revision" ||
    history[1].editAt !== 0 ||
    history[1].deleteAt !== 200
  )
    throw Error(
      "Post edit history lost its ordered revisions or original identity",
    );
  if ((await api.deletePost({ postId: reply.id })).status !== "OK")
    throw Error("post deletion was not confirmed");
}
