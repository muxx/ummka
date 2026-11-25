import { expect, test } from "vitest";
import { orderJoinedTeams, projectJoinedTeams } from "./joined-teams.ts";

const a = "a".repeat(26);
const b = "b".repeat(26);
const c = "c".repeat(26);
const d = "d".repeat(26);
const e = "e".repeat(26);

test("keeps first known preference ranks and uses Mattermost's numeric display-name and slug order", () => {
  const rows = projectJoinedTeams({
    teams: [
      [a, "alpha-10", "Команда 20"],
      [b, "alpha-2", "Команда 20"],
      [c, "third", "Команда 3"],
      [d, "fourth", "Команда 100"],
      [e, "fifth", "Команда 1"],
    ].map(([id, name, displayName]) => ({
      team: { id, name, displayName },
      membership: {
        teamId: id,
        ...(id === a ? { roles: "team_guest custom_reader" } : {}),
        ...(id === b ? { roles: "" } : {}),
      },
    })),
    preferences: [
      { category: "teams_order", name: "irrelevant", value: a },
      { category: "teams_order", name: "", value: `${d},absent,${d},${e}` },
    ],
  });
  expect(rows.map((row) => row.preferenceRank)).toEqual([
    null,
    null,
    null,
    0,
    3,
  ]);
  expect(orderJoinedTeams(rows, "ru").map((row) => row.id)).toEqual([
    d,
    e,
    c,
    b,
    a,
  ]);
  expect(rows.map((row) => row.id)).toEqual([a, b, c, d, e]);
  expect(rows[0]?.roles).toBe("team_guest custom_reader");
  expect(rows[1]?.roles).toBe("");
  expect(rows[2]).not.toHaveProperty("roles");
  expect(projectJoinedTeams({ teams: [], preferences: [] })).toEqual([]);
});
