import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import type { MembershipTarget } from "../mattermost/own-membership.ts";
import { inspectPostTarget } from "./inspect-post-target.ts";
import { workspaceFailure } from "./workspace-data.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  | "readFileAnchor"
  | "readPostAnchor"
  | "readPostDestination"
  | "changeOwnMembership"
>;
type Source = Parameters<typeof inspectPostTarget>[1];
type Step = Awaited<ReturnType<typeof inspectPostTarget>>;
type Consent = Extract<Step, { kind: "joinTeam" | "confirmPrivateChannel" }>;

export function openPostNavigation(
  account: Account,
  source: Source,
  selectedTeamId: string | null,
  confirm: (request: Consent) => Promise<boolean>,
  signal?: AbortSignal,
) {
  const origin = { ...source };
  async function navigate() {
    const joined: MembershipTarget[] = [];
    let scope: { teamId: string; channelId: string } | undefined;
    let consent: { team: boolean; privateChannel: boolean } | undefined;
    for (;;) {
      let step: Step;
      try {
        step = await inspectPostTarget(account, origin, selectedTeamId, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (joined.length === 0) throw error;
        const reason = workspaceFailure(error, "network");
        if (reason === "session" || reason === "unauthorized") throw error;
        return { target: { kind: "readFailed", reason } as const, joined };
      }
      signal?.throwIfAborted();
      if (
        step.kind !== "joinTeam" &&
        step.kind !== "confirmPrivateChannel" &&
        step.kind !== "joinChannel"
      ) {
        if (
          step.kind === "ready" &&
          scope &&
          (step.teamId !== scope.teamId || step.channelId !== scope.channelId)
        )
          return { target: { kind: "destinationChanged" } as const, joined };
        return { target: step, joined };
      }
      if (
        scope &&
        (step.team.id !== scope.teamId || step.channel.id !== scope.channelId)
      )
        return { target: { kind: "destinationChanged" } as const, joined };
      scope ??= { teamId: step.team.id, channelId: step.channel.id };
      if (
        step.kind !== "joinChannel" &&
        (!consent ||
          (step.kind === "joinTeam" && !consent.team) ||
          (step.channel.kind === "P" && !consent.privateChannel))
      ) {
        const requested = {
          team: step.kind === "joinTeam",
          privateChannel: step.channel.kind === "P",
        };
        const accepted = await confirm(step);
        signal?.throwIfAborted();
        if (!accepted)
          return { target: { kind: "cancelled" } as const, joined };
        consent = requested;
        continue;
      }
      const target: MembershipTarget =
        step.kind === "joinTeam"
          ? { kind: "team", id: step.team.id }
          : { kind: "channel", id: step.channel.id };
      if (
        joined.some(
          (item) => item.kind === target.kind && item.id === target.id,
        )
      )
        return {
          target: {
            kind: "membershipUnconfirmed",
            membership: target,
          } as const,
          joined,
        };
      const result = await account.changeOwnMembership(target, "join");
      signal?.throwIfAborted();
      if (result.kind !== "applied")
        return {
          target: {
            kind: "membershipFailed",
            membership: target,
            result,
          } as const,
          joined,
        };
      joined.push(target);
    }
  }

  let pending: ReturnType<typeof navigate> | undefined;
  return {
    open() {
      pending ??= navigate();
      return pending;
    },
  };
}
