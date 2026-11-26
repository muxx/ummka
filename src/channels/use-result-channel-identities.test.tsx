import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { useResultChannelIdentities } from "./use-result-channel-identities.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

type Read = WorkspaceConnection["readChannelIdentity"];
const room = (id: string) => ({
  id,
  kind: "O" as const,
  teamId: "t".repeat(26),
  name: "lobby",
  displayName: "Lobby",
  deleteAt: 0,
});
afterEach(cleanup);
test("adding a page retains pending requests, limits parallel reads and cancels obsolete work", async () => {
  const owner = {},
    issue = vi.fn();
  const pending = new Map<string, (result: ReturnType<typeof room>) => void>();
  const account = {
    readChannelIdentity: vi.fn<Read>(
      (id) => new Promise((resolve) => pending.set(id, resolve)),
    ),
  };
  const ids = Array.from({ length: 7 }, (_, i) => String(i).repeat(26));
  const view = renderHook(
    ({ missing }) =>
      useResultChannelIdentities(account, owner, missing, true, issue),
    { initialProps: { missing: new Set(ids.slice(0, 5)) } },
  );
  expect(account.readChannelIdentity).toHaveBeenCalledTimes(4);
  view.rerender({ missing: new Set(ids) });
  expect(account.readChannelIdentity).toHaveBeenCalledTimes(4);
  await act(async () => {
    pending.get(ids[0])?.(room(ids[0]));
  });
  await waitFor(() =>
    expect(account.readChannelIdentity).toHaveBeenCalledTimes(5),
  );
  expect(view.result.current.get(ids[0])).toEqual(room(ids[0]));
  const obsolete = account.readChannelIdentity.mock.calls[1][1];
  view.rerender({ missing: new Set(ids.slice(2)) });
  expect(obsolete?.aborted).toBe(true);
  await act(async () => {
    pending.get(ids[1])?.(room(ids[1]));
  });
  expect(view.result.current.has(ids[1])).toBe(false);
  expect(account.readChannelIdentity.mock.calls.map(([id]) => id)).toEqual(
    ids.slice(0, 6),
  );
  view.unmount();
  expect(
    account.readChannelIdentity.mock.calls
      .slice(2)
      .every(([, s]) => s?.aborted),
  ).toBe(true);
});
test("offline selection defers reads, a revoked account reports once and a new selection gets a fresh lookup", async () => {
  const issue = vi.fn(),
    id = "x".repeat(26),
    missing = new Set([id]);
  const read = vi
    .fn<Read>()
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 401 })),
    )
    .mockResolvedValue(room(id));
  const account = { readChannelIdentity: read },
    owner = {};
  const view = renderHook(
    ({ owner, online }) =>
      useResultChannelIdentities(account, owner, missing, online, issue),
    { initialProps: { owner, online: false } },
  );
  expect(read).not.toHaveBeenCalled();
  view.rerender({ owner, online: true });
  await waitFor(() => expect(issue).toHaveBeenCalledWith("unauthorized"));
  expect(view.result.current.size).toBe(0);
  view.rerender({ owner: {}, online: true });
  await waitFor(() => expect(view.result.current.get(id)).toEqual(room(id)));
  expect(read).toHaveBeenCalledTimes(2);
});
