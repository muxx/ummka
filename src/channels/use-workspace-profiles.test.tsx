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
    refreshSavedProfiles: vi.fn().mockResolvedValue([]),
  };
}
const sessionIssue = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

test("returns to a known author before the next SQLite read completes", async () => {
  const connection = account();
  let resume!: (value: SavedProfiles) => void;
  connection.readSavedProfiles
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(empty)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
  const view = renderHook(
    (query: VisibleProfileQuery) =>
      useWorkspaceProfiles(connection, query, false, sessionIssue),
    { initialProps: initial },
  );
  await waitFor(() =>
    expect(view.result.current.profiles[oldAuthor.id]).toBe(oldAuthor),
  );
  view.rerender({ ids: ["b".repeat(26)], usernames: [] });
  await waitFor(() => expect(view.result.current).toEqual(empty));
  view.rerender(initial);
  expect(view.result.current.profiles[oldAuthor.id]).toBe(oldAuthor);
  const changed = { ...oldAuthor, firstName: "Renamed", isGuest: true };
  await act(async () =>
    resume({ profiles: { [oldAuthor.id]: changed }, usernames: {} }),
  );
  expect(view.result.current.profiles[oldAuthor.id]).toBe(changed);
});

test("a partial server result hides only the unreturned author's stale SQLite row", async () => {
  const connection = account();
  const { ids } = initial;
  const renamed = { ...peer, firstName: "New", isBot: true };
  const saved = {
    profiles: { [peer.id]: renamed, [oldAuthor.id]: oldAuthor },
    usernames: {},
  };
  const reread = deferred<SavedProfiles>();
  connection.readSavedProfiles
    .mockResolvedValueOnce(saved)
    .mockReturnValueOnce(reread.promise)
    .mockResolvedValue(saved);
  connection.refreshSavedProfiles.mockResolvedValue([renamed]);
  const view = renderHook(
    ({ query, online }: { query: VisibleProfileQuery; online: boolean }) =>
      useWorkspaceProfiles(connection, query, online, sessionIssue),
    { initialProps: { query: { ids, usernames: [] }, online: true } },
  );
  await waitFor(() =>
    expect(view.result.current.profiles).toEqual({ [peer.id]: renamed }),
  );
  expect(connection.refreshSavedProfiles).toHaveBeenCalledTimes(1);
  expect(connection.readSavedProfiles).toHaveBeenCalledTimes(2);
  await act(async () => reread.resolve(saved));
  view.rerender({ query: { ids: [], usernames: [] }, online: false });
  await act(async () => {});
  view.rerender({ query: { ids, usernames: [] }, online: false });
  expect(view.result.current.profiles).toEqual({ [peer.id]: renamed });
  await act(async () => {});
  expect(view.result.current.profiles).toEqual({ [peer.id]: renamed });
  expect(connection.refreshSavedProfiles).toHaveBeenCalledTimes(1);
});

test("a 403 in another view clears the common author, while a network failure keeps previously read profiles", async () => {
  const connection = account();
  connection.readSavedProfiles.mockResolvedValue(rows);
  const view = renderHook(() =>
    useWorkspaceProfiles(connection, initial, false, sessionIssue),
  );
  await waitFor(() =>
    expect(view.result.current.profiles[oldAuthor.id]).toBe(oldAuthor),
  );
  connection.readSavedProfiles
    .mockRejectedValueOnce(new TypeError("Network interrupted"))
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    );
  const query = { ids: [oldAuthor.id], usernames: [] };
  const second = renderHook(() =>
    useWorkspaceProfiles(connection, query, false, sessionIssue),
  );
  await act(async () => {});
  expect(second.result.current.profiles[oldAuthor.id]).toBe(oldAuthor);
  second.unmount();
  const third = renderHook(() =>
    useWorkspaceProfiles(connection, query, false, sessionIssue),
  );
  await waitFor(() => expect(third.result.current.profiles).toEqual({}));
  expect(view.result.current.profiles).toEqual({
    [peer.id]: peer,
    [member.id]: member,
  });
});

test("retains an ID without making its previous username lookup available", async () => {
  const connection = account();
  const pending = deferred<SavedProfiles>();
  connection.readSavedProfiles
    .mockResolvedValueOnce(rows)
    .mockReturnValueOnce(pending.promise);
  const earlier = renderHook(() =>
    useWorkspaceProfiles(connection, initial, false, sessionIssue),
  );
  await waitFor(() =>
    expect(earlier.result.current.profiles[oldAuthor.id]).toBe(oldAuthor),
  );
  earlier.unmount();
  const next = renderHook(() =>
    useWorkspaceProfiles(
      connection,
      { ids: [], usernames: [oldAuthor.username, member.username] },
      false,
      sessionIssue,
    ),
  );
  expect(next.result.current).toEqual(empty);
  await act(async () => pending.resolve(empty));
  expect(next.result.current).toEqual(empty);
});

test("publishes a rename to an overlapping view before releasing the older read", async () => {
  const connection = account();
  const newer = { ...oldAuthor, firstName: "Current", isBot: true };
  const delayed = deferred<SavedProfiles>();
  connection.readSavedProfiles
    .mockResolvedValueOnce({
      profiles: { [oldAuthor.id]: oldAuthor },
      usernames: {},
    })
    .mockReturnValueOnce(delayed.promise)
    .mockResolvedValueOnce({
      profiles: { [oldAuthor.id]: newer },
      usernames: {},
    });
  const shared = { ids: [oldAuthor.id], usernames: [] };
  const first = renderHook(
    (query: VisibleProfileQuery) =>
      useWorkspaceProfiles(connection, query, false, sessionIssue),
    { initialProps: shared },
  );
  await waitFor(() =>
    expect(first.result.current.profiles[oldAuthor.id]).toBe(oldAuthor),
  );
  first.rerender({ ids: [oldAuthor.id, peer.id], usernames: [] });
  const second = renderHook(() =>
    useWorkspaceProfiles(connection, shared, false, sessionIssue),
  );
  await waitFor(() =>
    expect(second.result.current.profiles[oldAuthor.id]).toBe(newer),
  );
  expect(first.result.current.profiles[oldAuthor.id]).toBe(newer);
  await act(async () => delayed.resolve(rows));
  expect(first.result.current.profiles).toEqual({
    [oldAuthor.id]: newer,
    [peer.id]: peer,
  });
  expect(second.result.current.profiles).toEqual({ [oldAuthor.id]: newer });
});
