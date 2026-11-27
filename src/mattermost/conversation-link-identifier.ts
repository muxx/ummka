import {
  ChannelsApi,
  type Configuration,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { directPartnerId } from "./channel-profiles.ts";
import {
  type ChannelsTarget,
  isConversationIdentifier,
} from "./channels-link.ts";
import { isMattermostId } from "./model-fields.ts";

type Target = Extract<ChannelsTarget, { kind: "conversation" }>;
export type KnownChannelName = {
  serverUrl: string;
  userId: string;
  team: string;
  name: string;
  kind: "O" | "P" | "D" | "G";
};
const unavailable = { kind: "unavailable" } as const;

function user(id: string | null) {
  return isMattermostId(id) ? { kind: "user-id" as const, id } : unavailable;
}

function group(name: string) {
  return { kind: "group-name" as const, name };
}

function named(name: string) {
  return name.length <= 64 && /^[a-z0-9_-]+$/u.test(name)
    ? { kind: "channel-name" as const, name }
    : unavailable;
}

async function byChannelId(
  config: Configuration,
  id: string,
  userId: string,
  signal?: AbortSignal,
) {
  try {
    const reply = await new ChannelsApi(config).getChannelRaw(
      { channelId: id },
      { signal },
    );
    if (reply.raw.status !== 200) {
      void reply.raw.body?.cancel().catch(() => {});
      throw new TypeError("Incomplete Mattermost channel lookup.");
    }
    const channel = await reply.value();
    signal?.throwIfAborted();
    if (channel?.id !== id || typeof channel.name !== "string")
      throw new TypeError("Invalid Mattermost channel identity.");
    if (channel.teamId === "") {
      if (channel.type === "D") {
        const id = directPartnerId(channel.name, userId);
        if (id) return { kind: "user-id" as const, id };
      }
      if (
        channel.type === "G" &&
        channel.name.length === 40 &&
        isConversationIdentifier(channel.name)
      )
        return group(channel.name);
    }
    if (
      (channel.type === "O" || channel.type === "P") &&
      isMattermostId(channel.teamId) &&
      named(channel.name).kind === "channel-name"
    ) {
      return {
        kind: "channel-id" as const,
        id: channel.id,
        teamId: channel.teamId,
        name: channel.name,
      };
    }
    throw new TypeError("Invalid Mattermost channel destination.");
  } catch (error) {
    const reply = error instanceof ResponseError ? error.response : undefined;
    void reply?.body?.cancel().catch(() => {});
    signal?.throwIfAborted();
    if (reply?.status === 404) return named(id.toLowerCase());
    if (reply?.status === 403) return unavailable;
    throw error;
  }
}

export async function resolveConversationIdentifier(
  config: Configuration,
  userId: string,
  target: Target,
  known?: KnownChannelName,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    target.kind !== "conversation" ||
    target.serverUrl !== config.basePath ||
    !isMattermostId(userId) ||
    !isConversationIdentifier(target.identifier)
  )
    throw new TypeError(
      "Invalid Mattermost conversation link for this account.",
    );
  const name = target.identifier.toLowerCase();
  if (target.route === "messages") {
    if (name.startsWith("@"))
      return name.length > 1
        ? { kind: "username" as const, name: name.slice(1) }
        : unavailable;
    if (name.includes("@")) return { kind: "email" as const, email: name };
    if (name.length === 40) return group(name);
    return user(target.identifier);
  }
  if (target.route !== "channels") return unavailable;
  // A known name disambiguates this account and team only. It never grants membership.
  const match =
    known?.serverUrl === target.serverUrl &&
    known.userId === userId &&
    known.team === target.team &&
    known.name === target.identifier;
  if (name.length === 26) {
    if (match || !isMattermostId(name)) return named(name);
    return byChannelId(config, target.identifier, userId, signal);
  }
  if ((match && known.kind === "G") || (!match && name.length === 40))
    return group(name);
  if (/^[a-z0-9]{26}__[a-z0-9]{26}$/u.test(name))
    return user(directPartnerId(name, userId));
  return named(name);
}
