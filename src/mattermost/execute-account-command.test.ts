import { expect, test } from "vitest";
import { CommandsApi, Configuration } from "../../vendor/mattermost/index.js";
import { executeAccountCommand } from "./execute-account-command.ts";

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
