import { expect, test, vi } from "vitest";
import { submitVisibleCommand } from "./submit-visible-command.ts";

const location = { channelId: "c".repeat(26), teamId: "t".repeat(26) };
const draft = { message: "/forecast Reykjavik", revision: "reserved" };
test("local WebApp commands keep their arguments in the client", async () => {
  const account = { submitDraftCommand: vi.fn() };
  for (const name of [
    "SEARCH",
    "shortcuts",
    "leave",
    "settings",
    "marketplace",
  ]) {
    expect(
      await submitVisibleCommand(
        account,
        location,
        { ...draft, message: `/${name} private arguments` },
        new AbortController().signal,
        vi.fn(),
      ),
    ).toEqual({ kind: "localCommand", trigger: `/${name.toLowerCase()}` });
  }
  expect(account.submitDraftCommand).not.toHaveBeenCalled();
});
test("a server command uses its saved revision and reports an expired session only in the originating window", async () => {
  const controller = new AbortController(),
    unauthorized = vi.fn();
  const answer = { kind: "answered", result: { kind: "unauthorized" } };
  const account = {
    submitDraftCommand: vi
      .fn()
      .mockResolvedValueOnce(answer)
      .mockImplementationOnce(async () => {
        controller.abort();
        return answer;
      }),
  };
  expect(
    await submitVisibleCommand(
      account,
      location,
      draft,
      controller.signal,
      unauthorized,
    ),
  ).toEqual({ kind: "command", answer });
  expect(account.submitDraftCommand).toHaveBeenCalledExactlyOnceWith(
    location,
    draft.revision,
  );
  await submitVisibleCommand(
    account,
    location,
    draft,
    controller.signal,
    unauthorized,
  );
  expect(unauthorized).toHaveBeenCalledOnce();
  await expect(
    submitVisibleCommand(
      account,
      location,
      draft,
      controller.signal,
      unauthorized,
    ),
  ).rejects.toThrow();
  expect(account.submitDraftCommand).toHaveBeenCalledTimes(2);
});
