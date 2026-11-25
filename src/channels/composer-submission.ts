type Submission = {
  message: string;
  hasAttachments: boolean;
  scheduled: boolean;
  isKnownEmoji: (name: string) => boolean;
};

type SubmissionRoute =
  | { kind: "post" }
  | { kind: "command" }
  | { kind: "blockedCommand"; reason: "scheduled" | "attachments" }
  | { kind: "reaction"; action: "add" | "remove"; emoji: string };

/** Route a new draft before staging a post or checking its mention audience. */
export function composerSubmissionRoute({
  message,
  hasAttachments,
  scheduled,
  isKnownEmoji,
}: Submission): SubmissionRoute {
  if (message.startsWith("/")) {
    if (scheduled) return { kind: "blockedCommand", reason: "scheduled" };
    if (hasAttachments)
      return { kind: "blockedCommand", reason: "attachments" };
    return { kind: "command" };
  }
  if (!scheduled && !hasAttachments) {
    const match = /^([+-]):([^:\s]+):\s*$/.exec(message);
    if (match && isKnownEmoji(match[2])) {
      return {
        kind: "reaction",
        action: match[1] === "+" ? "add" : "remove",
        emoji: match[2],
      };
    }
  }
  return { kind: "post" };
}
