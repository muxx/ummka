import {
  AppErrorFromJSON,
  type Configuration,
  type Emoji,
  EmojiApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import {
  isMattermostEmojiName,
  isMattermostId,
  isMattermostTime,
} from "./model-fields.ts";

type CustomEmojiLookup =
  | { kind: "found"; emoji: Emoji }
  | { kind: "missing" }
  | { kind: "disabled" };

export async function readCustomEmoji(
  config: Configuration,
  name: string,
  signal?: AbortSignal,
): Promise<CustomEmojiLookup> {
  signal?.throwIfAborted();
  if (!isMattermostEmojiName(name))
    throw new TypeError("Invalid Mattermost custom emoji name.");
  let emoji: Emoji;
  try {
    emoji = await new EmojiApi(config).getEmojiByName(
      { emojiName: name },
      { signal },
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof ResponseError)) throw error;
    const response = error.response;
    if (response.status !== 404 && response.status !== 501) throw error;
    // Retain the original response for callers when a proxy returns an unrelated error.
    let wire: unknown;
    try {
      wire = await response.clone().json();
    } catch {
      signal?.throwIfAborted();
      throw error;
    }
    signal?.throwIfAborted();
    const cause = AppErrorFromJSON(wire);
    if (cause?.statusCode !== response.status) throw error;
    if (
      response.status === 404 &&
      cause.id === "app.emoji.get_by_name.no_result"
    )
      return { kind: "missing" };
    if (response.status === 501 && cause.id === "api.emoji.disabled.app_error")
      return { kind: "disabled" };
    throw error;
  }
  signal?.throwIfAborted();
  if (
    !emoji ||
    emoji.name !== name ||
    !isMattermostId(emoji.id) ||
    typeof emoji.creatorId !== "string" ||
    !isMattermostTime(emoji.createAt, 1) ||
    !isMattermostTime(emoji.updateAt, 1) ||
    emoji.deleteAt !== 0
  )
    throw new TypeError("Invalid active Mattermost custom emoji.");
  return { kind: "found", emoji };
}
