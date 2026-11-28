import type { ChannelsTarget } from "../mattermost/channels-link.ts";
import type { KnownChannelName } from "../mattermost/conversation-link-identifier.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "resolveConversationIdentifier" | "readNamedChannelDestination"
>;

export async function inspectConversationTarget(
  account: Account,
  target: Extract<ChannelsTarget, { kind: "conversation" }>,
  known?: KnownChannelName,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const address = await account.resolveConversationIdentifier(
    target,
    known,
    signal,
  );
  signal?.throwIfAborted();
  if (address.kind === "unavailable") return address;
  if (address.kind !== "channel-name" && address.kind !== "channel-id")
    return {
      kind: "conversation-address",
      address,
      teamName: target.team,
      postId: target.postId,
    } as const;

  const destination = await account.readNamedChannelDestination(
    target.team,
    address.name,
    signal,
  );
  signal?.throwIfAborted();
  if (destination.kind === "unavailable") return destination;
  // The channel may have been renamed and another channel may now own the name.
  if (
    address.kind === "channel-id" &&
    (address.teamId !== destination.team.id ||
      (destination.kind === "channel" && address.id !== destination.channel.id))
  )
    return { kind: "unavailable" } as const;

  return { ...destination, postId: target.postId };
}
