import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import {
  type RecipientQuery,
  readConversationRecipients,
} from "./conversation-recipients.ts";
import type { ServerPolicy } from "./workspace-preferences.ts";

const id = (n: number) => String(n).padStart(26, "0");
const team = id(10);
const basePath = "https://example.test/mm";
const user = (n: number) => ({
  id: id(n),
  username: `member${n}`,
  delete_at: 0,
  email: "private@example.test",
});

test.each(["any", "team", undefined] as const)(
  "uses the saved scope %s for both recipient reads",
  async (scope) => {
    const fetchApi = vi.fn<typeof fetch>(async (url, init) => {
      const where = new URL(String(url));
      if (where.pathname === "/mm/api/v4/users") {
        expect(init?.method).toBe("GET");
        expect(Object.fromEntries(where.searchParams)).toEqual({
          page: "3",
          per_page: "100",
          active: "true",
          ...(scope === "any" ? {} : { in_team: team }),
        });
      } else {
        expect(where.pathname).toBe("/mm/api/v4/users/search");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          term: "Анна",
          allow_inactive: false,
          limit: 100,
          ...(scope === "any" ? {} : { team_id: team }),
        });
      }
      return Response.json([user(2), user(1)]);
    });
    const config = new Configuration({ basePath, fetchApi });
    const readScope = vi.fn(async () => scope);
    for (const query of [
      { kind: "page", page: 3 },
      { kind: "search", term: " @Анна " },
    ] as const) {
      const result = await readConversationRecipients(
        config,
        team,
        query,
        readScope,
      );
      expect(result.nextPage).toBeNull();
      expect(result.profiles.map((p) => p.id)).toEqual([id(2), id(1)]);
      expect(result.profiles[0]).not.toHaveProperty("email");
    }
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(readScope).toHaveBeenCalledTimes(2);
  },
);

test("rereads the account scope and advances only full pages", async () => {
  const batch = Array.from({ length: 100 }, (_, i) => user(i));
  const fetchApi = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(batch))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(batch));
  const config = new Configuration({ basePath, fetchApi });
  let scope: ServerPolicy["dmRecipientScope"] = "any";
  const read = (query: RecipientQuery) =>
    readConversationRecipients(config, team, query, async () => scope);
  expect((await read({ kind: "page", page: 0 })).nextPage).toBe(1);
  scope = "team";
  expect((await read({ kind: "page", page: 1 })).nextPage).toBeNull();
  expect((await read({ kind: "search", term: "member" })).nextPage).toBeNull();
  expect(
    new URL(String(fetchApi.mock.calls[0][0])).searchParams.has("in_team"),
  ).toBe(false);
  expect(
    new URL(String(fetchApi.mock.calls[1][0])).searchParams.get("in_team"),
  ).toBe(team);
});

test("rejects stale identities and invalid query inputs", async () => {
  const invalidBatches = [
    [user(1), user(1)],
    [{ ...user(1), delete_at: 4 }],
    [{ ...user(1), delete_at: undefined }],
    Array.from({ length: 101 }, (_, i) => user(i)),
  ];
  const fetchApi = vi.fn<typeof fetch>(async () =>
    Response.json(invalidBatches.shift()),
  );
  const config = new Configuration({ basePath, fetchApi });
  const scope = vi.fn(async () => "team" as const);
  for (const query of [
    { kind: "page", page: -1 },
    { kind: "page", page: 0.5 },
    { kind: "page", page: Number.MAX_SAFE_INTEGER },
    { kind: "search", term: "  @  " },
  ] as const) {
    await expect(
      readConversationRecipients(config, team, query, scope),
    ).rejects.toThrow();
  }
  await expect(
    readConversationRecipients(config, "bad", { kind: "page", page: 0 }, scope),
  ).rejects.toThrow();
  expect(scope).not.toHaveBeenCalled();
  expect(fetchApi).not.toHaveBeenCalled();
  for (let i = 0; i < 4; i++)
    await expect(
      readConversationRecipients(
        config,
        team,
        { kind: "page", page: 0 },
        scope,
      ),
    ).rejects.toThrow();
});

test("cancels before dispatch when scope arrives late and discards a late response", async () => {
  for (const stage of ["scope", "response", "transport error"]) {
    const abort = new AbortController();
    const fetchApi = vi.fn(async () => {
      abort.abort("left team");
      if (stage === "transport error") throw TypeError("transport aborted");
      return Response.json([user(1)]);
    });
    const readScope = async () => {
      if (stage === "scope") abort.abort("left team");
      return "any" as const;
    };
    await expect(
      readConversationRecipients(
        new Configuration({ basePath, fetchApi }),
        team,
        { kind: "page", page: 0 },
        readScope,
        abort.signal,
      ),
    ).rejects.toBe("left team");
    expect(fetchApi).toHaveBeenCalledTimes(stage === "scope" ? 0 : 1);
  }
});
