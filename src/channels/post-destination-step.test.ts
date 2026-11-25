import { expect, test } from "vitest";
import { nextPostDestinationStep } from "./post-destination-step.ts";

const postId = "p".repeat(26),
  otherTeam = "w".repeat(26),
  team = {
    id: "t".repeat(26),
    kind: "O",
    displayName: "Polar",
    joined: false,
  } as const,
  channel = {
    id: "c".repeat(26),
    kind: "O",
    displayName: "Releases",
    joined: false,
  } as const;

test.each(["O", "I"] as const)(
  "re-evaluates team %s before entering its public channel",
  (kind) => {
    const destination = { postId, team: { ...team, kind }, channel };
    expect(nextPostDestinationStep(destination, otherTeam)).toEqual({
      kind: "joinTeam",
      team: destination.team,
    });
    const joinedTeam = { ...destination.team, joined: true };
    expect(
      nextPostDestinationStep({ ...destination, team: joinedTeam }, null),
    ).toEqual({ kind: "joinChannel", team: joinedTeam, channel });
    expect(
      nextPostDestinationStep(
        {
          ...destination,
          team: joinedTeam,
          channel: { ...channel, joined: true },
        },
        otherTeam,
      ),
    ).toEqual({
      kind: "readPost",
      teamId: team.id,
      channelId: channel.id,
      postId,
    });
  },
);

test("asks before joining an accessible private channel", () => {
  const privateChannel = { ...channel, kind: "P" } as const;
  const joinedTeam = { ...team, joined: true };
  expect(
    nextPostDestinationStep(
      { postId, team: joinedTeam, channel: privateChannel },
      null,
    ),
  ).toEqual({
    kind: "confirmPrivateChannel",
    team: joinedTeam,
    channel: privateChannel,
  });
});

test.each(["D", "G"] as const)(
  "opens a %s conversation only for a member with a selected team",
  (kind) => {
    const destination = { postId, team: null, channel: { ...channel, kind } };
    expect(nextPostDestinationStep(destination, otherTeam)).toEqual({
      kind: "unavailable",
    });
    expect(nextPostDestinationStep(destination, null)).toEqual({
      kind: "unavailable",
    });
    const member = {
      ...destination,
      channel: { ...destination.channel, joined: true },
    };
    expect(nextPostDestinationStep(member, null)).toEqual({
      kind: "selectTeam",
    });
    expect(nextPostDestinationStep(member, otherTeam)).toEqual({
      kind: "readPost",
      teamId: otherTeam,
      channelId: channel.id,
      postId,
    });
  },
);
