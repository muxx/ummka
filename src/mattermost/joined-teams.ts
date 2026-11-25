import type { loadAccountDirectory } from "./navigation-data.ts";

export type JoinedTeam = {
  id: string;
  name: string;
  displayName: string;
  preferenceRank: number | null;
};

export type JoinedTeams = { teams: JoinedTeam[]; selectedTeam: string | null };

export function projectJoinedTeams({
  teams,
  preferences,
}: Awaited<ReturnType<typeof loadAccountDirectory>>): JoinedTeam[] {
  const order = preferences.find(
    (preference) =>
      preference.category === "teams_order" && preference.name === "",
  )?.value;
  const ranks = new Map<string, number>();
  for (const [index, id] of (order?.split(",") ?? []).entries()) {
    if (!ranks.has(id)) ranks.set(id, index);
  }
  return teams.map(({ team }) => ({
    id: team.id,
    name: team.name,
    displayName: team.displayName,
    preferenceRank: ranks.get(team.id) ?? null,
  }));
}

export function orderJoinedTeams(teams: readonly JoinedTeam[], locale: string) {
  const collator = new Intl.Collator(locale, { numeric: true });
  return [...teams].sort((left, right) => {
    if (left.preferenceRank !== right.preferenceRank) {
      if (left.preferenceRank === null) return 1;
      if (right.preferenceRank === null) return -1;
      return left.preferenceRank - right.preferenceRank;
    }
    return left.displayName === right.displayName
      ? collator.compare(left.name, right.name)
      : collator.compare(left.displayName, right.displayName);
  });
}
