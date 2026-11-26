import { expect, test, vi } from "vitest";
import { submitVisibleCommand } from "./submit-visible-command.ts";

const location = { channelId: "c".repeat(26), teamId: "t".repeat(26) };
const draft = {
  message: "/forecast Reykjavik",
  revision: "reserved",
  isCurrent: () => true,
};
test("local WebApp commands keep their arguments in the client", async () => {
  const account = { submitDraftCommand: vi.fn(), saveDraft: vi.fn() };
  for (const name of ["shortcuts", "leave", "settings", "marketplace"]) {
    expect(
      await submitVisibleCommand(
        account,
        location,
        { ...draft, message: `/${name} private arguments` },
        new AbortController().signal,
        vi.fn(),
        vi.fn(),
      ),
    ).toEqual({ kind: "localCommand", trigger: `/${name.toLowerCase()}` });
  }
  expect(account.submitDraftCommand).not.toHaveBeenCalled();
});
test("routes only the complete search trigger and keeps case and spacing in its argument", async () => {
  const account = {
    submitDraftCommand: vi.fn().mockResolvedValue({ kind: "superseded" }),
    saveDraft: vi.fn(),
  };
  const open = vi.fn().mockResolvedValue(true);
  const run = (message: string) =>
    submitVisibleCommand(
      account,
      location,
      { ...draft, message },
      new AbortController().signal,
      vi.fn(),
      open,
    );
  await expect(run("/SeArCh  from:Ada отчёт")).resolves.toEqual({
    kind: "search",
  });
  await expect(run("/search")).resolves.toEqual({ kind: "search" });
  expect(open.mock.calls.map(([terms]) => terms)).toEqual([
    " from:Ada отчёт",
    "",
  ]);
  expect(account.saveDraft).toHaveBeenCalledWith({
    channelId: location.channelId,
    rootId: undefined,
    expectedRevision: draft.revision,
    message: "",
  });
  expect(account.submitDraftCommand).not.toHaveBeenCalled();
  await run("/search-all projects");
  expect(open).toHaveBeenCalledTimes(2);
  expect(account.submitDraftCommand).toHaveBeenCalledExactlyOnceWith(
    location,
    draft.revision,
  );
});
test.each(["changed", "aborted", "not opened"] as const)(
  "a %s search leaves the command draft untouched",
  async (reason) => {
    const account = { submitDraftCommand: vi.fn(), saveDraft: vi.fn() };
    const owner = new AbortController();
    let current = true;
    await submitVisibleCommand(
      account,
      location,
      { ...draft, message: "/search отчёт", isCurrent: () => current },
      owner.signal,
      vi.fn(),
      async () => {
        if (reason === "changed") current = false;
        if (reason === "aborted") owner.abort();
        return reason !== "not opened";
      },
    );
    expect(account.saveDraft).not.toHaveBeenCalled();
    expect(account.submitDraftCommand).not.toHaveBeenCalled();
  },
);
test.each([location, { ...location, rootId: "r".repeat(26) }])(
  "a server command uses its saved revision and reports an expired session only in the originating window",
  async (scope) => {
    const controller = new AbortController(),
      unauthorized = vi.fn();
    const answer = { kind: "answered", result: { kind: "unauthorized" } };
    const account = {
      saveDraft: vi.fn(),
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
        scope,
        draft,
        controller.signal,
        unauthorized,
        vi.fn(),
      ),
    ).toEqual({ kind: "command", answer });
    expect(account.submitDraftCommand).toHaveBeenCalledExactlyOnceWith(
      scope,
      draft.revision,
    );
    await submitVisibleCommand(
      account,
      scope,
      draft,
      controller.signal,
      unauthorized,
      vi.fn(),
    );
    expect(unauthorized).toHaveBeenCalledOnce();
    await expect(
      submitVisibleCommand(
        account,
        scope,
        draft,
        controller.signal,
        unauthorized,
        vi.fn(),
      ),
    ).rejects.toThrow();
    expect(account.submitDraftCommand).toHaveBeenCalledTimes(2);
  },
);
