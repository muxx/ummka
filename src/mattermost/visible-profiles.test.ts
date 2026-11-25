import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { loadVisibleProfiles } from "./visible-profiles.ts";

const id = (n: number) => String(n).padStart(26, "a");
const row = (n: number) => ({
  id: id(n),
  username: "user-" + n,
  position: "Engineer",
  email: "hidden@example.test",
});
type Reply = (
  path: string,
  keys: string[],
  signal: AbortSignal | null | undefined,
) => Response | Promise<Response>;
function fixture(reply: Reply) {
  const visits: { path: string; keys: string[] }[] = [];
  const config = new Configuration({
    basePath: "https://example.test/Team/chat",
    fetchApi: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const keys: string[] = JSON.parse(String(init?.body));
      expect(init?.method).toBe("POST");
      visits.push({ path, keys });
      return reply(path, keys, init?.signal);
    },
  });
  return { config, visits };
}

test("batches unique visible authors and resolves only still-missing names", async () => {
  const { config, visits } = fixture((path, keys) => {
    const numbers = keys.flatMap((k) => {
      if (k === "missing") return [];
      return [Number(k.replace(/^a+|^user-/u, ""))];
    });
    expect([
      "/Team/chat/api/v4/users/ids",
      "/Team/chat/api/v4/users/usernames",
    ]).toContain(path);
    return Response.json(numbers.reverse().map(row));
  });
  const ids = Array.from({ length: 101 }, (_, i) => id(i));
  const result = await loadVisibleProfiles(config, {
    ids: [...ids, id(1)],
    usernames: ["user-64", "user-123", "missing", "user-123"],
  });
  expect(visits).toEqual([
    { path: "/Team/chat/api/v4/users/ids", keys: ids.slice(0, 100) },
    { path: "/Team/chat/api/v4/users/ids", keys: [id(100)] },
    {
      path: "/Team/chat/api/v4/users/usernames",
      keys: ["user-123", "missing"],
    },
  ]);
  expect(new Set(result.map((p) => p.id))).toEqual(new Set([...ids, id(123)]));
  expect(result.some((p) => "email" in p)).toBe(false);
});

test("splits usernames too, makes no call for an empty query and rejects malformed keys before the first read", async () => {
  const { config, visits } = fixture(() => Response.json([]));
  expect(await loadVisibleProfiles(config, { ids: [], usernames: [] })).toEqual(
    [],
  );
  await expect(
    loadVisibleProfiles(config, { ids: [id(0)], usernames: [" "] }),
  ).rejects.toThrow(TypeError);
  await expect(
    loadVisibleProfiles(config, { ids: ["bad"], usernames: ["first"] }),
  ).rejects.toThrow(TypeError);
  expect(visits).toHaveLength(0);
  const names = Array.from({ length: 101 }, (_, i) => "user-" + i);
  expect(
    await loadVisibleProfiles(config, { ids: [], usernames: names }),
  ).toEqual([]);
  expect(visits.map((v) => v.keys.length)).toEqual([100, 1]);
});

test("rejects unrelated or repeated server identities and preserves a public response error", async () => {
  for (const [reply, query] of [
    [[row(1)], { ids: [id(2)], usernames: [] }],
    [[row(1), row(1)], { ids: [id(1)], usernames: [] }],
    [[row(1)], { ids: [], usernames: ["someone-else"] }],
    [
      [row(1), { ...row(1), username: "renamed" }],
      { ids: [], usernames: ["user-1", "renamed"] },
    ],
  ] as const) {
    const { config } = fixture(() => Response.json(reply));
    await expect(loadVisibleProfiles(config, query)).rejects.toThrow(
      "Unexpected identity",
    );
  }
  const { config } = fixture(() =>
    Response.json({ message: "private profile" }, { status: 403 }),
  );
  await expect(
    loadVisibleProfiles(config, { ids: [id(1)], usernames: [] }),
  ).rejects.toBeInstanceOf(ResponseError);
});

test("a rename between the two reads retains the newer version of the same identity", async () => {
  for (const [time, expected] of [
    [10, "new-name"],
    [8, "user-0"],
  ] as const) {
    const { config } = fixture((path) =>
      Response.json([
        path.endsWith("/ids")
          ? { ...row(0), update_at: 9 }
          : { ...row(0), username: "new-name", update_at: time },
      ]),
    );
    const result = await loadVisibleProfiles(config, {
      ids: [id(0)],
      usernames: ["new-name"],
    });
    expect(result.map((p) => p.username)).toEqual([expected]);
  }
});

test("cancels during a response without requesting the next batch or returning partial data", async () => {
  const controller = new AbortController();
  const reason = new Error("switched channel");
  const onAbort = vi.fn();
  const { config, visits } = fixture((_path, _keys, signal) => {
    signal?.addEventListener("abort", onAbort);
    controller.abort(reason);
    return Response.json([row(0)]);
  });
  const query = { ids: [id(0)], usernames: ["second"] };
  await expect(
    loadVisibleProfiles(config, query, controller.signal),
  ).rejects.toBe(reason);
  await expect(
    loadVisibleProfiles(config, query, controller.signal),
  ).rejects.toBe(reason);
  expect(onAbort).toHaveBeenCalledOnce();
  expect(visits).toHaveLength(1);
});
