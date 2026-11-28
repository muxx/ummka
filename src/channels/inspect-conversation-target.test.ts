import { expect, test, vi } from "vitest";
import { inspectConversationTarget } from "./inspect-conversation-target.ts";

type Account = Parameters<typeof inspectConversationTarget>[0];
const team = { id: "a".repeat(26), name: "polar", displayName: "Polar" };
const channel = {
  id: "b".repeat(26),
  name: "release",
  displayName: "Releases",
  type: "O",
  membership: "member",
  archived: false,
} as const;
const target = {
  kind: "conversation",
  route: "channels",
  serverUrl: "https://example.test/mm",
  team: team.name,
  identifier: channel.id,
  postId: "p".repeat(26),
} as const;
const byId = {
  kind: "channel-id",
  teamId: team.id,
  id: channel.id,
  name: channel.name,
} as const;
const found = { kind: "channel", team, channel } as const;
function fixture() {
  return {
    resolveConversationIdentifier: vi
      .fn<Account["resolveConversationIdentifier"]>()
      .mockResolvedValue(byId),
    readNamedChannelDestination: vi
      .fn<Account["readNamedChannelDestination"]>()
      .mockResolvedValue(found),
  };
}
test("passes the signed scope and preserves the exact message for subsequent focus", async () => {
  const account = fixture(),
    signal = new AbortController().signal;
  const known = {
    serverUrl: target.serverUrl,
    userId: "u".repeat(26),
    team: team.name,
    name: target.identifier,
    kind: "O",
  } as const;
  expect(
    await inspectConversationTarget(account, target, known, signal),
  ).toEqual({ ...found, postId: target.postId });
  expect(account.resolveConversationIdentifier).toHaveBeenCalledExactlyOnceWith(
    target,
    known,
    signal,
  );
  expect(account.readNamedChannelDestination).toHaveBeenCalledExactlyOnceWith(
    team.name,
    channel.name,
    signal,
  );
});
test("rejects ID/name reassignment and a join prompt for a different team", async () => {
  const account = fixture(),
    other = "c".repeat(26);
  for (const result of [
    { ...found, channel: { ...channel, id: other } },
    { ...found, team: { ...team, id: other } },
    { kind: "join-team", team: { ...team, id: other } },
  ] as const) {
    account.readNamedChannelDestination.mockResolvedValueOnce(result);
    expect(await inspectConversationTarget(account, target)).toEqual({
      kind: "unavailable",
    });
  }
  account.readNamedChannelDestination.mockResolvedValueOnce({
    kind: "join-team",
    team,
  });
  expect(await inspectConversationTarget(account, target)).toEqual({
    kind: "join-team",
    team,
    postId: target.postId,
  });
});
test("keeps a named destination and preserves private nonmembership", async () => {
  const account = fixture();
  account.resolveConversationIdentifier.mockResolvedValue({
    kind: "channel-name",
    name: channel.name,
  });
  const result = {
    ...found,
    channel: { ...channel, type: "P", membership: "absent" },
  } as const;
  account.readNamedChannelDestination.mockResolvedValue(result);
  expect(
    await inspectConversationTarget(account, {
      ...target,
      identifier: channel.name,
      postId: null,
    }),
  ).toEqual({ ...result, postId: null });
});
test("passes direct and group addresses to the conversation flow without a channel lookup", async () => {
  const account = fixture();
  for (const address of [
    { kind: "user-id", id: "u".repeat(26) },
    { kind: "email", email: "guest@example.test" },
    { kind: "group-name", name: "g".repeat(40) },
    { kind: "username", name: "guest" },
  ] as const) {
    account.resolveConversationIdentifier.mockResolvedValueOnce(address);
    expect(await inspectConversationTarget(account, target)).toEqual({
      kind: "conversation-address",
      address,
      teamName: team.name,
      postId: target.postId,
    });
  }
  account.resolveConversationIdentifier.mockResolvedValueOnce({
    kind: "unavailable",
  });
  expect(await inspectConversationTarget(account, target)).toEqual({
    kind: "unavailable",
  });
  expect(account.readNamedChannelDestination).not.toHaveBeenCalled();
});
test("stops on cancellation at each read and preserves transport errors", async () => {
  const account = fixture();
  for (const step of ["identifier", "destination"]) {
    const life = new AbortController();
    const reason = new Error("account closed");
    if (step === "identifier")
      account.resolveConversationIdentifier.mockImplementationOnce(async () => {
        life.abort(reason);
        return byId;
      });
    else
      account.readNamedChannelDestination.mockImplementationOnce(async () => {
        life.abort(reason);
        return found;
      });
    await expect(
      inspectConversationTarget(account, target, undefined, life.signal),
    ).rejects.toBe(reason);
    if (step === "identifier")
      expect(account.readNamedChannelDestination).not.toHaveBeenCalled();
  }
  const failure = new Error("session expired");
  account.readNamedChannelDestination.mockRejectedValueOnce(failure);
  await expect(inspectConversationTarget(account, target)).rejects.toBe(
    failure,
  );
});
