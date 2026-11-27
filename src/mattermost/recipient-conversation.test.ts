import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import { openRecipientConversation } from "./recipient-conversation.ts";

const me = "u".repeat(26);
const alice = "p".repeat(26);
const bill = "q".repeat(26);
const channel = "c".repeat(26);
const basePath = "https://example.test/mattermost";
const groupName = "188a80b75804e210b03437084146d53f71281c27";
const direct = {
  id: channel,
  type: "D",
  name: [alice, me].join("__"),
  team_id: "",
  delete_at: 0,
};

test.each([
  [[me], "D", [me, me].join("__")],
  [[alice], "D", direct.name],
  [[bill, alice], "G", groupName],
] as const)(
  "opens %j in the expected conversation with one request",
  async (recipients, type, name) => {
    const fetchApi = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(url).toBe(
          `${basePath}/api/v4/channels/${type === "D" ? "direct" : "group"}`,
        );
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual([me, ...recipients]);
        return Response.json({ ...direct, type, name }, { status: 201 });
      },
    );
    await expect(
      openRecipientConversation(
        new Configuration({ basePath, fetchApi }),
        me,
        recipients,
      ),
    ).resolves.toEqual({
      kind: "applied",
      channelId: channel,
      channelKind: type,
    });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);

test.each([
  [201, { ...direct, name: [bill, me].join("__") }, "unconfirmed"],
  [201, { ...direct, id: "invalid" }, "unconfirmed"],
  [201, { ...direct, team_id: alice }, "unconfirmed"],
  [201, { ...direct, type: "G" }, "unconfirmed"],
  [201, { ...direct, delete_at: 1 }, "unconfirmed"],
  [200, direct, "unconfirmed"],
  [403, { id: "denied", status_code: 403, message: "Restricted" }, "refused"],
  [401, {}, "unauthorized"],
  [500, {}, "unconfirmed"],
] as const)("classifies HTTP %d with %j as %s", async (status, body, kind) => {
  const fetchApi = vi.fn(async () => Response.json(body, { status }));
  await expect(
    openRecipientConversation(new Configuration({ basePath, fetchApi }), me, [
      alice,
    ]),
  ).resolves.toMatchObject({ kind });
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test("a group receipt for another selection cannot open that group", async () => {
  const fetchApi = vi.fn(async () =>
    Response.json({ ...direct, type: "G", name: groupName }, { status: 201 }),
  );
  await expect(
    openRecipientConversation(new Configuration({ basePath, fetchApi }), me, [
      alice,
      "m".repeat(26),
    ]),
  ).resolves.toEqual({ kind: "unconfirmed" });
});

test("invalid and aborted selections never submit, and a lost receipt does not repeat the request", async () => {
  const fetchApi = vi.fn(async () => {
    throw TypeError("offline");
  });
  const config = new Configuration({ basePath, fetchApi });
  for (const selection of [
    [],
    ["short"],
    [me, alice],
    [alice, alice],
    Array(1),
    Array.from({ length: 8 }, (_, i) => String(i).repeat(26)),
  ]) {
    await expect(
      openRecipientConversation(config, me, selection),
    ).rejects.toThrow(TypeError);
  }
  await expect(openRecipientConversation(config, "", [alice])).rejects.toThrow(
    TypeError,
  );
  await expect(
    openRecipientConversation(config, me, [alice], AbortSignal.abort("left")),
  ).rejects.toBe("left");
  expect(fetchApi).not.toHaveBeenCalled();
  await expect(openRecipientConversation(config, me, [alice])).resolves.toEqual(
    { kind: "unconfirmed" },
  );
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test("a late response after cancellation cannot open a conversation", async () => {
  const abort = new AbortController();
  const fetchApi = vi.fn(async () => {
    abort.abort("changed");
    return Response.json(direct, { status: 201 });
  });
  await expect(
    openRecipientConversation(
      new Configuration({ basePath, fetchApi }),
      me,
      [alice],
      abort.signal,
    ),
  ).rejects.toBe("changed");
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test("a refusal whose body arrives after cancellation is discarded", async () => {
  const abort = new AbortController();
  const response = new Response(null, { status: 403 });
  vi.spyOn(response, "json").mockImplementation(async () => {
    abort.abort("changed while reading refusal");
    return { id: "denied", status_code: 403 };
  });
  const fetchApi = vi.fn(async () => response);
  await expect(
    openRecipientConversation(
      new Configuration({ basePath, fetchApi }),
      me,
      [alice],
      abort.signal,
    ),
  ).rejects.toBe("changed while reading refusal");
  expect(fetchApi).toHaveBeenCalledOnce();
});
