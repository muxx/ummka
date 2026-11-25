import { createServer } from "node:http";
import { expect, test } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { loadTeamDirectory } from "./navigation-data.ts";
import { projectTeamSidebar } from "./team-sidebar.ts";

const user = "u".repeat(26);
const team = "t".repeat(26);
const a = "a".repeat(26);
const b = "b".repeat(26);
const d = "d".repeat(26);
const archived = "z".repeat(26);
const channel = (id: string, type = "O", teamId = team) => ({
  id,
  type,
  team_id: teamId,
  name: id,
  display_name: type === "D" ? "" : id,
  delete_at: id === archived ? 20 : 0,
});
const member = (id: string) => ({
  channel_id: id,
  user_id: user,
  mention_count_root: 0,
});
const category = (id: string, ids: string[]) => ({
  id,
  user_id: user,
  team_id: team,
  type: "custom",
  display_name: id,
  channel_ids: ids,
  sort_order: 0,
  sorting: "",
  muted: false,
  collapsed: false,
});
const system = `channels_${user}_${team}`;
const path = `/api/v4/users/me/teams/${team}/channels`;

function response(
  channels: unknown[] | Response,
  members: unknown[] | Response,
  sidebar: unknown,
) {
  const requests = new Map<string, unknown>([
    [path + "?include_deleted=true", channels],
    [path + "/members", members],
    [path + "/categories", sidebar],
  ]);
  return new Configuration({
    basePath: "https://example.test",
    fetchApi: async (input) => {
      const url = new URL(String(input));
      const target = url.pathname + url.search;
      if (!requests.has(target)) throw Error("Unexpected navigation request");
      const value = requests.get(target);
      return value instanceof Response ? value : Response.json(value);
    },
  });
}

test("keeps only joined rows and preserves category and channel order and archived metadata", async () => {
  const loose = "l".repeat(26);
  const result = await loadTeamDirectory(
    response(
      [
        channel(a),
        channel(b, "P"),
        channel(d, "D", ""),
        channel(archived),
        channel(loose),
      ],
      [
        member(d),
        member(a),
        member(archived),
        member(loose),
        member("x".repeat(26)),
      ],
      {
        order: ["managed", system, "empty"],
        categories: [
          category("empty", []),
          category(system, [archived, a, b]),
          { ...category("managed", [d]), type: "managed" },
        ],
      },
    ),
    user,
    team,
  );
  expect(result.teamId).toBe(team);
  expect(result.channels.map((row) => row.channel.id)).toEqual([
    a,
    d,
    archived,
    loose,
  ]);
  expect(result.channels[2]?.channel.deleteAt).toBe(20);
  expect(result.channels[1]?.channel.displayName).toBe("");
  const projection = projectTeamSidebar(result);
  expect(projection.channels.find((c) => c.id === archived)?.deleteAt).toBe(20);
  expect(projection.channels.find((c) => c.id === d)).toMatchObject({
    kind: "D",
    displayName: "",
    createAt: null,
    lastPostAt: null,
    mentionCountRoot: 0,
  });
  expect(projection.categories.map((c) => [c.id, c.channelIds])).toEqual([
    ["managed", [d]],
    [system, [archived, a]],
    ["empty", []],
  ]);

  expect(result.categories.map((c) => [c.id, c.channelIds])).toEqual([
    ["managed", [d]],
    [system, [archived, a]],
    ["empty", []],
  ]);
  await expect(
    loadTeamDirectory(
      response([], [], { order: [], categories: [] }),
      user,
      team,
    ),
  ).resolves.toEqual({ teamId: team, channels: [], categories: [] });
});

test("projects each channel counter and category setting independently", async () => {
  const config = response(
    [
      {
        ...channel(a),
        display_name: "Project",
        header: "Header",
        purpose: "Purpose",
        create_at: 37,
        last_post_at: 89,
        last_root_post_at: 83,
        total_msg_count: 71,
        total_msg_count_root: 59,
      },
    ],
    [
      {
        ...member(a),
        last_viewed_at: 79,
        msg_count: 47,
        msg_count_root: 43,
        mention_count: 31,
        mention_count_root: 19,
        urgent_mention_count: 7,
        notify_props: { mark_unread: "mention" },
      },
    ],
    {
      order: [system],
      categories: [
        {
          ...category(system, [a]),
          sorting: "alpha",
          muted: true,
          collapsed: true,
        },
      ],
    },
  );
  const snapshot = projectTeamSidebar(
    await loadTeamDirectory(config, user, team),
  );
  expect(snapshot).toEqual({
    channels: [
      {
        id: a,
        kind: "O",
        name: a,
        displayName: "Project",
        header: "Header",
        purpose: "Purpose",
        deleteAt: 0,
        createAt: 37,
        lastPostAt: 89,
        lastRootPostAt: 83,
        totalMsgCount: 71,
        totalMsgCountRoot: 59,
        lastViewedAt: 79,
        msgCount: 47,
        msgCountRoot: 43,
        mentionCount: 31,
        mentionCountRoot: 19,
        urgentMentionCount: 7,
        muted: true,
      },
    ],
    categories: [
      {
        id: system,
        kind: "custom",
        displayName: system,
        sorting: "alpha",
        collapsed: true,
        muted: true,
        channelIds: [a],
      },
    ],
  });
});

test("rejects foreign owners, channels in the wrong team and inconsistent category identities", async () => {
  const clean = { order: [system], categories: [category(system, [a])] };
  const configurations = [
    response([channel(a, "P", b)], [member(a)], clean),
    response([channel(d, "G", team)], [member(d)], clean),
    response([channel(a), channel(a)], [member(a)], clean),
    response([channel(a)], [member(a), member(a)], clean),
    response([channel(a)], [{ ...member(a), user_id: b }], clean),
    response([], [], {
      order: [system],
      categories: [{ ...category(system, []), team_id: b }],
    }),
    response([], [], {
      order: [system],
      categories: [{ ...category(system, []), user_id: b }],
    }),
    response([], [], { order: [system], categories: [] }),
    response([], [], {
      order: [system, system],
      categories: [category(system, []), category("other", [])],
    }),
    response([], [], {
      order: [system, "other"],
      categories: [category(system, []), category(system, [])],
    }),
    response([], [], {
      order: [system],
      categories: [category(system, ["bad"])],
    }),
  ];
  for (const config of configurations)
    await expect(loadTeamDirectory(config, user, team)).rejects.toBeInstanceOf(
      TypeError,
    );
});

test("rejects an invalid team or an aborted request without sending HTTP", async () => {
  let calls = 0;
  const config = new Configuration({
    fetchApi: async () => {
      calls++;
      return Response.json([]);
    },
  });
  await expect(loadTeamDirectory(config, user, "me")).rejects.toBeInstanceOf(
    TypeError,
  );
  const reason = new Error("left team");
  await expect(
    loadTeamDirectory(config, user, team, AbortSignal.abort(reason)),
  ).rejects.toBe(reason);
  expect(calls).toBe(0);
});

test("an empty channel list preserves the team's categories on Mattermost's precise 404", async () => {
  const missing = Response.json(
    { id: "app.channel.get_channels.not_found.app_error" },
    { status: 404 },
  );
  const sidebar = { order: [system], categories: [category(system, [])] };
  const directory = await loadTeamDirectory(
    response(missing, [], sidebar),
    user,
    team,
  );
  expect(directory.channels).toEqual([]);
  expect(directory.categories.map((c) => c.id)).toEqual([system]);
});

test("preserves unrelated HTTP errors and their original bodies", async () => {
  for (const failure of [
    Response.json({ id: "other.not_found" }, { status: 404 }),
    new Response("missing at proxy", { status: 404 }),
    Response.json(
      { id: "app.channel.get_channels.not_found.app_error" },
      { status: 403 },
    ),
  ]) {
    const body = await failure.clone().text();
    const error = await loadTeamDirectory(
      response(failure, [], { order: [], categories: [] }),
      user,
      team,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ResponseError);
    expect(await (error as ResponseError).response.text()).toBe(body);
  }
  const missingMember = Response.json(
    { id: "app.channel.get_channels.not_found.app_error" },
    { status: 404 },
  );
  await expect(
    loadTeamDirectory(
      response([], missingMember, { order: [], categories: [] }),
      user,
      team,
    ),
  ).rejects.toBeInstanceOf(ResponseError);
});

test("the caller can finish reading HTTP error data arriving after response headers", async () => {
  const payload = { id: "forbidden.team" };
  let finishBody: () => void = () => {
    throw new Error("No failing request");
  };
  const server = createServer((request, res) => {
    if (request.url?.endsWith("?include_deleted=true")) {
      res.writeHead(403, { "content-type": "application/json" });
      res.flushHeaders();
      finishBody = () => {
        res.end(JSON.stringify(payload));
      };
    } else {
      res.setHeader("content-type", "application/json");
      res.end(
        request.url?.endsWith("/categories")
          ? '{"order":[],"categories":[]}'
          : "[]",
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing test port");
    const config = new Configuration({
      basePath: "http://127.0.0.1:" + address.port,
    });
    const failure: unknown = await loadTeamDirectory(config, user, team).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ResponseError);
    finishBody();
    expect(await (failure as ResponseError).response.json()).toEqual(payload);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
