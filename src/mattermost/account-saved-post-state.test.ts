// @vitest-environment node
import { invoke } from "@tauri-apps/api/core";
import { expect, test, vi } from "vitest";
import {
  openPostCollection,
  returnedPostRemoved,
} from "../channels/post-collection.ts";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const server = "https://example.test/sub";
const first = "p".repeat(26);
const second = "q".repeat(26);
const third = "r".repeat(26);
const owner = "u".repeat(26);
const otherOwner = "v".repeat(26);
const preferences = `${server}/api/v4/users/me/preferences`;
const deletion = `${preferences}/delete`;
const flagged = (offset = 0) =>
  `${server}/api/v4/users/me/posts/flagged?page=${offset}&per_page=60`;
const postIds = (count: number) =>
  Array.from({ length: count }, (_, n) => String(n).padStart(26, "g"));

function page(...ids: string[]) {
  return {
    order: ids,
    posts: Object.fromEntries(
      ids.map((id) => [id, { id, channel_id: "c".repeat(26) }]),
    ),
    first_inaccessible_post_time: 0,
  };
}

function visible(collection: ReturnType<typeof openPostCollection>) {
  return collection.getSnapshot().value?.items.map(({ id }) => id);
}

function flags(userId: string, ...ids: string[]) {
  return ids.map((name) => ({
    user_id: userId,
    category: "flagged_post",
    name,
    value: "true",
  }));
}

type Reply = { body?: unknown; status?: number; failure?: string };
type Request = {
  method: string;
  url: string;
  connection: number;
  body?: string;
};

function fixture() {
  const requests: Request[] = [];
  const handlers: Array<{
    method: string;
    url: string;
    answer: (request: Request) => Promise<Reply>;
  }> = [];
  const bodies = new Map<number, ArrayBuffer>();
  let next = 0;
  let prepareFailure: string | undefined;
  let acceptDirectory = true;
  const ipc = vi.mocked(invoke);
  ipc.mockReset();
  ipc.mockImplementation(async (command, input) => {
    const args = input as Record<string, unknown>;
    switch (command) {
      case "open_rest_connection":
        return args.userId === owner ? 41 : 42;
      case "close_rest_connection":
      case "cancel_team_directory_load":
        return undefined;
      case "begin_team_directory_load":
        return ++next;
      case "store_team_directory":
        expect(args.preferences).not.toHaveProperty("ids");
        return acceptDirectory;
      case "prepare_rest_request":
        if (prepareFailure) {
          const cause = prepareFailure;
          prepareFailure = undefined;
          throw cause;
        }
        return ++next;
      case "cancel_rest_request":
        bodies.delete(Number(args.exchange));
        return;
      case "send_rest_request": {
        const request = {
          method: String(args.method),
          url: String(args.url),
          connection: Number(args.connection),
          body: typeof args.body === "string" ? args.body : undefined,
        };
        requests.push(request);
        const match = handlers.findIndex(
          (handler) =>
            handler.method === request.method && handler.url === request.url,
        );
        if (match < 0) {
          if (
            request.url === `${server}/api/v4/users/me/teams` ||
            request.url === `${server}/api/v4/users/me/teams/members`
          ) {
            bodies.set(
              Number(args.exchange),
              new TextEncoder().encode("[]").buffer,
            );
            return { status: 200, headers: [], hasBody: true };
          }
          throw new Error(
            `Unexpected request ${request.method} ${request.url}`,
          );
        }
        const [handler] = handlers.splice(match, 1);
        const { body, status = 200, failure } = await handler.answer(request);
        if (failure) throw failure;
        if (body !== undefined)
          bodies.set(
            Number(args.exchange),
            new TextEncoder().encode(JSON.stringify(body)).buffer,
          );
        return { status, headers: [], hasBody: body !== undefined };
      }
      case "read_rest_body": {
        const key = Number(args.exchange);
        const body = bodies.get(key);
        bodies.delete(key);
        return body ?? new ArrayBuffer(0);
      }
      default:
        throw new Error(`Unexpected IPC ${command}`);
    }
  });
  function hold(method: string, url = preferences) {
    let received!: (request: Request) => void;
    let respond!: (response: Reply) => void;
    const started = new Promise<Request>((resolve) => {
      received = resolve;
    });
    const answer = new Promise<Reply>((resolve) => {
      respond = resolve;
    });
    handlers.push({
      method,
      url,
      answer(request) {
        received(request);
        return answer;
      },
    });
    return { started, respond };
  }
  return {
    hold,
    requests,
    ipc,
    open: (user = owner) => openAccountRestConnection(server, user),
    read(...ids: string[]) {
      hold("GET").respond({ body: flags(owner, ...ids) });
    },
    failPrepare(cause: string) {
      prepareFailure = cause;
    },
    rejectDirectory() {
      acceptDirectory = false;
    },
  };
}

test("accepted directory and Saved reads populate one account without per-post requests", async () => {
  const device = fixture();
  const account = await device.open();
  const listener = vi.fn();
  const stop = account.subscribeToSavedPostState(listener);
  expect(account.getSavedPostState(first)).toBeUndefined();
  device.read(first);
  await expect(account.refreshJoinedTeams()).resolves.toBe(true);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(account.getSavedPostState(first)).toBe(true);
  expect(account.getSavedPostState(second)).toBe(false);
  for (let n = 0; n < 100; n++)
    expect(account.getSavedPostState(String(n).padStart(26, "a"))).toBe(false);
  expect(device.requests.filter(({ url }) => url === preferences)).toHaveLength(
    1,
  );

  device.rejectDirectory();
  device.read(second);
  await expect(account.refreshJoinedTeams()).resolves.toBe(false);
  expect(account.getSavedPostState(first)).toBe(true);
  expect(listener).toHaveBeenCalledTimes(4);
  stop();
  device.read();
  await expect(account.readSavedPostPreferences()).resolves.toEqual({
    ids: new Set(),
    upperBound: 0,
  });
  expect(account.getSavedPostState(first)).toBe(false);
  expect(listener).toHaveBeenCalledTimes(4);
});

test("presentation observes read lifecycle and preserves known per-post states", async () => {
  const device = fixture();
  const account = await device.open();
  const presented = () => account.getSavedPostPresentation(first);
  const changes = vi.fn(presented);
  account.subscribeToSavedPostState(changes);
  expect(presented()).toBe("loading");
  expect(device.requests).toEqual([]);
  await expect(
    account.readSavedPostPreferences(AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(presented()).toBe("loading");
  expect(device.requests).toEqual([]);
  const cancelled = device.hold("GET");
  const controller = new AbortController();
  const abandoning = account.readSavedPostPreferences(controller.signal);
  await cancelled.started;
  controller.abort();
  await expect(abandoning).rejects.toMatchObject({
    name: "FetchError",
    cause: { name: "AbortError" },
  });
  cancelled.respond({ body: [] });
  expect(presented()).toBe("loading");
  expect(device.requests.filter(({ method }) => method !== "GET")).toEqual([]);
  const older = device.hold("GET");
  const late = account.readSavedPostPreferences();
  await older.started;
  expect(presented()).toBe("loading");
  device.hold("GET").respond({ status: 403 });
  await expect(account.refreshJoinedTeams()).rejects.toThrow();
  expect(presented()).toBe("read-refused");
  expect(account.getSavedPostState(first)).toBeUndefined();
  older.respond({ failure: "network" });
  await expect(late).rejects.toThrow();
  expect(presented()).toBe("read-refused");
  device.hold("GET").respond({ status: 503 });
  await expect(account.readSavedPostPreferences()).rejects.toThrow();
  expect(presented()).toBe("read-failed");
  expect(account.getSavedPostState(first)).toBeUndefined();

  device.read(first);
  await account.readSavedPostPreferences();
  expect(presented()).toBe("saved");
  expect(account.getSavedPostPresentation(second)).toBe("unsaved");
  device.hold("GET").respond({ status: 401 });
  await expect(account.readSavedPostPreferences()).rejects.toThrow();
  expect(presented()).toBe("saved");
  expect(account.getSavedPostPresentation(second)).toBe("unsaved");

  const deleting = device.hold("POST", deletion);
  const remove = account.setPostSaved(first, false);
  await deleting.started;
  expect(presented()).toBe("removing");
  deleting.respond({ failure: "network" });
  await expect(remove).rejects.toThrow();
  expect(presented()).toBe("unconfirmed");
  expect(account.getSavedPostPresentation(second)).toBe("unsaved");

  const adding = device.hold("PUT");
  const save = account.setPostSaved(second, true);
  await adding.started;
  expect(account.getSavedPostPresentation(second)).toBe("saving");
  adding.respond({ body: { status: "OK" } });
  await save;
  expect(account.getSavedPostPresentation(second)).toBe("saved");
  expect(changes.mock.results.map(({ value }) => value)).toContain(
    "read-refused",
  );
  expect(changes.mock.results.map(({ value }) => value)).toContain(
    "read-failed",
  );
});

test("two different post writes survive an older read, with a later accepted read superseding it", async () => {
  const device = fixture();
  const account = await device.open();
  device.read(second);
  await account.refreshJoinedTeams();
  const old = device.hold("GET");
  const pending = account.readSavedPostPreferences();
  await old.started;

  const add = device.hold("PUT");
  const remove = device.hold("POST", deletion);
  const adding = account.setPostSaved(first, true);
  const removing = account.setPostSaved(second, false);
  const bodies = await Promise.all([add.started, remove.started]);
  expect(bodies.map(({ body }) => JSON.parse(String(body)))).toEqual([
    flags(owner, first),
    flags(owner, second),
  ]);
  expect(account.isSavedPostPending(first)).toBe(true);
  expect(account.isSavedPostPending(second)).toBe(true);
  remove.respond({ body: { status: "OK" } });
  await removing;
  expect(account.isSavedPostPending(first)).toBe(true);
  expect(account.isSavedPostPending(second)).toBe(false);
  add.respond({ body: { status: "OK" } });
  await adding;
  expect(account.isSavedPostPending(first)).toBe(false);
  old.respond({ body: flags(owner, second) });
  await expect(pending).resolves.toEqual({
    ids: new Set([second]),
    upperBound: 1,
  });
  expect(account.getSavedPostState(first)).toBe(true);
  expect(account.getSavedPostState(second)).toBe(false);

  const older = device.hold("GET");
  const delayed = account.readSavedPostPreferences();
  await older.started;
  device.read(first, second);
  await account.refreshJoinedTeams();
  older.respond({ body: [] });
  await delayed;
  expect(account.getSavedPostState(first)).toBe(true);
  expect(account.getSavedPostState(second)).toBe(true);
  expect(device.requests.filter(({ method }) => method !== "GET")).toHaveLength(
    2,
  );
});

test("a direct change and removal from Saved share one in-flight write for the same ID", async () => {
  const device = fixture();
  const account = await device.open();
  const collection = openPostCollection(account, { kind: "all" });
  device.read(first);
  device.hold("GET", flagged()).respond({ body: page(first) });
  await collection.refresh();
  expect(visible(collection)).toEqual([first]);
  const pending: boolean[] = [];
  account.subscribeToSavedPostState(() =>
    pending.push(account.isSavedPostPending(first)),
  );

  const remove = device.hold("POST", deletion);
  const direct = account.setPostSaved(first, false);
  expect(account.isSavedPostPending(first)).toBe(true);
  expect(account.isSavedPostPending(second)).toBe(false);
  await remove.started;
  const fromSaved = collection.remove(first);
  await expect(account.setPostSaved(first, true)).rejects.toMatchObject({
    name: "SavedPostWritePending",
  });
  expect(collection.getSnapshot().removing).toEqual([first]);
  expect(collection.getSnapshot().value?.items).toHaveLength(1);
  expect(account.getSavedPostState(first)).toBe(true);
  expect(device.requests.filter(({ method }) => method !== "GET")).toHaveLength(
    1,
  );

  remove.respond({ body: { status: "OK" } });
  await direct;
  await expect(fromSaved).resolves.toBe("removed");
  expect(collection.getSnapshot().value?.items).toEqual([]);
  expect(account.getSavedPostState(first)).toBe(false);
  expect(pending).toEqual([true, true, false]);
  expect(device.requests.filter(({ method }) => method !== "GET")).toHaveLength(
    1,
  );
});

test("a shared confirmed removal overrides both old GETs, and a fresh page can show the post again", async () => {
  const device = fixture();
  const account = await device.open();
  const collection = openPostCollection(account, { kind: "all" });
  const oldFlags = device.hold("GET");
  const oldPage = device.hold("GET", flagged());
  const returned = collection.refresh(first);
  await Promise.all([oldFlags.started, oldPage.started]);
  device.hold("POST", deletion).respond({ body: { status: "OK" } });
  await account.setPostSaved(first, false);
  oldFlags.respond({
    body: flags(
      owner,
      first,
      second,
      ...Array.from({ length: 118 }, (_, n) => String(n).padStart(26, "g")),
    ),
  });
  oldPage.respond({ body: page(first, second) });
  await returned;
  expect(collection.getSnapshot()).toMatchObject({
    status: "ready",
    returnedPost: { id: first, saved: false },
    continuation: "available",
  });
  expect(account.getSavedPostState(first)).toBe(false);
  expect(visible(collection)).toEqual([second]);

  device.hold("GET", flagged(59)).respond({ body: page(second, third) });
  await collection.loadMore();
  expect(visible(collection)).toEqual([second, third]);
  expect(collection.getSnapshot().continuation).toBe("available");
  device.hold("GET", flagged(119)).respond({ body: page() });
  await collection.loadMore();
  expect(collection.getSnapshot().continuation).toBe("none");

  // No new local removal: two independent GETs can disagree after a re-save.
  device.read(second);
  device.hold("GET", flagged()).respond({ body: page(first, second) });
  await collection.refresh(first);
  expect(visible(collection)).toEqual([first, second]);
  device.read(first, second);
  device.hold("GET", flagged()).respond({ body: page(first, second) });
  await collection.refresh(first);
  expect(collection.getSnapshot().returnedPost).toEqual({
    id: first,
    saved: true,
  });
});

test("an insertion seen by the page cannot strand row 61 behind a stale count of 60", async () => {
  const device = fixture();
  const account = await device.open();
  const collection = openPostCollection(account, { kind: "all" });
  collection.setVisible(true);
  const prior = postIds(60);
  const oldFlags = device.hold("GET");
  const concurrentPage = device.hold("GET", flagged());
  const reading = collection.refresh(first);
  await Promise.all([oldFlags.started, concurrentPage.started]);
  device.hold("PUT").respond({ body: { status: "OK" } });
  await account.setPostSaved(first, true);
  oldFlags.respond({ body: flags(owner, ...prior) });
  concurrentPage.respond({ body: page(first, ...prior.slice(0, 59)) });
  await reading;
  expect(account.getSavedPostUpperBound()).toBe(61);
  expect(collection.getSnapshot().continuation).toBe("available");
  expect(visible(collection)).toHaveLength(60);
  device.hold("GET", flagged(60)).respond({ body: page(prior[59]) });
  await collection.loadMore();
  expect(visible(collection)).toEqual([first, ...prior]);
  expect(collection.getSnapshot().continuation).toBe("none");
  expect(device.requests.filter(({ url }) => url === preferences)).toHaveLength(
    2,
  );
});

test("the returned hint follows a newer accepted read without deriving the raw bound from visible IDs", async () => {
  const device = fixture();
  const account = await device.open();
  const collection = openPostCollection(account, { kind: "all" });
  const prior = postIds(60);
  const older = device.hold("GET");
  const initial = device.hold("GET", flagged());
  const returning = collection.refresh(first);
  await Promise.all([older.started, initial.started]);
  device.read(...prior, first);
  await account.readSavedPostPreferences();
  older.respond({ body: flags(owner, ...prior) });
  initial.respond({ body: page(...prior) });
  await returning;
  expect(collection.getSnapshot().returnedPost).toEqual({
    id: first,
    saved: true,
  });
  expect(returnedPostRemoved(collection.getSnapshot(), first, 10)).toBe(false);
  expect(collection.getSnapshot().continuation).toBe("available");
  device.hold("GET", flagged(60)).respond({ body: page(first) });
  await collection.loadMore();
  expect(visible(collection)?.at(-1)).toBe(first);
  expect(collection.getSnapshot().continuation).toBe("none");
});

test.each(["ok", "filtered", "network", "forbidden"] as const)(
  "automatic refresh preserves the loaded raw depth and handles a deeper %s response",
  async (outcome) => {
    const device = fixture();
    const account = await device.open();
    const collection = openPostCollection(account, { kind: "all" });
    collection.setVisible(true);
    const prior = postIds(130);
    const anchor = prior[119];
    device.read(...prior);
    device
      .hold("GET", flagged())
      .respond({ body: page(...prior.slice(0, 60)) });
    await collection.refresh(anchor);
    device
      .hold("GET", flagged(60))
      .respond({ body: page(...prior.slice(60, 120)) });
    await collection.loadMore();
    const before = visible(collection);
    expect(before).toEqual(prior.slice(0, 120));

    const current = [first, ...prior];
    device.read(...current);
    device
      .hold("GET", flagged())
      .respond({ body: page(...current.slice(0, 60)) });
    device
      .hold("GET", flagged(60))
      .respond({ body: page(...current.slice(60, 120)) });
    const tail = device.hold("GET", flagged(61));
    device.hold("PUT").respond({ body: { status: "OK" } });
    await account.setPostSaved(first, true);
    const refreshing = collection.refresh();
    await tail.started;
    expect(collection.getSnapshot().status).toBe("refreshing");
    expect(visible(collection)).toEqual(before);
    if (outcome === "ok")
      tail.respond({ body: page(...current.slice(61, 121)) });
    else if (outcome === "filtered") tail.respond({ body: page() });
    else if (outcome === "network") tail.respond({ failure: "network" });
    else tail.respond({ status: 403 });
    await refreshing;
    if (outcome === "ok") {
      expect(visible(collection)).toEqual(current.slice(0, 121));
      expect(collection.getSnapshot().returnedPost).toEqual({
        id: anchor,
        saved: true,
      });
      device
        .hold("GET", flagged(121))
        .respond({ body: page(...current.slice(121)) });
      await collection.loadMore();
      expect(visible(collection)).toEqual(current);
    } else if (outcome === "filtered") {
      expect(visible(collection)).toEqual(current.slice(0, 120));
      expect(visible(collection)).not.toContain(anchor);
      expect(account.getSavedPostState(anchor)).toBe(true);
      expect(collection.getSnapshot().continuation).toBe("available");
    } else {
      expect(collection.getSnapshot().status).toBe(outcome);
      expect(visible(collection)).toEqual(
        outcome === "network" ? before : undefined,
      );
    }
  },
);

test("confirmed save overrides an old missing return flag without supplying post contents", async () => {
  const device = fixture();
  const account = await device.open();
  const collection = openPostCollection(account, { kind: "all" });
  const flags = device.hold("GET");
  const initial = device.hold("GET", flagged());
  const reading = collection.refresh(first);
  await Promise.all([flags.started, initial.started]);
  device.hold("PUT").respond({ body: { status: "OK" } });
  await account.setPostSaved(first, true);
  flags.respond({ body: [] });
  initial.respond({ body: page() });
  await reading;
  expect(collection.getSnapshot()).toMatchObject({
    status: "ready",
    returnedPost: { id: first, saved: true },
  });
  expect(visible(collection)).toEqual([]);
  expect(account.getSavedPostState(first)).toBe(true);
  expect(device.requests).toHaveLength(3);
});

test.each([true, false])(
  "the open returned list refreshes through its ordinary read after a confirmed save (still saved: %s)",
  async (stillSaved) => {
    const device = fixture();
    const account = await device.open();
    const collection = openPostCollection(account, { kind: "all" });
    const changes = vi.fn(collection.getSnapshot);
    collection.subscribe(changes);
    collection.setVisible(true);
    const oldFlags = device.hold("GET");
    const oldPage = device.hold("GET", flagged());
    const reading = collection.refresh(first);
    await Promise.all([oldFlags.started, oldPage.started]);
    device.hold("PUT").respond({ body: { status: "OK" } });
    await account.setPostSaved(first, true);
    expect(device.requests).toHaveLength(3);
    const freshFlags = device.hold("GET");
    const freshPage = device.hold("GET", flagged());
    oldFlags.respond({ body: [] });
    oldPage.respond({ body: page() });
    await Promise.all([freshFlags.started, freshPage.started]);
    expect(collection.getSnapshot()).toMatchObject({
      status: "refreshing",
      returnedPost: { id: first, saved: true },
    });
    expect(visible(collection)).toEqual([]);
    freshFlags.respond({ body: stillSaved ? flags(owner, first) : [] });
    freshPage.respond({ body: stillSaved ? page(first) : page() });
    await reading;
    expect(collection.getSnapshot()).toMatchObject({
      status: "ready",
      returnedPost: { id: first, saved: stillSaved },
    });
    expect(account.getSavedPostState(first)).toBe(stillSaved);
    expect(visible(collection)).toEqual(stillSaved ? [first] : []);
    expect(device.requests).toHaveLength(5);
    expect(
      changes.mock.results
        .map(({ value }) => value)
        .filter(({ status }) => status === "ready"),
    ).toEqual([collection.getSnapshot()]);
  },
);

test("a confirmed save refreshes only a displayed list and a hidden list reads once on return", async () => {
  const device = fixture();
  const account = await device.open();
  const [open, hidden, suspended, closed] = Array.from({ length: 4 }, () =>
    openPostCollection(account, { kind: "all" }),
  );
  for (const view of [open, hidden, suspended, closed]) {
    view.subscribe(vi.fn());
    view.setVisible(true);
    device.read(first);
    device.hold("GET", flagged()).respond({ body: page(first) });
    await view.refresh();
  }
  hidden.setVisible(false);
  suspended.suspend();
  closed.close();
  const nextFlags = device.hold("GET");
  const nextPage = device.hold("GET", flagged());
  device.hold("PUT").respond({ body: { status: "OK" } });
  await account.setPostSaved(second, true);
  await Promise.all([nextFlags.started, nextPage.started]);
  expect(visible(open)).toEqual([first]);
  expect(visible(hidden)).toEqual([first]);
  expect(visible(suspended)).toEqual([first]);
  expect(closed.getSnapshot().status).toBe("closed");
  nextFlags.respond({ body: flags(owner, first, second) });
  nextPage.respond({ body: page(first, second) });
  await open.refresh();
  expect(visible(open)).toEqual([first, second]);
  expect(visible(hidden)).toEqual([first]);
  expect(device.requests).toHaveLength(11);

  const returnedFlags = device.hold("GET");
  const returnedPage = device.hold("GET", flagged());
  hidden.setVisible(true);
  suspended.setVisible(true);
  await Promise.all([returnedFlags.started, returnedPage.started]);
  returnedFlags.respond({ body: flags(owner, first, second) });
  returnedPage.respond({ body: page(first, second) });
  await hidden.refresh();
  expect(visible(hidden)).toEqual([first, second]);
  expect(visible(suspended)).toEqual([first]);
  expect(device.requests).toHaveLength(13);
});

test("an open second collection follows confirmed removals and corrects interrupted raw pages", async () => {
  const device = fixture();
  const account = await device.open();
  const left = openPostCollection(account, { kind: "all" });
  const right = openPostCollection(account, { kind: "all" });
  const hidden = Array.from({ length: 58 }, (_, n) =>
    String(n).padStart(26, "g"),
  );
  for (const view of [left, right]) {
    device.read(first, second, third, ...hidden);
    device.hold("GET", flagged()).respond({ body: page(first, second) });
    await view.refresh(first);
  }

  const stale = device.hold("GET", flagged(60));
  const continuation = right.loadMore();
  await stale.started;
  const refused = device.hold("POST", deletion);
  const attempt = left.remove(first);
  await refused.started;
  expect(visible(left)).toEqual([first, second]);
  expect(visible(right)).toEqual([first, second]);
  refused.respond({ status: 403 });
  await expect(attempt).resolves.toBe("refused");
  expect(right.getSnapshot().continuation).toBe("loading");
  expect(visible(right)).toEqual([first, second]);

  device.hold("POST", deletion).respond({ failure: "network" });
  await expect(left.remove(first)).resolves.toBe("network");
  expect(account.getSavedPostState(first)).toBeUndefined();
  expect(right.getSnapshot().continuation).toBe("loading");
  expect(visible(left)).toEqual([first, second]);
  expect(visible(right)).toEqual([first, second]);

  device.hold("POST", deletion).respond({ body: { status: "OK" } });
  await expect(left.remove(first)).resolves.toBe("removed");
  await continuation;
  stale.respond({ body: page(first, third) });
  for (const view of [left, right]) {
    expect(visible(view)).toEqual([second]);
    expect(view.getSnapshot().returnedPost).toEqual({
      id: first,
      saved: false,
    });
  }

  const secondPage = device.hold("GET", flagged(59));
  const more = right.loadMore();
  await secondPage.started;
  device.hold("POST", deletion).respond({ body: { status: "OK" } });
  await account.setPostSaved(third, false);
  await more;
  secondPage.respond({ body: page(third) });
  expect(visible(right)).toEqual([second]);

  device.hold("GET", flagged(58)).respond({ failure: "network" });
  await right.loadMore();
  expect(right.getSnapshot().continuation).toBe("network");
  expect(visible(right)).toEqual([second]);
  device.hold("GET", flagged(58)).respond({ body: page(second) });
  await right.loadMore();
  expect(right.getSnapshot().continuation).toBe("none");
  expect(visible(right)).toEqual([second]);
  expect(
    device.requests
      .map(({ url }) => new URL(url))
      .filter(({ pathname }) => pathname.endsWith("/posts/flagged"))
      .map(({ searchParams }) => Number(searchParams.get("page"))),
  ).toEqual([0, 0, 60, 59, 58, 58]);
  expect(device.requests.filter(({ url }) => url === preferences)).toHaveLength(
    2,
  );

  const onClose = vi.fn();
  right.subscribe(onClose);
  right.close();
  device.hold("POST", deletion).respond({ body: { status: "OK" } });
  await expect(left.remove(second)).resolves.toBe("removed");
  expect(visible(left)).toEqual([]);
  expect(right.getSnapshot()).toMatchObject({ status: "closed", value: null });
  expect(onClose).toHaveBeenCalledOnce();
});

test("known refusal preserves a flag, while an ambiguous write only invalidates its own ID", async () => {
  const device = fixture();
  const account = await device.open();
  device.read(first, second);
  await account.readSavedPostPreferences();
  device.hold("POST", deletion).respond({ status: 403 });
  await expect(account.setPostSaved(first, false)).rejects.toMatchObject({
    response: { status: 403 },
  });
  device.failPrepare("network");
  await expect(account.setPostSaved(first, false)).rejects.toThrow();
  await expect(
    account.setPostSaved(first, false, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(account.getSavedPostState(first)).toBe(true);
  expect(
    device.requests.filter(({ method }) => method === "POST"),
  ).toHaveLength(1);

  const write = device.hold("POST", deletion);
  const removing = account.setPostSaved(first, false);
  await write.started;
  const overlapping = device.hold("GET");
  const read = account.readSavedPostPreferences();
  await overlapping.started;
  write.respond({ failure: "network" });
  await expect(removing).rejects.toThrow();
  overlapping.respond({ body: flags(owner, first, second) });
  await read;
  expect(account.getSavedPostState(first)).toBeUndefined();
  expect(account.getSavedPostState(second)).toBe(true);
  device.hold("GET").respond({ failure: "network" });
  await expect(account.readSavedPostPreferences()).rejects.toThrow();
  expect(account.getSavedPostState(first)).toBeUndefined();
  expect(account.getSavedPostState(second)).toBe(true);
  device.read(second);
  await account.readSavedPostPreferences();
  expect(account.getSavedPostState(first)).toBe(false);
  expect(account.getSavedPostState(second)).toBe(true);
  expect(
    device.requests.filter(({ method }) => method === "POST"),
  ).toHaveLength(2);
});

test("abort after native submission or a malformed acknowledgement leaves only the written ID unknown", async () => {
  const device = fixture();
  const account = await device.open();
  device.read(first, second);
  await account.readSavedPostPreferences();
  device.hold("POST", deletion).respond({ failure: "operation_denied" });
  await expect(account.setPostSaved(first, false)).rejects.toThrow();
  expect(account.getSavedPostState(first)).toBe(true);

  const write = device.hold("POST", deletion);
  const controller = new AbortController();
  const removing = account.setPostSaved(first, false, controller.signal);
  await write.started;
  controller.abort();
  await expect(removing).rejects.toMatchObject({
    name: "FetchError",
    cause: { name: "AbortError" },
  });
  write.respond({ body: { status: "OK" } });
  expect(account.getSavedPostState(first)).toBeUndefined();
  expect(account.getSavedPostState(second)).toBe(true);
  expect(
    device.ipc.mock.calls.some(([cmd]) => cmd === "cancel_rest_request"),
  ).toBe(true);

  device.hold("POST", deletion).respond({ body: { status: "unexpected" } });
  await expect(account.setPostSaved(second, false)).rejects.toThrow();
  expect(account.getSavedPostState(second)).toBeUndefined();
});

test("closing an account retires reads, writes and subscribers while another account has its own state", async () => {
  const device = fixture();
  const account = await device.open();
  const other = await device.open(otherOwner);
  const listener = vi.fn();
  const confirmation = vi.fn();
  account.subscribeToSavedPostState(listener);
  account.subscribeToSavedPostWrites(confirmation);
  device.read(first);
  await account.readSavedPostPreferences();
  expect(other.getSavedPostState(first)).toBeUndefined();
  const read = device.hold("GET");
  const remove = device.hold("POST", deletion);
  const reading = account.readSavedPostPreferences();
  const removing = account.setPostSaved(second, false);
  await Promise.all([read.started, remove.started]);
  expect(account.isSavedPostPending(second)).toBe(true);
  expect(other.isSavedPostPending(second)).toBe(false);
  await account.close();
  expect(account.isSavedPostPending(second)).toBe(false);
  device.hold("GET").respond({ body: flags(otherOwner, second) });
  await other.readSavedPostPreferences();
  read.respond({ body: flags(owner, first) });
  remove.respond({ body: { status: "OK" } });
  await expect(reading).rejects.toBe("cancelled");
  await expect(removing).rejects.toBe("cancelled");
  expect(listener).toHaveBeenCalledTimes(4);
  expect(confirmation).not.toHaveBeenCalled();
  expect(account.getSavedPostState(first)).toBeUndefined();
  expect(account.getSavedPostState(second)).toBeUndefined();
  expect(other.getSavedPostState(first)).toBe(false);
  expect(other.getSavedPostState(second)).toBe(true);
});
