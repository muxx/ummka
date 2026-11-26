import {
  type ApiResponse,
  type Configuration,
  PostsApi,
  PreferencesApi,
  type StatusOK,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export function accountCollectionActions(
  config: Configuration,
  userId: string,
  whileOpen: <T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>,
) {
  const posts = new PostsApi(config);
  const preferences = new PreferencesApi(config);

  function change(
    postId: string,
    desired: boolean,
    signal: AbortSignal | undefined,
    write: () => Promise<ApiResponse<StatusOK>>,
  ) {
    return whileOpen(async () => {
      signal?.throwIfAborted();
      if (
        !isMattermostId(postId) ||
        !isMattermostId(userId) ||
        typeof desired !== "boolean"
      )
        throw new TypeError("Invalid Mattermost post collection change.");
      const response = await write();
      if (
        response.raw.status !== 200 ||
        (await response.value())?.status !== "OK"
      )
        throw new TypeError(
          "Mattermost did not confirm the post collection change.",
        );
    }, signal);
  }

  return {
    setPostSaved(postId: string, saved: boolean, signal?: AbortSignal) {
      return change(postId, saved, signal, () => {
        const params = {
          userId: "me",
          preference: [
            { userId, category: "flagged_post", name: postId, value: "true" },
          ],
        };
        return saved
          ? preferences.updatePreferencesRaw(params, { signal })
          : preferences.deletePreferencesRaw(params, { signal });
      });
    },
    setPostPinned(postId: string, pinned: boolean, signal?: AbortSignal) {
      return change(postId, pinned, signal, () =>
        pinned
          ? posts.pinPostRaw({ postId }, { signal })
          : posts.unpinPostRaw({ postId }, { signal }),
      );
    },
  };
}
