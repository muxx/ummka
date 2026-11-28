import { ResponseError } from "../../vendor/mattermost/index.js";
import { isMattermostId } from "../mattermost/model-fields.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { nextPostDestinationStep } from "./post-destination-step.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "readFileAnchor" | "readPostAnchor" | "readPostDestination"
>;
type ChannelScope = { teamId: string; channelId: string; kind: "O" | "P" };
type Source =
  | { kind: "post" | "file"; id: string }
  | {
      kind: "named-channel-post";
      id: string;
      readChannelScope: (signal?: AbortSignal) => Promise<ChannelScope | null>;
    };

export async function inspectPostTarget(
  account: Account,
  source: Source,
  selectedTeamId: string | null,
  signal?: AbortSignal,
) {
  let retentionHeader: string | undefined;
  try {
    signal?.throwIfAborted();
    if (
      (source.kind !== "post" &&
        source.kind !== "file" &&
        source.kind !== "named-channel-post") ||
      !isMattermostId(source.id) ||
      (selectedTeamId !== null && !isMattermostId(selectedTeamId))
    )
      throw new TypeError("Invalid Mattermost navigation target.");
    let postId = source.id;
    let fileChannelId: string | undefined;
    if (source.kind === "file") {
      retentionHeader = "first-inaccessible-file-time";
      const file = await account.readFileAnchor(source.id, signal);
      signal?.throwIfAborted();
      if (file.postId === null) return { kind: "unattachedFile" } as const;
      postId = file.postId;
      fileChannelId = file.channelId;
    }
    const namedChannel =
      source.kind === "named-channel-post"
        ? await source.readChannelScope(signal)
        : undefined;
    signal?.throwIfAborted();
    if (namedChannel === null) return { kind: "unavailable" } as const;
    retentionHeader = undefined;
    const destination = await account.readPostDestination(postId, signal);
    signal?.throwIfAborted();
    if (fileChannelId !== undefined && fileChannelId !== destination.channel.id)
      throw new TypeError(
        "File and post belong to different Mattermost channels.",
      );
    if (
      namedChannel &&
      (destination.team?.id !== namedChannel.teamId ||
        !destination.team.joined ||
        destination.channel.id !== namedChannel.channelId ||
        destination.channel.kind !== namedChannel.kind ||
        !destination.channel.joined)
    )
      return { kind: "unavailable" } as const;
    const step = nextPostDestinationStep(destination, selectedTeamId);
    if (step.kind === "joinTeam")
      return { ...step, channel: destination.channel };
    if (step.kind !== "readPost") return step;
    retentionHeader = "first-inaccessible-post-time";
    const anchor = await account.readPostAnchor(postId, signal);
    signal?.throwIfAborted();
    if (anchor.channelId !== step.channelId)
      throw new TypeError(
        "Post and destination belong to different Mattermost channels.",
      );
    if (!anchor.post) return { kind: "unavailable" } as const;
    return { kind: "ready", teamId: step.teamId, ...anchor } as const;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ResponseError) {
      if (error.response.status === 404)
        return { kind: "unavailable" } as const;
      if (
        error.response.status === 403 &&
        retentionHeader &&
        error.response.headers.get(retentionHeader) === "1"
      )
        return { kind: "archived" } as const;
    }
    throw error;
  }
}
