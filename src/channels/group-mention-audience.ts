import type { Group } from "../../vendor/mattermost/index.js";
import type { accountMentionGroups } from "../mattermost/mention-group-reads.ts";
import { isMattermostId } from "../mattermost/model-fields.ts";
import { readDirectory } from "../mattermost/navigation-data.ts";
import {
  groupMentionScope,
  matchGroupMentions,
} from "./group-mention-scope.ts";

type GroupContext = { id: string; groupConstrained?: boolean };
type Policy = Parameters<typeof groupMentionScope>[0] & {
  confirmNotifications: boolean;
};
type Audience =
  | {
      kind: "ready";
      groups: { handle: string; members: number; timezones: number }[];
    }
  | { kind: "refresh-channel" | "refresh-team" };

export function readGroupMentionAudience(
  account: ReturnType<typeof accountMentionGroups>,
  channel: GroupContext,
  team: GroupContext | null,
  candidates: readonly string[],
  policy: Policy,
  signal?: AbortSignal,
): Promise<Audience> {
  return readDirectory(signal, async (request) => {
    if (!candidates.length || !policy.confirmNotifications)
      return { kind: "ready", groups: [] };
    const scope = groupMentionScope(policy, channel, team);
    if (scope === "none") return { kind: "ready", groups: [] };
    if (
      !isMattermostId(channel.id) ||
      (team !== null && !isMattermostId(team.id))
    )
      throw new TypeError("Invalid group mention context.");
    if (scope === "refresh-channel" || scope === "refresh-team")
      return { kind: scope };

    async function search() {
      const rows: Group[] = [];
      if (scope !== "directory" && !policy.customGroups) return rows;
      const terms = new Set<string>();
      for (const candidate of candidates) {
        let end = candidate.length;
        while (end > 1 && ".-_:".includes(candidate.charAt(end - 1))) end--;
        if (end > 0 && end <= 64)
          terms.add(candidate.slice(0, end).toLowerCase());
      }
      const unique = [...terms];
      for (let i = 0; i < unique.length; i += 4) {
        const lists = await Promise.all(
          unique
            .slice(i, i + 4)
            .map((q) =>
              request(({ signal }) => account.searchMentionGroups(q, signal)),
            ),
        );
        for (const list of lists) for (const row of list) rows.push(row);
      }
      return rows;
    }

    if (scope !== "directory" && !team)
      throw new TypeError("A synced channel requires its owning team.");
    const [directory, associated] = await Promise.all([
      search(),
      scope !== "directory" && team
        ? request(({ signal }) =>
            account.readAssociatedMentionGroups(
              team.id,
              scope === "channel" ? channel.id : null,
              signal,
            ),
          )
        : [],
    ]);
    const matches = matchGroupMentions(candidates, policy, {
      scope,
      directory,
      associated,
    });
    if (!matches.length) return { kind: "ready", groups: [] };
    const counts = await request(({ signal }) =>
      account.readMentionGroupCounts(channel.id, signal),
    );
    return {
      kind: "ready",
      groups: matches.map(({ id, handle }) => ({
        handle,
        ...(counts.get(id) ?? { members: 0, timezones: 0 }),
      })),
    };
  });
}
