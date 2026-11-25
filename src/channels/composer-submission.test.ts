import { describe, expect, it, vi } from "vitest";
import { composerSubmissionRoute } from "./composer-submission.ts";

const options = {
  hasAttachments: false,
  scheduled: false,
  isKnownEmoji: (name: string) => ["smile", "team-ship"].includes(name),
};

describe("submission route for a channel or thread draft", () => {
  it.each(["/", "/help", "/unknown @all", "/me\nfirst line"])(
    "keeps %j on the command route even without a known trigger",
    (message) => {
      const isKnownEmoji = vi.fn();
      expect(
        composerSubmissionRoute({ ...options, message, isKnownEmoji }),
      ).toEqual({
        kind: "command",
      });
      expect(isKnownEmoji).not.toHaveBeenCalled();
    },
  );

  it.each([
    " /help",
    "\n/help",
    "one\n/help",
    "https://example.org/",
    "／help",
  ])("keeps %j as an ordinary post", (message) => {
    expect(composerSubmissionRoute({ ...options, message })).toEqual({
      kind: "post",
    });
  });

  it.each([
    { hasAttachments: true, scheduled: false, reason: "attachments" },
    { hasAttachments: false, scheduled: true, reason: "scheduled" },
    { hasAttachments: true, scheduled: true, reason: "scheduled" },
  ])(
    "blocks a command with $reason",
    ({ hasAttachments, scheduled, reason }) => {
      expect(
        composerSubmissionRoute({
          ...options,
          message: "/release private",
          hasAttachments,
          scheduled,
        }),
      ).toEqual({
        kind: "blockedCommand",
        reason,
      });
    },
  );

  it.each([
    ["+:smile:", "add", "smile"],
    ["-:team-ship: \t\n", "remove", "team-ship"],
  ])("routes %j to the known emoji", (message, action, emoji) => {
    expect(composerSubmissionRoute({ ...options, message })).toEqual({
      kind: "reaction",
      action,
      emoji,
    });
  });

  it.each(["+:unknown:", "+:SMILE:"])(
    "consults the directory with the original spelling of %j",
    (message) => {
      const isKnownEmoji = vi.fn(() => false);
      expect(
        composerSubmissionRoute({ ...options, message, isKnownEmoji }),
      ).toEqual({ kind: "post" });
      expect(isKnownEmoji).toHaveBeenCalledExactlyOnceWith(
        message.slice(2, -1),
      );
    },
  );

  it.each([
    "",
    ":smile:",
    "+:smile",
    " +:smile:",
    "+:smile: again",
    "+:sm ile:",
    "+::",
    "+:smile::",
    "+:smile:\n-:smile:",
  ])(
    "keeps incomplete or surrounding text %j without an emoji lookup",
    (message) => {
      const isKnownEmoji = vi.fn();
      expect(
        composerSubmissionRoute({ ...options, message, isKnownEmoji }),
      ).toEqual({ kind: "post" });
      expect(isKnownEmoji).not.toHaveBeenCalled();
    },
  );

  it.each([
    { hasAttachments: true, scheduled: false },
    { hasAttachments: false, scheduled: true },
  ])(
    "preserves the attachment and delivery time of a reaction-shaped post",
    (delivery) => {
      const isKnownEmoji = vi.fn(() => true);
      expect(
        composerSubmissionRoute({
          ...options,
          ...delivery,
          message: "+:smile:",
          isKnownEmoji,
        }),
      ).toEqual({ kind: "post" });
      expect(isKnownEmoji).not.toHaveBeenCalled();
    },
  );
});
