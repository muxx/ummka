import assert from "node:assert/strict";
import { test } from "node:test";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import {
  CommandResponseToJSON,
  CommandsApi,
  Configuration,
} from "../../vendor/mattermost/index.js";

test("executes a channel command once, preserving its thread context and recursive response", async () => {
  const child = {
    response_type: "ephemeral",
    text: "Choose a time",
    username: "",
    channel_id: "",
    icon_url: "",
    type: "",
    goto_location: "",
    trigger_id: "",
    skip_slack_parsing: false,
    props: null,
    attachments: null,
    extra_responses: null,
  };
  const result = {
    ...child,
    response_type: "in_channel",
    username: "Calendar",
    channel_id: "dm",
    icon_url: "/calendar.png",
    type: "custom_calendar",
    text: "Appointment",
    goto_location: "/team/channels/meetings",
    trigger_id: "dialog",
    skip_slack_parsing: true,
    props: { nested: { active: false }, count: 0 },
    attachments: [
      {
        text: "Details",
        fields: [{ title: "Attendees", value: ["Ada", "Lin"] }],
      },
    ],
    extra_responses: [
      { ...child, extra_responses: [null, { ...child, attachments: [null] }] },
    ],
  };
  const requests: unknown[] = [];
  const transport = createRestTransport(
    "https://example.test/chat",
    async (input, init) => {
      const request = new Request(input, init);
      assert.equal(
        request.url,
        "https://example.test/chat/api/v4/commands/execute",
      );
      assert.equal(request.method, "POST");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer synthetic-session",
      );
      requests.push(await request.json());
      return Response.json(result);
    },
  );
  const api = new CommandsApi(
    new Configuration({ ...transport, accessToken: "synthetic-session" }),
  );
  const reply = await api.executeCommand({
    executeCommandRequest: {
      channelId: "dm",
      teamId: "workspace",
      rootId: "root",
      command: "/calendar meet",
    },
  });
  assert.equal(reply.responseType, "in_channel");
  assert.equal(reply.gotoLocation, result.goto_location);
  assert.equal(reply.triggerId, result.trigger_id);
  const nested = reply.extraResponses?.[0]?.extraResponses;
  assert.equal(nested?.[0], null);
  assert.deepEqual(nested?.[1]?.attachments, [null]);
  assert.equal(nested?.[1]?.extraResponses, null);
  assert.equal(reply.extraResponses?.[0]?.gotoLocation, "");
  assert.deepEqual(CommandResponseToJSON(reply), result);
  await api.executeCommand({
    executeCommandRequest: { channelId: "public", command: "/help" },
  });
  assert.deepEqual(requests, [
    {
      channel_id: "dm",
      team_id: "workspace",
      root_id: "root",
      command: "/calendar meet",
    },
    { channel_id: "public", command: "/help" },
  ]);
});
