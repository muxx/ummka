import { expect, test, vi } from "vitest";
import { CommandsApi, Configuration } from "../../vendor/mattermost/index.js";
import { executeAccountCommand } from "./execute-account-command.ts";

import { executeSavedCommand } from "./execute-saved-command.ts";

const teamId = "t".repeat(26);
const channelId = "c".repeat(26);
const rootId = "p".repeat(26);
const target = { teamId, channelId };
const unknown = "api.command.execute_command.not_found.app_error";
const response = {
  response_type: "ephemeral",
  text: "For this account",
  username: "",
  channel_id: "",
  icon_url: "",
  type: "",
  props: null,
  goto_location: "",
  trigger_id: "",
  skip_slack_parsing: false,
  attachments: null,
  extra_responses: null,
};
function appError(status: number, id: string, statusCode = status) {
  return Response.json(
    { id, status_code: statusCode, message: "Server response." },
    { status },
  );
}
function fixture(reply: () => Response) {
  const visits: unknown[] = [];
  const client = new CommandsApi(
    new Configuration({
      basePath: "https://chat.example.org/subpath",
      fetchApi: async (url, init) => {
        expect(String(url)).toBe(
          "https://chat.example.org/subpath/api/v4/commands/execute",
        );
        expect(init?.method).toBe("POST");
        visits.push(JSON.parse(String(init?.body)));
        return reply();
      },
    }),
  );
  return { client, visits };
}

test("executes once in the intended channel or thread with case-preserving arguments", async () => {
  const wire = {
    ...response,
    trigger_id: "dialog",
    goto_location: "/example",
    extra_responses: [response],
  };
  const { client, visits } = fixture(() => Response.json(wire));
  const result = await executeAccountCommand(
    client,
    { ...target, rootId },
    "/DEPLOY\t  —Dry-Run\n    QA  ",
  );
  expect(result).toMatchObject({
    kind: "executed",
    response: {
      responseType: "ephemeral",
      gotoLocation: "/example",
      triggerId: "dialog",
      extraResponses: [{ text: "For this account" }],
    },
  });
  await executeAccountCommand(client, target, "/HELP");
  expect(visits).toEqual([
    {
      channel_id: channelId,
      team_id: teamId,
      root_id: rootId,
      command: "/deploy --Dry-Run\n    QA",
    },
    { channel_id: channelId, team_id: teamId, command: "/help" },
  ]);
});

test("only the server's matching 404 permits offering publication as text", async () => {
  for (const [reply, expected] of [
    [appError(404, unknown), "unknownCommand"],
    [appError(404, "api.channel.not_found"), "refused"],
    [appError(403, unknown), "refused"],
    [appError(404, unknown, 400), "unconfirmed"],
    [new Response("Not found", { status: 404 }), "unconfirmed"],
    [new Response(null, { status: 401 }), "unauthorized"],
    [appError(503, unknown), "unconfirmed"],
  ] as const) {
    const { client, visits } = fixture(() => reply);
    expect(
      (await executeAccountCommand(client, target, "/private secret")).kind,
    ).toBe(expected);
    expect(visits).toHaveLength(1);
  }
});

test("a lost or unreadable response never sends a second request", async () => {
  for (const reply of [
    () => {
      throw new TypeError("Connection lost.");
    },
    () => new Response("{"),
    () => Response.json({}),
    () => Response.json({ ...response, text: 17 }),
    () => Response.json({ ...response, extra_responses: [{}] }),
  ]) {
    const { client, visits } = fixture(reply);
    expect(await executeAccountCommand(client, target, "/me done")).toEqual({
      kind: "unconfirmed",
    });
    expect(visits).toHaveLength(1);
  }
});

test("validates scope and command text before the request", async () => {
  const { client, visits } = fixture(() => Response.json(response));
  await expect(executeAccountCommand(client, target, " /help")).rejects.toThrow(
    "slash command",
  );
  await expect(
    executeAccountCommand(client, { ...target, rootId: "bad" }, "/help"),
  ).rejects.toThrow("location");
  await expect(
    executeAccountCommand(client, { ...target, teamId: "" }, "/help"),
  ).rejects.toThrow("location");
  await expect(
    executeAccountCommand(client, { ...target, channelId: "123" }, "/help"),
  ).rejects.toThrow("location");
  expect(visits).toEqual([]);
});

test("only a claimed revision can execute its stored command", async () => {
  const { client, visits } = fixture(() => Response.json(response));
  const draft = {
    message: "/deploy Signed",
    revision: "two",
    commandPending: true as const,
  };
  const change = vi
    .fn<Parameters<typeof executeSavedCommand>[1]>()
    .mockResolvedValueOnce({ kind: "saved", draft })
    .mockResolvedValueOnce({ kind: "conflict", draft })
    .mockResolvedValueOnce({
      kind: "saved",
      draft: { message: "", revision: "three", clearedBySubmission: true },
    });
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      executeSavedCommand(client, change, { ...target, rootId }, "one"),
    ),
  );
  expect(visits).toEqual([
    {
      channel_id: channelId,
      team_id: teamId,
      root_id: rootId,
      command: "/deploy Signed",
    },
  ]);
  expect(outcomes.map((s) => s.kind).sort()).toEqual(["answered", "conflict"]);
  expect(outcomes.find((s) => s.kind === "answered")).toMatchObject({
    settlement: "saved",
    result: { kind: "executed", response: { text: response.text } },
  });
  expect(
    change.mock.calls.map(([location, action]) => [location.revision, action]),
  ).toEqual([
    ["one", "start"],
    ["one", "start"],
    ["two", "complete"],
  ]);
});

test("preserves the command on refusal and on an uncertain response", async () => {
  for (const [getResponse, kind] of [
    [() => appError(404, unknown), "unknownCommand"],
    [() => appError(403, "api.command.denied"), "refused"],
    [() => new Response(null, { status: 401 }), "unauthorized"],
    [
      () => {
        throw TypeError("offline after send");
      },
      "unconfirmed",
    ],
  ] as const) {
    const { client, visits } = fixture(getResponse);
    const change = vi
      .fn<Parameters<typeof executeSavedCommand>[1]>()
      .mockResolvedValueOnce({
        kind: "saved",
        draft: {
          message: "/release one",
          revision: "two",
          commandPending: true,
        },
      })
      .mockResolvedValueOnce({
        kind: "saved",
        draft: { message: "/release one", revision: "three" },
      });
    const result = await executeSavedCommand(client, change, target, "one");
    if (kind === "unconfirmed") {
      expect(result).toEqual({ kind });
      expect(change).toHaveBeenCalledTimes(1);
    } else {
      expect(result).toMatchObject({
        kind: "answered",
        result: { kind },
        settlement: "saved",
        draft: { message: "/release one", revision: "three" },
      });
      expect(change).toHaveBeenLastCalledWith(
        { ...target, revision: "two" },
        "release",
      );
    }
    expect(visits).toHaveLength(1);
  }
});

test("keeps a known server reply when the draft has changed or SQLite refuses the final write", async () => {
  for (const problem of [
    "edit",
    "history_storage_unavailable",
    "session_unavailable",
  ] as const) {
    const { client } = fixture(() => Response.json(response));
    const change = vi
      .fn<Parameters<typeof executeSavedCommand>[1]>()
      .mockResolvedValueOnce({
        kind: "saved",
        draft: { message: "/deploy", revision: "active", commandPending: true },
      });
    if (problem === "edit")
      change.mockResolvedValueOnce({
        kind: "conflict",
        draft: { message: "new text", revision: "other" },
      });
    else change.mockRejectedValueOnce(problem);
    const result = executeSavedCommand(client, change, target, "one");
    if (problem === "session_unavailable")
      await expect(result).rejects.toBe(problem);
    else
      await expect(result).resolves.toMatchObject({
        kind: "answered",
        result: { kind: "executed", response: { text: response.text } },
        settlement: problem === "edit" ? "conflict" : "storageUnavailable",
      });
    expect(change).toHaveBeenCalledTimes(2);
  }
});

test("offline submission and malformed team IDs never reserve the text", async () => {
  const { client, visits } = fixture(() => Response.json(response));
  const change = vi.fn<Parameters<typeof executeSavedCommand>[1]>();
  await expect(
    executeSavedCommand(client, change, { ...target, teamId: "bad" }, "one"),
  ).rejects.toThrow(TypeError);
  const network = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    await expect(
      executeSavedCommand(client, change, target, "one"),
    ).resolves.toEqual({ kind: "offline" });
  } finally {
    network.mockRestore();
  }
  expect(change).not.toHaveBeenCalled();
  expect(visits).toHaveLength(0);
});
