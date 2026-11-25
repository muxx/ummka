import { expect, test, vi } from "vitest";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { resolveComposerSubmission } from "./composer-submission.ts";

const input = { message: "", scheduled: false, hasAttachments: false };
const reader = () => ({
  readCustomEmoji:
    vi.fn<
      Awaited<ReturnType<typeof openAccountRestConnection>>["readCustomEmoji"]
    >(),
});

test.each([
  ["ordinary text", "post"],
  [" /help", "post"],
  ["/help private arguments", "command"],
  ["+:eyes: extra", "post"],
  ["+:not/an/emoji:", "post"],
  ["+:🔥:", "post"],
])(
  "classifies %s without disclosing it to a server lookup",
  async (message, kind) => {
    const account = reader();
    expect(
      await resolveComposerSubmission({ ...input, message }, account),
    ).toEqual({ kind });
    expect(account.readCustomEmoji).not.toHaveBeenCalled();
  },
);
test.each(["thumbsup", "+1", "mattermost"])(
  "keeps the exact standard alias %s offline",
  async (emoji) => {
    const account = reader();
    expect(
      await resolveComposerSubmission(
        { ...input, message: `-:${emoji}:` },
        account,
      ),
    ).toEqual({ kind: "reaction", action: "remove", emoji });
    expect(account.readCustomEmoji).not.toHaveBeenCalled();
  },
);
test("keeps the difference between an overlong known alias and an unrecognizable name", async () => {
  const account = reader();
  const emoji =
    "man_and_woman_holding_hands_medium_light_skin_tone_medium_dark_skin_tone";
  expect(
    await resolveComposerSubmission(
      { ...input, message: `+:${emoji}:` },
      account,
    ),
  ).toEqual({ kind: "blockedReaction", reason: "nameTooLong" });
  expect(
    await resolveComposerSubmission(
      { ...input, message: `+:${"a".repeat(65)}:` },
      account,
    ),
  ).toEqual({ kind: "post" });
  expect(account.readCustomEmoji).not.toHaveBeenCalled();
});
test("fetches one exact custom name only at an ordinary immediate submission", async () => {
  const account = reader();
  const signal = new AbortController().signal;
  const name = "Fixture_Wave";
  account.readCustomEmoji.mockResolvedValue({
    kind: "found",
    emoji: {
      name,
      id: "e".repeat(26),
      creatorId: "",
      createAt: 1,
      updateAt: 1,
      deleteAt: 0,
    },
  });
  const draft = { ...input, message: `+:${name}: ` };
  expect(
    await resolveComposerSubmission({ ...draft, scheduled: true }, account),
  ).toEqual({ kind: "post" });
  expect(
    await resolveComposerSubmission(
      { ...draft, hasAttachments: true },
      account,
    ),
  ).toEqual({ kind: "post" });
  expect(await resolveComposerSubmission(draft, account, signal)).toEqual({
    kind: "reaction",
    action: "add",
    emoji: name,
  });
  expect(account.readCustomEmoji).toHaveBeenCalledExactlyOnceWith(name, signal);
  expect(draft.message).toBe(`+:${name}: `);
});
test.each(["missing", "disabled"] as const)(
  "uses a normal post when the account confirms %s",
  async (kind) => {
    const account = reader();
    account.readCustomEmoji.mockResolvedValue({ kind });
    expect(
      await resolveComposerSubmission(
        { ...input, message: "+:fixture_wave:" },
        account,
      ),
    ).toEqual({ kind: "post" });
  },
);
test("preserves failures and drops a result received after cancellation", async () => {
  const account = reader();
  const draft = { ...input, message: "-:fixture_wave:" };
  const unavailable = new Error("unavailable");
  account.readCustomEmoji.mockRejectedValueOnce(unavailable);
  await expect(resolveComposerSubmission(draft, account)).rejects.toBe(
    unavailable,
  );
  const controller = new AbortController();
  account.readCustomEmoji.mockImplementationOnce(async () => {
    controller.abort();
    return { kind: "missing" };
  });
  await expect(
    resolveComposerSubmission(draft, account, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    resolveComposerSubmission(draft, account, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(account.readCustomEmoji).toHaveBeenCalledTimes(2);
  expect(draft.message).toBe("-:fixture_wave:");
});
