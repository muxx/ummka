import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ChannelEventNotice } from "../mattermost/account-channel-events.ts";
import { useAccountPostObserver } from "./use-account-post-observer.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

afterEach(cleanup);
type Listener = Parameters<WorkspaceConnection["observeChannelEvents"]>[0];
function latch() {
  let end!: () => void;
  return {
    wait: new Promise<void>((resolve) => {
      end = resolve;
    }),
    end: () => end(),
  };
}
const notice: ChannelEventNotice = { kind: "reconcile" };
const session = vi.fn();
function observer() {
  const observe = vi.fn<WorkspaceConnection["observeChannelEvents"]>(
    async (_apply, signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
  );
  const account = {
    observeChannelEvents: observe,
  } as unknown as WorkspaceConnection;
  return { observe, account };
}

test("delivery waits for the first real write and the next batch starts only after it finishes", async () => {
  const { observe, account } = observer();
  const { result, unmount } = renderHook(() =>
    useAccountPostObserver(account, session),
  );
  const [receive, owner] = observe.mock.calls[0];
  const slow = latch(),
    handled = vi
      .fn<Listener>()
      .mockImplementationOnce(async () => slow.wait)
      .mockResolvedValue();
  result.current.active.current = {
    signal: new AbortController().signal,
    apply: handled,
  };
  let confirmed = 0;
  const delivery = (async () => {
    await receive(notice, owner);
    confirmed++;
    await receive(notice, owner);
    confirmed++;
  })();
  await Promise.resolve();
  expect(handled).toHaveBeenCalledOnce();
  expect(confirmed).toBe(0);
  slow.end();
  await delivery;
  expect(confirmed).toBe(2);
  expect(handled).toHaveBeenCalledTimes(2);
  expect(observe).toHaveBeenCalledOnce();
  unmount();
  expect(owner.aborted).toBe(true);
});
test("a navigation cancellation rechecks the new target with a fresh signal without reconnecting", async () => {
  const { account, observe } = observer();
  const { result } = renderHook(() => useAccountPostObserver(account, session));
  const [receive, owner] = observe.mock.calls[0];
  const old = new AbortController(),
    current = vi.fn<Listener>().mockResolvedValue();
  result.current.active.current = {
    signal: old.signal,
    apply: async (_, signal) =>
      await new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
  };
  const receipt = receive(notice, owner);
  result.current.active.current = {
    signal: new AbortController().signal,
    apply: current,
  };
  old.abort();
  await receipt;
  expect(current).toHaveBeenCalledOnce();
  expect(current.mock.calls[0][1].aborted).toBe(false);
  expect(observe).toHaveBeenCalledOnce();
});
test("a cancelled attempt rejects instead of acknowledging and account replacement aborts only its own observer", async () => {
  const first = observer(),
    second = observer();
  const { result, rerender } = renderHook(
    ({ account }) => useAccountPostObserver(account, session),
    { initialProps: { account: first.account } },
  );
  const [receive, owner] = first.observe.mock.calls[0],
    attempt = new AbortController(),
    gate = latch();
  result.current.active.current = {
    signal: new AbortController().signal,
    apply: () => gate.wait,
  };
  const receipt = receive(notice, attempt.signal);
  attempt.abort();
  gate.end();
  await expect(receipt).rejects.toMatchObject({ name: "AbortError" });
  rerender({ account: second.account });
  expect(owner.aborted).toBe(true);
  expect(second.observe.mock.calls[0][1].aborted).toBe(false);
});
test.each(["reading retry", "online"] as const)(
  "a failed observer resumes once on %s",
  async (action) => {
    const { observe, account } = observer();
    observe.mockRejectedValueOnce(new Error("connection failed"));
    const { result } = renderHook(() =>
      useAccountPostObserver(account, session),
    );
    await act(async () => {});
    act(() => {
      const resume =
        action === "online"
          ? () => window.dispatchEvent(new Event("online"))
          : result.current.retry;
      resume();
      resume();
    });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls[1][1]).toBe(observe.mock.calls[0][1]);
  },
);
