import {
  type Configuration,
  type Reaction,
  ReactionsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

function isEmojiName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_+-]{1,64}$/u.test(value);
}

function checkTarget(postId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!isMattermostId(postId))
    throw new TypeError("Invalid Mattermost post ID.");
}

function checkReaction(row: Reaction, postId: string) {
  if (
    !row ||
    row.postId !== postId ||
    !isMattermostId(row.userId) ||
    !isEmojiName(row.emojiName) ||
    (row.channelId !== "" && !isMattermostId(row.channelId)) ||
    !isMattermostTime(row.createAt, 1) ||
    !isMattermostTime(row.updateAt, 1) ||
    row.deleteAt !== 0 ||
    (row.remoteId !== null && typeof row.remoteId !== "string")
  )
    throw new TypeError("Invalid active Mattermost post reaction.");
  return row;
}

export function accountPostReactions(
  config: Configuration,
  userId: string,
  whileOpen: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  const api = new ReactionsApi(config);
  return {
    readPostReactions(postId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        checkTarget(postId, signal);
        const rows = await api.getReactions({ postId }, { signal });
        signal?.throwIfAborted();
        return rows === null
          ? []
          : rows.map((row) => checkReaction(row, postId));
      });
    },
    addOwnReaction(postId: string, emojiName: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        checkTarget(postId, signal);
        if (!isEmojiName(emojiName))
          throw new TypeError("Invalid Mattermost emoji name.");
        const row = await api.saveReaction(
          { saveReactionRequest: { postId, userId, emojiName } },
          { signal },
        );
        signal?.throwIfAborted();
        checkReaction(row, postId);
        if (row.userId !== userId || row.emojiName !== emojiName)
          throw new TypeError("Mattermost confirmed a different reaction.");
        return row;
      });
    },
    removeOwnReaction(postId: string, emojiName: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        checkTarget(postId, signal);
        if (!isEmojiName(emojiName))
          throw new TypeError("Invalid Mattermost emoji name.");
        const result = await api.deleteReaction(
          { postId, userId: "me", emojiName },
          { signal },
        );
        signal?.throwIfAborted();
        if (result?.status !== "OK")
          throw new TypeError("Mattermost did not confirm reaction removal.");
      });
    },
  };
}
