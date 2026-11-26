import {
  mentionableText,
  mentionHandles,
} from "../mattermost/post-mentions.ts";

/** Commands explicitly sent as text use the same mention rules as other posts. */
export function composerPostMentions(message: string) {
  if (!message.includes("@")) return { channel: [], groupCandidates: [] };
  return mentionHandles(mentionableText(message));
}
