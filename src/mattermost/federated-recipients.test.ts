import { expect, test, vi } from "vitest";
import {
  Configuration,
  ResponseError,
  SharedChannelsApi,
} from "../../vendor/mattermost/index.js";
import {
  type RecipientPage,
  readConversationRecipients,
} from "./conversation-recipients.ts";

function gate<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const id = (n: number) => n.toString().padStart(26, "0");
const makeUser = (n: number, remote = false) => ({
  id: id(n),
  username: `member${n}`,
  delete_at: 0,
  ...(remote && { remote_id: id(1001) }),
});
const rows = [
  makeUser(10, true),
  makeUser(1, true),
  makeUser(11, true),
  makeUser(2),
];
const ids = (result: RecipientPage) => result.profiles.map((p) => p.id);
const team = id(1000);
const basePath = "https://chat.example.test/sub";
function page(
  config: Configuration,
  enabled: boolean | undefined,
  signal?: AbortSignal,
  early?: (page: RecipientPage) => void,
) {
  return readConversationRecipients(
    config,
    id(1),
    team,
    { kind: "page", page: 0 },
    async () => ({ dmRecipientScope: "team", sharedChannelDMs: enabled }),
    signal,
    early,
  );
}

test.each([
  [false, "12.1.0", undefined, [1, 2], 0],
  [undefined, "10.10.1", undefined, [1, 2], 0],
  [true, "10.10.1.123.hash.false", undefined, [10, 1, 11, 2], 0],
  [true, "10.11.0", undefined, [1, 11, 2], 2],
  [true, "12.1.0", undefined, [1, 11, 2], 2],
  [true, undefined, undefined, [1, 11, 2], 2],
  [true, "unknown", undefined, [1, 11, 2], 2],
  [true, "10.10.1.", undefined, [1, 11, 2], 2],
  [true, "10.10.1", "max-age=60", [1, 11, 2], 2],
  [true, "10.10.1", "", [1, 11, 2], 2],
] as const)(
  "uses shared DMs %s, version %s, cache %s",
  async (enabled, version, cache, visible, calls) => {
    const seen: string[] = [];
    const early = vi.fn();
    const fetchApi = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/users")) {
        const headers = new Headers();
        if (version) headers.set("x-version-id", version);
        if (cache !== undefined) headers.set("cache-control", cache);
        return Response.json(rows, { headers });
      }
      const peer = path.split("/").at(-1) ?? "";
      expect(path).toBe(`/sub/api/v4/sharedchannels/users/me/can_dm/${peer}`);
      seen.push(peer);
      return Response.json({ can_dm: peer === id(11) });
    });
    const result = await page(
      new Configuration({ basePath, fetchApi }),
      enabled,
      undefined,
      early,
    );
    expect(ids(result)).toEqual(visible.map(id));
    expect(seen).toHaveLength(calls);
    if (calls)
      expect(early.mock.calls.map(([p]) => ids(p))).toEqual([[id(1), id(2)]]);
    else expect(early).not.toHaveBeenCalled();
  },
);

test("limits 100 remote lookups to four, preserves server order and full-page pagination", async () => {
  const gates = new Map<string, () => void>();
  const start = gate();
  const all = Array.from({ length: 100 }, (_, n) => makeUser(n + 10, true));
  let active = 0,
    peak = 0;
  const seen: string[] = [];
  const pages: string[] = [];
  const config = new Configuration({
    basePath,
    fetchApi: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users")) {
        const requested = url.searchParams.get("page");
        expect(requested).toBe(pages.length.toString());
        pages.push(requested ?? "");
        return Response.json(requested === "0" ? all : [makeUser(110)]);
      }
      const peer = url.pathname.split("/").at(-1) ?? "";
      active++;
      peak = Math.max(peak, active);
      seen.push(peer);
      await new Promise<void>((resolve) => {
        gates.set(peer, resolve);
        if (gates.size === 4) start.resolve();
      });
      active--;
      return Response.json({ can_dm: Number(peer) % 2 === 1 });
    },
  });
  const early = vi.fn();
  const read = page(config, true, undefined, early);
  await start.promise;
  expect(early).toHaveBeenCalledOnce();
  expect(early.mock.calls[0][0]).toEqual({ profiles: [], nextPage: 1 });
  for (let remaining = 100; remaining > 0; ) {
    const current = [...gates.values()].reverse();
    expect(current.length).toBeGreaterThan(0);
    gates.clear();
    for (const resolve of current) resolve();
    remaining -= current.length;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  const result = await read;
  expect(seen).toEqual(all.map((p) => p.id));
  expect(peak).toBe(4);
  expect(ids(result)).toEqual(
    all.filter((p) => Number(p.id) % 2 === 1).map((p) => p.id),
  );
  expect(result.nextPage).toBe(1);
  const next = await readConversationRecipients(
    config,
    id(1),
    team,
    { kind: "page", page: result.nextPage ?? 0 },
    async () => ({ sharedChannelDMs: true }),
  );
  expect(ids(next)).toEqual([id(110)]);
  expect(next.nextPage).toBeNull();
  expect(pages).toEqual(["0", "1"]);
  expect(seen).toHaveLength(100);
});

test("returns local people while old search is in flight and discards superseded remote work", async () => {
  const loading = gate(),
    release = gate();
  const signals: AbortSignal[] = [];
  const rawRequests: string[] = [];
  const pageReady = vi.fn();
  const config = new Configuration({
    basePath,
    fetchApi: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/users/search")) {
        const term = JSON.parse(String(init?.body)).term;
        rawRequests.push(term);
        return Response.json(
          term === "old"
            ? [
                makeUser(1),
                ...Array.from({ length: 20 }, (_, n) => makeUser(n + 10, true)),
              ]
            : [makeUser(2)],
        );
      }
      if (init?.signal) signals.push(init.signal);
      if (signals.length === 4) loading.resolve();
      await release.promise;
      return Response.json({ can_dm: true });
    },
  });
  const abort = new AbortController();
  const fetchQuery = (term: string, signal?: AbortSignal) =>
    readConversationRecipients(
      config,
      id(1),
      team,
      { kind: "search", term },
      async () => ({ sharedChannelDMs: true }),
      signal,
      pageReady,
    );
  const old = fetchQuery("old", abort.signal);
  await loading.promise;
  expect(ids(pageReady.mock.calls[0][0])).toEqual([id(1)]);
  abort.abort("new search");
  const fresh = await fetchQuery("new");
  expect(ids(fresh)).toEqual([id(2)]);
  expect(signals.every((s) => s.aborted)).toBe(true);
  release.resolve();
  await expect(old).rejects.toBe("new search");
  expect(signals).toHaveLength(4);
  expect(rawRequests).toEqual(["old", "new"]);
  expect(pageReady).toHaveBeenCalledOnce();
});

test("hides a refusal and a network failure, but propagates expired sessions", async () => {
  const people = Array.from({ length: 4 }, (_, n) => makeUser(n + 10, true));
  for (const status of [404, 401]) {
    let aborted = 0;
    const config = new Configuration({
      basePath,
      fetchApi: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/users")) return Response.json(people);
        if (path.endsWith(id(10)))
          return Response.json({ id: "example" }, { status });
        if (path.endsWith(id(11))) throw new TypeError("No network");
        if (path.endsWith(id(12))) return Response.json({ can_dm: false });
        if (status === 401)
          await new Promise<void>((resolve) =>
            init?.signal?.addEventListener(
              "abort",
              () => {
                aborted++;
                resolve();
              },
              { once: true },
            ),
          );
        return Response.json({ can_dm: true });
      },
    });
    if (status === 404) expect(ids(await page(config, true))).toEqual([id(13)]);
    else {
      await expect(page(config, true)).rejects.toBeInstanceOf(ResponseError);
      expect(aborted).toBe(1);
    }
  }
});

test("a 401 stops the queue before a successful neighbor advances", async () => {
  const people = Array.from({ length: 20 }, (_, index) =>
    makeUser(index + 10, true),
  );
  const initial = gate();
  const refusal = gate<never>();
  const positive = gate<{ canDm: boolean }>();
  const expired = new ResponseError(new Response(null, { status: 401 }));
  const started: string[] = [];
  const canceled: string[] = [];
  const request = vi
    .spyOn(SharedChannelsApi.prototype, "canUserDirectMessage")
    .mockImplementation(({ otherUserId }, init) => {
      const signal = typeof init === "function" ? null : init?.signal;
      if (!signal) throw Error("Missing recipient check signal");
      started.push(otherUserId);
      if (started.length === 4) initial.resolve();
      if (otherUserId === id(10)) return refusal.promise;
      if (otherUserId === id(11)) return positive.promise;
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            canceled.push(otherUserId);
            reject(new Error("Neighbor canceled"));
          },
          { once: true },
        );
      });
    });
  try {
    const config = new Configuration({
      basePath,
      fetchApi: async () => Response.json(people),
    });
    const read = page(config, true);
    await initial.promise;
    const rejects = expect(read).rejects.toBe(expired);
    refusal.reject(expired);
    positive.resolve({ canDm: true });
    await rejects;
    expect(started).toEqual([10, 11, 12, 13].map(id));
    expect(canceled).toEqual([12, 13].map(id));
  } finally {
    request.mockRestore();
  }
});

test("a detached account stops the remaining recipient checks", async () => {
  const people = Array.from({ length: 20 }, (_, n) => makeUser(n + 10, true));
  let started = 0;
  const reached = gate(),
    release = gate();
  const config = new Configuration({
    basePath,
    fetchApi: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/users")) return Response.json(people);
      started++;
      if (started === 4) reached.resolve();
      await release.promise;
      throw new TypeError("Native REST request failed", {
        cause: "session_unavailable",
      });
    },
  });
  const read = page(config, true);
  await reached.promise;
  release.resolve();
  await expect(read).rejects.toMatchObject({
    cause: expect.objectContaining({ cause: "session_unavailable" }),
  });
  expect(started).toBe(4);
});
