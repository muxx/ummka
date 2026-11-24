import { expect, test } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { loadAccountDirectory } from "./navigation-data.ts";

const user = "u".repeat(26);
const teamId = (letter: string) => letter.repeat(26);
const team = (id: string, deleted = 0) => ({
  id,
  name: id,
  display_name: "Room",
  delete_at: deleted,
});
const member = (id: string, deleted = 0) => ({
  team_id: id,
  user_id: user,
  roles: "team_user",
  delete_at: deleted,
});
const pref = { user_id: user, category: "teams_order", name: "", value: "" };

function configuration(fetchApi: typeof fetch) {
  return new Configuration({ basePath: "https://fixture.test/sub", fetchApi });
}

function directory(
  teams: unknown[],
  members: unknown[],
  preferences: unknown[],
) {
  const routes = new Map([
    ["/sub/api/v4/users/me/teams", teams],
    ["/sub/api/v4/users/me/teams/members", members],
    ["/sub/api/v4/users/me/preferences", preferences],
  ]);
  return configuration(async (input) => {
    const route = new URL(String(input)).pathname;
    if (!routes.has(route)) throw Error("Unexpected directory route");
    return Response.json(routes.get(route));
  });
}

test("joins active teams by ID in server order, independently from membership or preferences order", async () => {
  const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(teamId);
  const config = directory(
    [team(b), team(c, 10), team(a), team(d), team(e)],
    [member(teamId("f")), member(c), member(a), member(e, 3), member(b)],
    [
      pref,
      { ...pref, category: "direct_channel_show", name: user, value: "false" },
    ],
  );
  const result = await loadAccountDirectory(config, user);
  expect(
    result.teams.map(({ team, membership }) => [team.id, membership.teamId]),
  ).toEqual([
    [b, b],
    [a, a],
  ]);
  expect(result.preferences.map(({ name, value }) => [name, value])).toEqual([
    ["", ""],
    [user, "false"],
  ]);
  await expect(
    loadAccountDirectory(directory([], [], []), user),
  ).resolves.toEqual({ teams: [], preferences: [] });
});

test("rejects duplicate identities, another account and malformed navigation data", async () => {
  const id = teamId("a");
  const cases = [
    directory([team(id), team(id)], [member(id)], []),
    directory([team(id)], [member(id), member(id)], []),
    directory([team(id)], [{ ...member(id), user_id: teamId("b") }], []),
    directory([team(id)], [member(id, -1)], []),
    directory([team("invalid")], [], []),
    directory([], [], [{ ...pref, user_id: teamId("b") }]),
    directory([], [], [{ ...pref, value: false }]),
  ];
  for (const config of cases)
    await expect(loadAccountDirectory(config, user)).rejects.toBeInstanceOf(
      TypeError,
    );
});

test("stops sibling requests on error, preserving the original HTTP failure", async () => {
  const stopped: string[] = [];
  const config = configuration(async (input, init) => {
    const route = new URL(String(input)).pathname;
    if (route.endsWith("/preferences"))
      return new Response(null, { status: 503 });
    const signal = init?.signal;
    if (!signal) throw Error("Missing directory cancellation");
    return new Promise((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          stopped.push(route);
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  });
  const failure = await loadAccountDirectory(config, user).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ResponseError);
  expect((failure as ResponseError).response.status).toBe(503);
  expect(stopped.sort()).toEqual([
    "/sub/api/v4/users/me/teams",
    "/sub/api/v4/users/me/teams/members",
  ]);
});

test("propagates cancellation before network and while three reads are pending", async () => {
  const controller = new AbortController();
  const reason = new Error("left account");
  let started = 0;
  let allStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    allStarted = resolve;
  });
  const config = configuration(async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw Error("Missing directory cancellation");
    if (++started === 3) allStarted();
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const read = loadAccountDirectory(config, user, controller.signal);
  await ready;
  controller.abort(reason);
  await expect(read).rejects.toBe(reason);
  await expect(
    loadAccountDirectory(config, user, controller.signal),
  ).rejects.toBe(reason);
  await expect(loadAccountDirectory(config, "invalid")).rejects.toBeInstanceOf(
    TypeError,
  );
  expect(started).toBe(3);
});
