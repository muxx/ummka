import {
  type ApiResponse,
  type Configuration,
  FetchError,
  PostsApi,
  PreferencesApi,
  ResponseError,
  type StatusOK,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";
import type { NativeRequestInit } from "./native-fetch.ts";
import {
  createSavedPostState,
  type SavedPostState,
} from "./saved-post-state.ts";

export function isSavedPostWriteRefused(error: unknown) {
  if (error instanceof ResponseError) {
    const status = error.response.status;
    return status >= 400 && status < 500 && status !== 408;
  }
  const cause = error instanceof FetchError ? error.cause.cause : undefined;
  return (
    cause === "operation_denied" ||
    cause === "outside_installation" ||
    cause === "cleartext_denied" ||
    cause === "session_unavailable"
  );
}

export function accountCollectionActions(
  config: Configuration,
  userId: string,
  whileOpen: <T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>,
  savedState = createSavedPostState(),
) {
  const posts = new PostsApi(config);
  const preferences = new PreferencesApi(config);

  function change(
    postId: string,
    desired: boolean,
    signal: AbortSignal | undefined,
    write: (options: NativeRequestInit) => Promise<ApiResponse<StatusOK>>,
    state?: SavedPostState,
  ) {
    return whileOpen(async () => {
      signal?.throwIfAborted();
      if (
        !isMattermostId(postId) ||
        !isMattermostId(userId) ||
        typeof desired !== "boolean"
      )
        throw new TypeError("Invalid Mattermost post collection change.");
      async function perform() {
        signal?.throwIfAborted();
        const options: NativeRequestInit = { signal };
        let sent = false;
        if (state)
          options.onNativeSend = () => {
            sent = true;
          };
        try {
          const response = await write(options);
          if (
            response.raw.status !== 200 ||
            (await response.value())?.status !== "OK"
          )
            throw new TypeError(
              "Mattermost did not confirm the post collection change.",
            );
        } catch (error) {
          if (sent && !isSavedPostWriteRefused(error))
            state?.record(postId, undefined);
          throw error;
        }
        state?.record(postId, desired);
      }
      return state ? state.runWrite(postId, desired, perform) : perform();
    }, signal);
  }

  return {
    subscribeToSavedPostWrites: savedState.subscribeToWrites,
    setPostSaved(postId: string, saved: boolean, signal?: AbortSignal) {
      return change(
        postId,
        saved,
        signal,
        (options) => {
          const params = {
            userId: "me",
            preference: [
              { userId, category: "flagged_post", name: postId, value: "true" },
            ],
          };
          return saved
            ? preferences.updatePreferencesRaw(params, options)
            : preferences.deletePreferencesRaw(params, options);
        },
        savedState,
      );
    },
    setPostPinned(postId: string, pinned: boolean, signal?: AbortSignal) {
      return change(postId, pinned, signal, (options) =>
        pinned
          ? posts.pinPostRaw({ postId }, options)
          : posts.unpinPostRaw({ postId }, options),
      );
    },
  };
}
