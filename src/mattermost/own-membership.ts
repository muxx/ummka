import {
  ChannelsApi,
  type Configuration,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";
import { mutationFailure } from "./mutation-error.ts";

export type MembershipTarget = { kind: "team" | "channel"; id: string };
export type MembershipChange = "join" | "leave";

export async function changeOwnMembership(
  config: Configuration,
  userId: string,
  target: MembershipTarget,
  change: MembershipChange,
) {
  if (
    !isMattermostId(userId) ||
    !isMattermostId(target.id) ||
    (target.kind !== "channel" && target.kind !== "team") ||
    (change !== "join" && change !== "leave")
  )
    throw new TypeError("Invalid Mattermost membership change.");

  const id = target.id;
  let confirmed: boolean;
  try {
    if (change === "leave") {
      const reply =
        target.kind === "team"
          ? await new TeamsApi(config).removeTeamMemberRaw({
              teamId: id,
              userId,
            })
          : await new ChannelsApi(config).removeUserFromChannelRaw({
              channelId: id,
              userId,
            });
      const body = await reply.value();
      confirmed = reply.raw.status === 200 && body?.status === "OK";
    } else if (target.kind === "team") {
      const reply = await new TeamsApi(config).addTeamMemberRaw({
        teamId: id,
        addTeamMemberRequest: { teamId: id, userId },
      });
      const member = await reply.value();
      confirmed =
        reply.raw.status === 201 &&
        member?.teamId === id &&
        member.userId === userId &&
        member.deleteAt === 0;
    } else {
      const reply = await new ChannelsApi(config).addChannelMemberRaw({
        channelId: id,
        addChannelMemberRequest: { userId },
      });
      const member = await reply.value();
      confirmed =
        reply.raw.status === 201 &&
        member?.channelId === id &&
        member.userId === userId;
    }
    return confirmed
      ? ({ kind: "applied" } as const)
      : ({ kind: "unconfirmed" } as const);
  } catch (error) {
    return mutationFailure(error);
  }
}
