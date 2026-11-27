import {
  ChannelsApi,
  type Configuration,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";
import { mutationFailure } from "./mutation-error.ts";

// Mattermost identifies a group by the lowercase SHA-1 of its sorted, concatenated IDs.
async function groupChannelName(memberIds: readonly string[]) {
  const input = new TextEncoder().encode([...memberIds].sort().join(""));
  const hash = await crypto.subtle.digest("SHA-1", input);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function openRecipientConversation(
  config: Configuration,
  userId: string,
  recipientIds: readonly string[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !isMattermostId(userId) ||
    !Array.isArray(recipientIds) ||
    recipientIds.length < 1 ||
    recipientIds.length > 7 ||
    ![...recipientIds].every(isMattermostId) ||
    new Set(recipientIds).size !== recipientIds.length ||
    (recipientIds.length > 1 && recipientIds.includes(userId))
  ) {
    throw new TypeError("Invalid Mattermost conversation recipients.");
  }
  const kind = recipientIds.length === 1 ? "D" : "G";
  const participants = [userId, ...recipientIds];
  const expectedName =
    kind === "D"
      ? [...participants].sort().join("__")
      : await groupChannelName(participants);
  signal?.throwIfAborted();
  const api = new ChannelsApi(config);
  try {
    const body = { requestBody: participants };
    const response =
      kind === "D"
        ? await api.createDirectChannelRaw(body, { signal })
        : await api.createGroupChannelRaw(body, { signal });
    const channel = await response.value();
    signal?.throwIfAborted();
    if (
      response.raw.status === 201 &&
      channel &&
      isMattermostId(channel.id) &&
      channel.type === kind &&
      channel.teamId === "" &&
      channel.deleteAt === 0 &&
      channel.name === expectedName
    ) {
      return {
        kind: "applied",
        channelId: channel.id,
        channelKind: kind,
      } as const;
    }
    return { kind: "unconfirmed" as const };
  } catch (error) {
    signal?.throwIfAborted();
    const failure = await mutationFailure(error);
    signal?.throwIfAborted();
    return failure;
  }
}
