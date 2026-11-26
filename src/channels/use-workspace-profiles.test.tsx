import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { channelProfile } from "../mattermost/channel-profiles.ts";
import type { SavedProfiles } from "../mattermost/native-rest.ts";
import type { VisibleProfileQuery } from "../mattermost/visible-profiles.ts";
import { useWorkspaceProfiles } from "./use-workspace-profiles.ts";

afterEach(cleanup);
const peer = channelProfile({ id: "p".repeat(26), username: "peer" });
const member = channelProfile({ id: "m".repeat(26), username: "member" });
const oldAuthor = channelProfile({ id: "a".repeat(26), username: "author" });
const initial = { ids: [peer.id, oldAuthor.id], usernames: [member.username] };
const next = { ids: [peer.id, "b".repeat(26)], usernames: [member.username] };
const rows: SavedProfiles = {
  profiles: { [peer.id]: peer, [oldAuthor.id]: oldAuthor, [member.id]: member },
  usernames: { [member.username]: member.id },
};
const empty: SavedProfiles = { profiles: {}, usernames: {} };
function account() {
  return {
    readSavedProfiles:
      vi.fn<(q: VisibleProfileQuery) => Promise<SavedProfiles>>(),
    refreshSavedProfiles: vi.fn().mockResolvedValue(undefined),
  };
}
const sessionIssue = vi.fn();

test("keeps only shared sidebar identities while the next timeline loads and adopts a subsequent removal", async () => {
  const connection = account();
  let publish!: (next: SavedProfiles) => void;
  connection.readSavedProfiles
    .mockResolvedValueOnce(rows)
    .mockImplementationOnce(
      () =>
        new Promise<SavedProfiles>((resolve) => {
          publish = resolve;
        }),
    );
  const view = renderHook(
    (query: VisibleProfileQuery) =>
      useWorkspaceProfiles(connection, query, false, sessionIssue),
    { initialProps: initial },
  );
  await waitFor(() => expect(view.result.current).toEqual(rows));
  view.rerender(next);
  expect(view.result.current).toEqual({
    profiles: { [peer.id]: peer, [member.id]: member },
    usernames: { [member.username]: member.id },
  });
  await act(async () => publish(empty));
  expect(view.result.current).toEqual(empty);
  expect(connection.readSavedProfiles).toHaveBeenCalledTimes(2);
});

test("drops a signed owner's profiles immediately and ignores its late result", async () => {
  const first = account(),
    second = account();
  let late!: (value: SavedProfiles) => void;
  first.readSavedProfiles.mockResolvedValueOnce(rows).mockImplementationOnce(
    () =>
      new Promise<SavedProfiles>((resolve) => {
        late = resolve;
      }),
  );
  second.readSavedProfiles.mockRejectedValue(
    new ResponseError(new Response(null, { status: 403 })),
  );
  const view = renderHook(
    ({ connection, query }) =>
      useWorkspaceProfiles(connection, query, false, sessionIssue),
    { initialProps: { connection: first, query: initial } },
  );
  await waitFor(() => expect(view.result.current).toEqual(rows));
  view.rerender({ connection: first, query: next });
  expect(view.result.current.profiles[peer.id]).toBe(peer);
  view.rerender({ connection: second, query: next });
  expect(view.result.current).toEqual(empty);
  await act(async () => late(rows));
  expect(view.result.current).toEqual(empty);
  expect(second.readSavedProfiles).toHaveBeenCalledOnce();
});

test("clears retained profiles when access is refused on the same connection", async () => {
  const connection = account();
  connection.readSavedProfiles
    .mockResolvedValueOnce(rows)
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    );
  const view = renderHook(
    (query: VisibleProfileQuery) =>
      useWorkspaceProfiles(connection, query, false, sessionIssue),
    { initialProps: initial },
  );
  await waitFor(() => expect(view.result.current).toEqual(rows));
  view.rerender(next);
  await waitFor(() => expect(view.result.current).toEqual(empty));
});
