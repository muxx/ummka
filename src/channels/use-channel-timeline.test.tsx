import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { createChannelHistoryChanges } from "../mattermost/channel-history-changes.ts";
import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import type { TimelineAccount, TimelineRequest } from "./timeline-reader.ts";
import { useChannelTimeline } from "./use-channel-timeline.ts";

afterEach(cleanup);

const teamId = "t".repeat(26);
const channelId = "c".repeat(26);
function post(key: string, rootId: string | null = null): LocalPost {
  return {
    id: key.repeat(26),
    rootId,
    channelId,
    userId: "u".repeat(26),
    message: key,
    createAt: 100,
    updateAt: 100,
    editAt: 0,
    type: "",
    hashtags: "",
    isPinned: false,
    messageSource: null,
  };
}
const root = post("r"),
  reply = post("p", root.id),
  old = post("o"),
  newer = post("n");
function page(...posts: LocalPost[]): LocalChannelWindow {
  return {
    posts,
    older: { kind: "more", postId: old.id },
    newer: { kind: "more", postId: newer.id },
    firstInaccessiblePostTime: 5,
  };
}
function focus(
  post: LocalPost = root,
  requestId = 1,
): Extract<TimelineRequest, { kind: "focus" }> {
  return { kind: "focus", rid: 1, teamId, post, requestId };
}
function account(rid = 1) {
  const changes = createChannelHistoryChanges();
  return {
    rid,
    subscribeToChannelHistory: changes.subscribe,
    notify: changes.notify,
    readChannelWindow: vi.fn<TimelineAccount["readChannelWindow"]>(),
    refreshChannelHistory: vi
      .fn<TimelineAccount["refreshChannelHistory"]>()
      .mockResolvedValue({ kind: "applied" }),
  };
}
type Props = {
  request?: TimelineRequest;
  collapsed?: boolean;
  online?: boolean;
  teamId?: string;
  channelId?: string;
  account?: TimelineAccount;
};
function open(native: TimelineAccount, props: Props = {}) {
  const ended = vi.fn();
  const view = renderHook(
    (p: Props) =>
      useChannelTimeline(
        p.account ?? native,
        p.teamId ?? teamId,
        p.channelId ?? channelId,
        p.collapsed ?? true,
        p.online ?? true,
        ended,
        p.request,
      ),
    { initialProps: props },
  );
  return { ...view, ended };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
function denied(status: number) {
  return new ResponseError(new Response(null, { status }));
}

test.each([
  [root, true, root],
  [reply, false, reply],
  [reply, true, root],
] as const)(
  "opens the exact destination without latest or an extra post lookup %#",
  async (post, collapsed, anchor) => {
    const native = account(),
      stored = page(anchor);
    native.readChannelWindow
      .mockResolvedValueOnce(null)
      .mockResolvedValue(stored);
    const view = open(native, { request: focus(post), collapsed });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    const destination = {
      requestId: 1,
      anchorId: anchor.id,
      ...(post === reply && collapsed && { focusedReply: reply }),
    };
    expect(view.result.current).toMatchObject({
      page: stored,
      focus: destination,
      latest: false,
      firstInaccessiblePostTime: 5,
    });
    expect(native.refreshChannelHistory.mock.calls.map(([q]) => q)).toEqual([
      {
        kind: "focused",
        channelId,
        collapsedThreads: collapsed,
        postId: anchor.id,
        perPage: 30,
      },
    ]);
    for (const [q] of native.readChannelWindow.mock.calls)
      expect(q).toEqual({
        kind: "around",
        channelId,
        collapsedThreads: collapsed,
        postId: anchor.id,
        newer: 30,
        older: 30,
      });
    expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
    view.rerender({ request: focus({ ...post }), collapsed });
    expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
    view.rerender({ request: focus(post, 2), collapsed });
    await waitFor(() => expect(view.result.current.focus?.requestId).toBe(2));
    expect(native.readChannelWindow).toHaveBeenCalledTimes(3);
  },
);

test("checks the account, team and channel before touching any storage", async () => {
  const native = account(),
    stored = page(root);
  native.readChannelWindow.mockResolvedValue(stored);
  const view = open(native, { request: focus(), teamId: "elsewhere" });
  const other = account(2);
  for (const p of [
    { channelId: "other" },
    { account: other },
    { teamId: "elsewhere" },
  ]) {
    view.rerender({ request: focus(), ...p });
    expect(view.result.current).toMatchObject({
      page: null,
      focus: null,
      status: "unavailable",
      latest: false,
    });
  }
  expect(other.readChannelWindow).not.toHaveBeenCalled();
  expect(other.refreshChannelHistory).not.toHaveBeenCalled();
  expect(native.readChannelWindow).not.toHaveBeenCalled();
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
  view.rerender({ request: focus() });
  await waitFor(() => expect(view.result.current.page).toBe(stored));
});

test("missing offline focus resumes the same read on reconnect; a cached visible focus stays put", async () => {
  const native = account(),
    stored = page(root);
  native.readChannelWindow
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValue(stored);
  const view = open(native, { request: focus(), online: false });
  await waitFor(() => expect(view.result.current.status).toBe("offline"));
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
  view.rerender({ request: focus(), online: true });
  await waitFor(() => expect(view.result.current.page).toBe(stored));
  expect(native.refreshChannelHistory.mock.calls.map(([q]) => q.kind)).toEqual([
    "focused",
  ]);
  view.rerender({ request: focus(), online: false });
  view.rerender({ request: focus(), online: true });
  expect(native.readChannelWindow).toHaveBeenCalledTimes(3);
  view.rerender({ request: focus(root, 2), online: false });
  await waitFor(() => expect(view.result.current.focus?.requestId).toBe(2));
  expect(native.refreshChannelHistory).toHaveBeenCalledTimes(1);
});

test("recomputes the anchor from the original reply when thread mode changes; cancels late denials", async () => {
  const native = account(),
    delay = deferred<null>();
  native.readChannelWindow
    .mockResolvedValueOnce(null)
    .mockResolvedValue(page(reply));
  native.refreshChannelHistory.mockImplementationOnce(() =>
    delay.promise.then(() => ({ kind: "applied" })),
  );
  const view = open(native, { request: focus(reply) });
  await waitFor(() =>
    expect(native.refreshChannelHistory).toHaveBeenCalledTimes(1),
  );
  const signal = native.refreshChannelHistory.mock.calls[0][1];
  view.rerender({ request: focus(reply), collapsed: false });
  expect(signal?.aborted).toBe(true);
  await waitFor(() =>
    expect(view.result.current.focus).toEqual({
      requestId: 1,
      anchorId: reply.id,
    }),
  );
  await act(async () => delay.reject(denied(401)));
  expect(view.ended).not.toHaveBeenCalled();
  expect(view.result.current.page?.posts).toEqual([reply]);
  expect(
    native.readChannelWindow.mock.calls.map(
      ([q]) => q.kind === "around" && q.postId,
    ),
  ).toEqual([root.id, reply.id]);
});

test("default and explicit latest use the ordinary reader, including a return from a paged latest", async () => {
  const native = account(),
    latest = { ...page(newer), newer: { kind: "end" as const } },
    previous = page(newer, root),
    next = { ...latest, posts: [old] };
  native.readChannelWindow
    .mockResolvedValueOnce(latest)
    .mockResolvedValueOnce(latest)
    .mockResolvedValueOnce(previous)
    .mockResolvedValue(next);
  const view = open(native);
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(view.result.current).toMatchObject({
    page: latest,
    focus: null,
    latest: true,
  });
  await act(async () => view.result.current.loadEdge("older", old.id));
  expect(view.result.current).toMatchObject({
    page: previous,
    focus: null,
    latest: false,
  });
  view.rerender({ request: { kind: "latest", requestId: 1 } });
  await waitFor(() => expect(view.result.current.page).toBe(next));
  expect(native.refreshChannelHistory.mock.calls.map(([q]) => q.kind)).toEqual([
    "latest",
    "latest",
  ]);
});

test("preserves server order at both edges and the focus command while advancing to the end", async () => {
  const native = account(),
    initial = page(root),
    before = page(root, old),
    after: LocalChannelWindow = {
      ...page(newer, root, old),
      newer: { kind: "end" },
      older: { kind: "unknown" },
    };
  native.readChannelWindow
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(after);
  const view = open(native, { request: focus() });
  await waitFor(() => expect(view.result.current.page).toBe(initial));
  const destination = view.result.current.focus;
  await act(async () => view.result.current.loadEdge("older", newer.id));
  expect(native.readChannelWindow).toHaveBeenCalledTimes(1);
  await act(async () => view.result.current.loadEdge("older", old.id));
  expect(view.result.current.page).toBe(before);
  expect(view.result.current.focus).toBe(destination);
  await act(async () => view.result.current.loadEdge("newer", newer.id));
  expect(view.result.current.page).toBe(after);
  expect(view.result.current.focus).toBe(destination);
  expect(view.result.current.latest).toBe(true);
  await act(async () => {
    await view.result.current.loadEdge("older", old.id);
    await view.result.current.loadEdge("newer", newer.id);
  });
  expect(native.readChannelWindow).toHaveBeenCalledTimes(5);
  expect(native.refreshChannelHistory.mock.calls.map(([q]) => q.kind)).toEqual([
    "before",
    "after",
  ]);
  view.rerender({ request: { kind: "latest", requestId: 2 } });
  await waitFor(() =>
    expect(native.refreshChannelHistory.mock.lastCall?.[0].kind).toBe("latest"),
  );
  expect(view.result.current.focus).toBeNull();
});

test.each(["network", "superseded", "offline"] as const)(
  "retries the same failed edge after %s, keeping the last visible page",
  async (reason) => {
    const native = account(),
      initial = page(root),
      advanced = page(root, old);
    native.readChannelWindow.mockResolvedValue(initial);
    if (reason === "network")
      native.refreshChannelHistory.mockRejectedValueOnce(Error("unreachable"));
    if (reason === "superseded")
      native.refreshChannelHistory.mockResolvedValueOnce({
        kind: "superseded",
      });
    const view = open(native, {
      request: focus(),
      online: reason !== "offline",
    });
    await waitFor(() => expect(view.result.current.page).toBe(initial));
    await act(async () => view.result.current.loadEdge("older", old.id));
    expect(view.result.current).toMatchObject({
      page: initial,
      notice: reason,
      focus: { requestId: 1, anchorId: root.id },
    });
    expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
    native.readChannelWindow
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(advanced);
    if (reason === "offline") view.rerender({ request: focus(), online: true });
    else await act(async () => view.result.current.retry());
    await waitFor(() => expect(view.result.current.page).toBe(advanced));
    expect(view.result.current.notice).toBeNull();
    expect(
      native.refreshChannelHistory.mock.calls.map(([q]) => q.kind),
    ).toEqual(reason === "offline" ? ["before"] : ["before", "before"]);
  },
);

test.each(["focus", "edge"] as const)(
  "retains the cutoff and closes the %s when the server archives its entire window",
  async (which) => {
    const native = account(),
      initial = page(root);
    if (which === "focus") native.readChannelWindow.mockResolvedValue(null);
    else native.readChannelWindow.mockResolvedValue(initial);
    native.refreshChannelHistory.mockResolvedValue({
      kind: "inaccessible",
      firstInaccessiblePostTime: 500,
    });
    const view = open(native, { request: focus() });
    if (which === "edge") {
      await waitFor(() => expect(view.result.current.page).toBe(initial));
      await act(async () => view.result.current.loadEdge("older", old.id));
    }
    await waitFor(() =>
      expect(view.result.current.status).toBe("inaccessible"),
    );
    expect(view.result.current).toMatchObject({
      focus: null,
      page: null,
      firstInaccessiblePostTime: 500,
      latest: false,
    });
    expect(native.readChannelWindow).toHaveBeenCalledTimes(
      which === "edge" ? 2 : 1,
    );
  },
);

test.each([403, 404, 401, "session_unavailable"] as const)(
  "withholds cached content on an active edge refusal %s",
  async (failure) => {
    const native = account(),
      initial = page(root);
    native.readChannelWindow.mockResolvedValue(initial);
    native.refreshChannelHistory.mockRejectedValue(
      typeof failure === "number" ? denied(failure) : failure,
    );
    const view = open(native, { request: focus() });
    await waitFor(() => expect(view.result.current.page).toBe(initial));
    await act(async () => view.result.current.loadEdge("newer", newer.id));
    const status =
      failure === 401
        ? "unauthorized"
        : failure === "session_unavailable"
          ? "session"
          : "forbidden";
    expect(view.result.current).toMatchObject({
      focus: null,
      page: null,
      latest: false,
      status,
    });
    if (status === "forbidden") expect(view.ended).not.toHaveBeenCalled();
    else expect(view.ended).toHaveBeenCalledExactlyOnceWith(status);
  },
);

test("withholds an unrelated cached and committed end window when the shared boundary disappears", async () => {
  const native = account(),
    initial = page(root),
    unrelated: LocalChannelWindow = { ...page(old), newer: { kind: "end" } };
  native.readChannelWindow
    .mockResolvedValueOnce(initial)
    .mockResolvedValue(unrelated);
  const view = open(native, { request: focus() });
  await waitFor(() => expect(view.result.current.page).toBe(initial));
  await act(async () => view.result.current.loadEdge("newer", newer.id));
  expect(
    native.refreshChannelHistory.mock.calls.map(([query]) => query.kind),
  ).toEqual(["after"]);
  expect(view.result.current).toMatchObject({
    page: null,
    focus: null,
    status: "unavailable",
    latest: false,
  });
});

test.each(["second target", "latest", "other account", "unmount"] as const)(
  "a delayed edge cannot restore old content or expire a session after %s",
  async (change) => {
    const native = account(),
      initial = page(root),
      second = page(old),
      delay = deferred<null>();
    native.readChannelWindow
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(second);
    native.refreshChannelHistory.mockImplementationOnce(() =>
      delay.promise.then(() => ({ kind: "applied" })),
    );
    const view = open(native, { request: focus() });
    await waitFor(() => expect(view.result.current.page).toBe(initial));
    const original = view.result.current;
    let edge: Promise<void> | undefined;
    act(() => {
      edge = original.loadEdge("older", old.id);
    });
    await waitFor(() =>
      expect(native.refreshChannelHistory).toHaveBeenCalledTimes(1),
    );
    const signal = native.refreshChannelHistory.mock.calls[0][1];
    if (change === "unmount") view.unmount();
    else if (change === "latest")
      view.rerender({ request: { kind: "latest", requestId: 2 } });
    else if (change === "second target")
      view.rerender({ request: focus(old, 2) });
    else {
      const secondAccount = account(2);
      secondAccount.readChannelWindow.mockResolvedValue(second);
      view.rerender({
        account: secondAccount,
        request: { ...focus(old, 2), rid: 2 },
      });
    }
    expect(signal?.aborted).toBe(true);
    if (change !== "unmount")
      await waitFor(() => expect(view.result.current.page).toBe(second));
    await act(async () => {
      delay.reject(denied(401));
      await edge;
      await original.retry();
    });
    expect(view.ended).not.toHaveBeenCalled();
    if (change !== "unmount") expect(view.result.current.page).toBe(second);
  },
);

test("explicitly retries the original target after its write was displaced", async () => {
  const native = account(),
    stored = page(root);
  native.readChannelWindow
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValue(stored);
  native.refreshChannelHistory.mockResolvedValueOnce({ kind: "superseded" });
  const view = open(native, { request: focus(reply) });
  await waitFor(() => expect(view.result.current.status).toBe("superseded"));
  expect(view.result.current.page).toBeNull();
  expect(native.readChannelWindow).toHaveBeenCalledTimes(1);
  await act(async () => view.result.current.retry());
  expect(view.result.current).toMatchObject({
    page: stored,
    focus: { requestId: 1, anchorId: root.id, focusedReply: reply },
  });
  expect(native.refreshChannelHistory.mock.calls.map(([q]) => q.kind)).toEqual([
    "focused",
    "focused",
  ]);
});

test("a new focus hides cached latest immediately and ignores its later successful refresh", async () => {
  const native = account(),
    opening = page(newer),
    target = page(root);
  const previous = deferred<{ kind: "applied" }>(),
    delayedTarget = deferred<LocalChannelWindow>();
  native.readChannelWindow
    .mockResolvedValueOnce(opening)
    .mockReturnValueOnce(delayedTarget.promise);
  native.refreshChannelHistory.mockReturnValueOnce(previous.promise);
  const view = open(native);
  await waitFor(() => expect(view.result.current.page).toBe(opening));
  const signal = native.refreshChannelHistory.mock.calls[0][1];
  view.rerender({ request: focus() });
  expect(view.result.current).toMatchObject({
    status: "loading",
    page: null,
    focus: null,
    latest: false,
  });
  expect(signal?.aborted).toBe(true);
  await act(async () => delayedTarget.resolve(target));
  await act(async () => previous.resolve({ kind: "applied" }));
  expect(view.result.current).toMatchObject({
    status: "ready",
    page: target,
    focus: { requestId: 1, anchorId: root.id },
  });
  expect(
    native.readChannelWindow.mock.calls.map(([query]) => query.kind),
  ).toEqual(["latest", "around"]);
});

test("a second target in the same channel owns the view even when its predecessor completes last", async () => {
  const native = account(),
    next = page(old),
    before = deferred<LocalChannelWindow>();
  native.readChannelWindow
    .mockReturnValueOnce(before.promise)
    .mockResolvedValueOnce(next);
  const view = open(native, { request: focus(root) });
  view.rerender({ request: focus(old, 2) });
  await waitFor(() => expect(view.result.current.page).toBe(next));
  await act(async () => before.resolve(page(root)));
  expect(view.result.current).toMatchObject({
    page: next,
    focus: { requestId: 2, anchorId: old.id },
  });
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
});

test("an old cached row cannot reopen a refused focused destination on retry or reconnect", async () => {
  const native = account(),
    initial = page(root);
  native.readChannelWindow.mockResolvedValue(initial);
  native.refreshChannelHistory.mockRejectedValueOnce(denied(403));
  const view = open(native, { request: focus() });
  await waitFor(() => expect(view.result.current.page).toBe(initial));
  await act(async () => view.result.current.loadEdge("older", old.id));
  expect(view.result.current).toMatchObject({
    status: "forbidden",
    canRetry: false,
    page: null,
    focus: null,
  });
  await act(async () => view.result.current.retry());
  view.rerender({ request: focus(), online: false });
  view.rerender({ request: focus(), online: true });
  expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
  expect(view.result.current.page).toBeNull();
  view.rerender({ request: focus(root, 2) });
  await waitFor(() => expect(view.result.current.focus?.requestId).toBe(2));
  expect(view.result.current.page).toBe(initial);
});

function viewport(ids: string[], atBottom = false) {
  const pane = document.createElement("section");
  Object.defineProperties(pane, {
    scrollHeight: { value: 400 },
    clientHeight: { value: 100 },
  });
  pane.scrollTop = atBottom ? 300 : 80;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  for (const [index, id] of ids.entries()) {
    const row = document.createElement("article");
    row.dataset.postId = id;
    row.getBoundingClientRect = () => new DOMRect(0, index * 27 - 3, 100, 27);
    pane.append(row);
  }
  return pane;
}
const end = (...posts: LocalPost[]): LocalChannelWindow => ({
  ...page(...posts),
  newer: { kind: "end" },
});

test("notifies only the scoped open account and coalesces commits during local reads", async () => {
  const native = account(),
    other = account(2);
  const one = end(root),
    two = end(newer, root);
  native.readChannelWindow.mockResolvedValue(one);
  native.refreshChannelHistory.mockImplementation(async (_request, signal) => {
    native.notify(channelId, signal);
    return { kind: "applied" };
  });
  const view = open(native);
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
  view.result.current.viewport.current = viewport([root.id], true);
  const first = deferred<LocalChannelWindow>();
  native.readChannelWindow
    .mockResolvedValue(two)
    .mockImplementationOnce(() => first.promise);
  act(() => {
    other.notify(channelId);
    native.notify("another-channel");
  });
  expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
  act(() => {
    native.notify(channelId);
    native.notify(channelId);
    native.notify(channelId);
  });
  expect(native.readChannelWindow).toHaveBeenCalledTimes(3);
  await act(async () => first.resolve(one));
  expect(view.result.current.page).toBe(two);
  expect(native.readChannelWindow).toHaveBeenCalledTimes(4);
  expect(native.refreshChannelHistory).toHaveBeenCalledTimes(1);
});

test("an outgoing row anchors scrolling without being queried as a published post", async () => {
  const native = account();
  const initial = end(root);
  native.readChannelWindow.mockResolvedValue(initial);
  const view = open(native, { online: false });
  await waitFor(() => expect(view.result.current.page).toBe(initial));
  const localId = "pending-on-this-device";
  for (const mixed of [true, false]) {
    const pane = viewport(mixed ? [localId, root.id] : [localId]);
    pane.querySelector("article")?.setAttribute("data-outgoing", "");
    view.result.current.viewport.current = pane;
    native.readChannelWindow.mockClear();
    await act(async () => native.notify(channelId));
    expect(
      native.readChannelWindow.mock.calls.map(([q]) =>
        q.kind === "around" ? q.postId : q.kind,
      ),
    ).toEqual([mixed ? root.id : "latest"]);
    expect(view.result.current.page).toBe(initial);
    expect(view.result.current.status).toBe("offline");
  }
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
});

test("an edge of an older slice retains the next visible surviving post; losing every row requires explicit navigation", async () => {
  const native = account();
  const before = page(root, old),
    kept = page(old);
  native.readChannelWindow.mockResolvedValue(before);
  const view = open(native, { online: false });
  await waitFor(() => expect(view.result.current.page).toBe(before));
  view.result.current.viewport.current = viewport([root.id, old.id], true);
  native.readChannelWindow
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(kept);
  await act(async () => native.notify(channelId));
  expect(view.result.current.page).toBe(kept);
  view.rerender({ online: true });
  expect(view.result.current.page).toBe(kept);
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
  view.rerender({ online: false });
  expect(
    native.readChannelWindow.mock.calls
      .slice(-2)
      .map(([q]) => q.kind === "around" && q.postId),
  ).toEqual([root.id, old.id]);
  view.result.current.viewport.current = viewport([old.id]);
  native.readChannelWindow.mockResolvedValue(null);
  await act(async () => native.notify(channelId));
  expect(view.result.current.status).toBe("positionLost");
  expect(view.result.current.page).toBeNull();
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
  const latest = end(newer);
  native.readChannelWindow.mockResolvedValue(latest);
  await act(async () => view.result.current.showLatest());
  expect(view.result.current.page).toBe(latest);
  expect(native.readChannelWindow.mock.calls.at(-1)?.[0].kind).toBe("latest");
});

test("a scroll while SQLite is reading picks the new visible anchor and ignores an old session error after navigation", async () => {
  const native = account();
  const original = end(root, old),
    next = page(old);
  native.readChannelWindow.mockResolvedValue(original);
  const view = open(native);
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  const slow = deferred<LocalChannelWindow>();
  view.result.current.viewport.current = viewport([root.id]);
  native.readChannelWindow
    .mockImplementationOnce(() => slow.promise)
    .mockResolvedValue(next);
  act(() => native.notify(channelId));
  view.result.current.viewport.current = viewport([old.id]);
  await act(async () => slow.resolve(original));
  expect(view.result.current.page).toBe(next);
  expect(native.readChannelWindow.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "around",
    postId: old.id,
  });
  const late = deferred<LocalChannelWindow>();
  native.readChannelWindow.mockImplementationOnce(() => late.promise);
  act(() => native.notify(channelId));
  view.rerender({ channelId: newer.channelId.replaceAll("c", "z") });
  await act(async () => late.reject("session_unavailable"));
  expect(view.ended).not.toHaveBeenCalled();
  const calls = native.readChannelWindow.mock.calls.length;
  view.unmount();
  native.notify(channelId);
  expect(native.readChannelWindow).toHaveBeenCalledTimes(calls);
});

test("retrying an unavailable local store keeps the same reading position and uses only SQLite", async () => {
  const native = account();
  const original = end(root);
  native.readChannelWindow.mockResolvedValue(original);
  const view = open(native, { online: false });
  await waitFor(() => expect(view.result.current.page).toBe(original));
  view.result.current.viewport.current = viewport([root.id]);
  native.readChannelWindow.mockRejectedValueOnce("history_storage_unavailable");
  await act(async () => native.notify(channelId));
  expect(view.result.current.notice).toBe("storage");
  expect(view.result.current.page).toBe(original);
  await act(async () => view.result.current.retry());
  expect(view.result.current.notice).toBeNull();
  expect(native.readChannelWindow.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "around",
    postId: root.id,
  });
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
});
