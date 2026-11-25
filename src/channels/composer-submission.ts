import { isMattermostEmojiName } from "../mattermost/model-fields.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";

type DraftInput = {
  message: string;
  hasAttachments: boolean;
  scheduled: boolean;
};
type PostRoute =
  | { kind: "post" }
  | { kind: "command" }
  | { kind: "blockedCommand"; reason: "scheduled" | "attachments" };
type ReactionRoute = {
  kind: "reaction";
  action: "add" | "remove";
  emoji: string;
};
type Candidate =
  | PostRoute
  | { kind: "candidate"; action: "add" | "remove"; emoji: string };

function parseSubmission({
  message,
  hasAttachments,
  scheduled,
}: DraftInput): Candidate {
  if (message.startsWith("/")) {
    if (scheduled) return { kind: "blockedCommand", reason: "scheduled" };
    if (hasAttachments)
      return { kind: "blockedCommand", reason: "attachments" };
    return { kind: "command" };
  }
  if (!scheduled && !hasAttachments) {
    const match = /^([+-]):([^:\s]+):\s*$/.exec(message);
    if (match)
      return {
        kind: "candidate",
        action: match[1] === "+" ? "add" : "remove",
        emoji: match[2],
      };
  }
  return { kind: "post" };
}

function resolveCandidate(
  candidate: Extract<Candidate, { kind: "candidate" }>,
  known: boolean,
): PostRoute | ReactionRoute {
  return known
    ? { kind: "reaction", action: candidate.action, emoji: candidate.emoji }
    : { kind: "post" };
}

/** Classify a draft against emoji names already available to the caller. */
export function composerSubmissionRoute(
  input: DraftInput & { isKnownEmoji: (name: string) => boolean },
): PostRoute | ReactionRoute {
  const route = parseSubmission(input);
  return route.kind === "candidate"
    ? resolveCandidate(route, input.isKnownEmoji(route.emoji))
    : route;
}

type EmojiReader = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "readCustomEmoji"
>;

/** Resolve an explicit submit. Ordinary messages and slash-command arguments stay on device here. */
export async function resolveComposerSubmission(
  input: DraftInput,
  account: EmojiReader,
  signal?: AbortSignal,
): Promise<
  PostRoute | ReactionRoute | { kind: "blockedReaction"; reason: "nameTooLong" }
> {
  signal?.throwIfAborted();
  const route = parseSubmission(input);
  if (route.kind !== "candidate") return route;
  const { findStandardEmoji } = await import("../mattermost/standard-emoji.ts");
  signal?.throwIfAborted();
  if (findStandardEmoji(route.emoji)) {
    if (route.emoji.length > 64)
      return { kind: "blockedReaction", reason: "nameTooLong" };
    return resolveCandidate(route, true);
  }
  if (!isMattermostEmojiName(route.emoji)) return { kind: "post" };
  const result = await account.readCustomEmoji(route.emoji, signal);
  signal?.throwIfAborted();
  return resolveCandidate(route, result.kind === "found");
}
