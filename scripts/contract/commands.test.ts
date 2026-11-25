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

test("reads member commands and preserves suggestion text and thread context in the URL", async () => {
  const requests: URL[] = [];
  const picker = {
    id: "calendar",
    trigger: "meet",
    display_name: "Meet",
    auto_complete: true,
    auto_complete_hint: "[person]",
    auto_complete_desc: "Pick a person",
    icon_url: "/calendar.png",
    autocomplete_icon_data: "fixture-icon",
    token: "administrative-fixture",
    url: "https://integration.example.test",
  };
  const suggestion = {
    Complete: "meet Ada",
    Suggestion: "Ada",
    Hint: "Person",
    Description: "",
    IconData: "fixture-icon",
  };
  const transport = createRestTransport(
    "https://example.test/subpath",
    async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.method, "GET");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer synthetic-session",
      );
      const url = new URL(request.url);
      requests.push(url);
      return Response.json(
        url.pathname.endsWith("/autocomplete") ? [picker] : [suggestion],
      );
    },
  );
  const commands = new CommandsApi(
    new Configuration({ ...transport, accessToken: "synthetic-session" }),
  );
  const rows = await commands.listAutocompleteCommands({ teamId: "workspace" });
  assert.deepEqual(rows, [
    {
      id: "calendar",
      trigger: "meet",
      displayName: "Meet",
      autoComplete: true,
      autoCompleteHint: "[person]",
      autoCompleteDesc: "Pick a person",
      iconUrl: "/calendar.png",
      autocompleteIconData: "fixture-icon",
    },
  ]);
  const root = { teamId: "workspace", userInput: "/meet a+b & ё?#" };
  const result = await commands.listCommandAutocompleteSuggestions({
    ...root,
    channelId: "channel",
    rootId: "thread",
  });
  assert.deepEqual(result, [
    {
      complete: "meet Ada",
      suggestion: "Ada",
      hint: "Person",
      description: "",
      iconData: "fixture-icon",
    },
  ]);
  await commands.listCommandAutocompleteSuggestions({
    ...root,
    channelId: "channel",
  });
  assert.deepEqual(
    requests.map((url) => [
      url.origin,
      url.pathname,
      Object.fromEntries(url.searchParams),
      url.hash,
    ]),
    [
      [
        "https://example.test",
        "/subpath/api/v4/teams/workspace/commands/autocomplete",
        {},
        "",
      ],
      [
        "https://example.test",
        "/subpath/api/v4/teams/workspace/commands/autocomplete_suggestions",
        {
          user_input: root.userInput,
          channel_id: "channel",
          root_id: "thread",
        },
        "",
      ],
      [
        "https://example.test",
        "/subpath/api/v4/teams/workspace/commands/autocomplete_suggestions",
        { user_input: root.userInput, channel_id: "channel" },
        "",
      ],
    ],
  );
});
