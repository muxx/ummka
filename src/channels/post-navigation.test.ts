import { expect, test, vi } from "vitest";
import { openPostNavigation } from "./post-navigation.ts";

type Account = Parameters<typeof openPostNavigation>[0];
type Destination = Awaited<ReturnType<Account["readPostDestination"]>>;
const postId = "p".repeat(26),
  channelId = "c".repeat(26),
  teamId = "t".repeat(26);
const source = { kind: "post", id: postId } as const;
const team = {
  id: teamId,
  kind: "O",
  displayName: "Polar",
  joined: false,
} as const;
const channel = {
  id: channelId,
  kind: "O",
  displayName: "Releases",
  joined: false,
} as const;
const ownTeam = { ...team, joined: true },
  privateChannel = { ...channel, kind: "P" } as const;
const teamTarget = { kind: "team", id: teamId },
  channelTarget = { kind: "channel", id: channelId };
const root = { postId, channelId, rootId: null },
  ready = { kind: "ready", teamId, ...root };
function fixture(initial: Destination) {
  const account = {
    readPostDestination: vi
      .fn<Account["readPostDestination"]>()
      .mockResolvedValue(initial),
    readPostAnchor: vi.fn<Account["readPostAnchor"]>().mockResolvedValue(root),
    readFileAnchor: vi.fn<Account["readFileAnchor"]>(),
    changeOwnMembership: vi.fn<Account["changeOwnMembership"]>(),
  };
  const confirm = vi
    .fn<Parameters<typeof openPostNavigation>[3]>()
    .mockResolvedValue(true);
  const nav = openPostNavigation(account, source, teamId, confirm);
  return { account, confirm, nav };
}

test("one consent covers the named private channel and team, and double clicks share one attempt", async () => {
  const initial = { postId, team, channel: privateChannel };
  const { account, nav, confirm } = fixture(initial);
  account.changeOwnMembership.mockImplementation(async (target) => {
    account.readPostDestination.mockResolvedValue({
      postId,
      team: ownTeam,
      channel: { ...privateChannel, joined: target.kind === "channel" },
    });
    return { kind: "applied" };
  });
  const first = nav.open();
  expect(nav.open()).toBe(first);
  expect(await first).toEqual({
    target: ready,
    joined: [teamTarget, channelTarget],
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(account.changeOwnMembership.mock.calls).toEqual([
    [teamTarget, "join"],
    [channelTarget, "join"],
  ]);
});

test("joining a team may already have joined its default channel", async () => {
  const { nav, account } = fixture({ postId, team, channel });
  account.changeOwnMembership.mockImplementation(async () => {
    account.readPostDestination.mockResolvedValue({
      postId,
      team: ownTeam,
      channel: { ...channel, joined: true },
    });
    return { kind: "applied" };
  });
  expect(await nav.open()).toEqual({ target: ready, joined: [teamTarget] });
  expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
    teamTarget,
    "join",
  );
});

test("cancellation and target changes during consent leave membership alone", async () => {
  for (const change of [false, true]) {
    const { nav, account, confirm } = fixture({
      postId,
      team: ownTeam,
      channel: privateChannel,
    });
    confirm.mockImplementation(async () => {
      account.readPostDestination.mockResolvedValue({
        postId,
        team: ownTeam,
        channel: { ...privateChannel, id: "n".repeat(26) },
      });
      return change;
    });
    expect(await nav.open()).toEqual({
      target: { kind: change ? "destinationChanged" : "cancelled" },
      joined: [],
    });
    expect(account.changeOwnMembership).not.toHaveBeenCalled();
  }
});

test("a channel becoming private requires fresh consent", async () => {
  const { nav, account, confirm } = fixture({ postId, team, channel });
  confirm
    .mockImplementationOnce(async () => {
      account.readPostDestination.mockResolvedValue({
        postId,
        team,
        channel: privateChannel,
      });
      return true;
    })
    .mockResolvedValueOnce(false);
  expect(await nav.open()).toEqual({
    target: { kind: "cancelled" },
    joined: [],
  });
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
});

test("reports a confirmed team change even when the channel refuses membership", async () => {
  const { nav, account } = fixture({ postId, team, channel });
  const result = {
    kind: "refused",
    refusal: { status: 403, code: "fixture", message: null },
  } as const;
  account.changeOwnMembership
    .mockImplementationOnce(async () => {
      account.readPostDestination.mockResolvedValue({
        postId,
        team: ownTeam,
        channel,
      });
      return { kind: "applied" };
    })
    .mockResolvedValueOnce(result);
  expect(await nav.open()).toEqual({
    target: { kind: "membershipFailed", membership: channelTarget, result },
    joined: [teamTarget],
  });
  expect(account.changeOwnMembership.mock.calls).toEqual([
    [teamTarget, "join"],
    [channelTarget, "join"],
  ]);
});

test("never repeats an uncertain write or a confirmed write absent from a fresh read", async () => {
  for (const applied of [true, false]) {
    const { nav, confirm, account } = fixture({
      postId,
      team: ownTeam,
      channel,
    });
    account.changeOwnMembership.mockResolvedValue({
      kind: applied ? "applied" : "unconfirmed",
    });
    const reply = await nav.open();
    expect(reply.target.kind).toBe(
      applied ? "membershipUnconfirmed" : "membershipFailed",
    );
    expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
      channelTarget,
      "join",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(await nav.open()).toBe(reply);
  }
});

test("cancelling during the private-channel prompt sends no membership change", async () => {
  const { account } = fixture({
    postId,
    team: ownTeam,
    channel: privateChannel,
  });
  const controller = new AbortController();
  const nav = openPostNavigation(
    account,
    source,
    teamId,
    async () => {
      controller.abort("changed account");
      return true;
    },
    controller.signal,
  );
  await expect(nav.open()).rejects.toBe("changed account");
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
});

test("a new attempt reads current membership after an unconfirmed write", async () => {
  const { nav, account, confirm } = fixture({ postId, team: ownTeam, channel });
  account.changeOwnMembership.mockResolvedValueOnce({ kind: "unconfirmed" });
  expect((await nav.open()).target.kind).toBe("membershipFailed");
  account.readPostDestination.mockResolvedValue({
    postId,
    team: ownTeam,
    channel: { ...channel, joined: true },
  });
  const next = openPostNavigation(account, source, teamId, confirm);
  expect(await next.open()).toEqual({ target: ready, joined: [] });
  expect(account.changeOwnMembership).toHaveBeenCalledTimes(1);
});

test("reports the confirmed team when re-reading the destination loses its connection", async () => {
  const { nav, account } = fixture({ postId, team, channel });
  account.changeOwnMembership.mockImplementationOnce(async () => {
    account.readPostDestination.mockRejectedValue(
      new TypeError("Synthetic connection loss"),
    );
    return { kind: "applied" };
  });
  expect(await nav.open()).toEqual({
    target: { kind: "readFailed", reason: "network" },
    joined: [teamTarget],
  });
  expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
    teamTarget,
    "join",
  );
});

test("a retired account suppresses its pending navigation after joining", async () => {
  const { nav, account } = fixture({ postId, team, channel });
  account.changeOwnMembership.mockImplementationOnce(async () => {
    account.readPostDestination.mockRejectedValue("unknown_connection");
    return { kind: "applied" };
  });
  await expect(nav.open()).rejects.toBe("unknown_connection");
  expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
    teamTarget,
    "join",
  );
});
