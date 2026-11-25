import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { inspectPostTarget } from "./inspect-post-target.ts";

const fileId = "f".repeat(26),
  postId = "p".repeat(26),
  channelId = "c".repeat(26),
  teamId = "t".repeat(26),
  rootId = "r".repeat(26);
const source = { kind: "post", id: postId } as const,
  fileSource = { kind: "file", id: fileId } as const;
const reply = {
  id: postId,
  channelId,
  rootId,
  userId: "u".repeat(26),
  createAt: 101,
  updateAt: 101,
  editAt: 0,
  type: "",
  message: "Selected search reply",
  messageSource: null,
  hashtags: "",
  isPinned: false,
};
const channel = {
  id: channelId,
  kind: "O",
  joined: true,
  displayName: "Releases",
} as const;
const team = {
  id: teamId,
  kind: "O",
  joined: true,
  displayName: "Polar",
} as const;
type Account = Parameters<typeof inspectPostTarget>[0];
function fixture() {
  return {
    readFileAnchor: vi
      .fn<Account["readFileAnchor"]>()
      .mockResolvedValue({ fileId, channelId, postId }),
    readPostDestination: vi
      .fn<Account["readPostDestination"]>()
      .mockResolvedValue({ postId, channel, team }),
    readPostAnchor: vi
      .fn<Account["readPostAnchor"]>()
      .mockResolvedValue({ postId, channelId, rootId, post: reply }),
  };
}

test("does not request an invalid destination or selected team", async () => {
  const account = fixture();
  await expect(
    inspectPostTarget(account, { kind: "post", id: "" }, null),
  ).rejects.toBeInstanceOf(TypeError);
  await expect(
    inspectPostTarget(account, fileSource, "no"),
  ).rejects.toBeInstanceOf(TypeError);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  expect(account.readFileAnchor).not.toHaveBeenCalled();
});

test("a post or an attached file resolves to the same exact reply in its own team", async () => {
  for (const input of [source, fileSource]) {
    const account = fixture(),
      signal = new AbortController().signal;
    expect(await inspectPostTarget(account, input, null, signal)).toEqual({
      kind: "ready",
      postId,
      rootId,
      channelId,
      teamId,
      post: reply,
    });
    expect(account.readPostDestination).toHaveBeenCalledExactlyOnceWith(
      postId,
      signal,
    );
    expect(account.readPostAnchor).toHaveBeenCalledExactlyOnceWith(
      postId,
      signal,
    );
    if (input.kind === "file") {
      expect(account.readFileAnchor).toHaveBeenCalledExactlyOnceWith(
        fileId,
        signal,
      );
      expect(account.readFileAnchor).toHaveBeenCalledBefore(
        account.readPostDestination,
      );
    } else expect(account.readFileAnchor).not.toHaveBeenCalled();
    expect(account.readPostDestination).toHaveBeenCalledBefore(
      account.readPostAnchor,
    );
  }
});

test("a standalone file stops before a membership read", async () => {
  const account = fixture();
  account.readFileAnchor.mockResolvedValue({ fileId, channelId, postId: null });
  expect(await inspectPostTarget(account, fileSource, teamId)).toEqual({
    kind: "unattachedFile",
  });
  expect(account.readPostDestination).not.toHaveBeenCalled();
  expect(account.readPostAnchor).not.toHaveBeenCalled();
});

test("a deleted post is unavailable through either its permalink or its file", async () => {
  for (const input of [source, fileSource]) {
    const account = fixture();
    account.readPostAnchor.mockResolvedValueOnce({
      postId,
      channelId,
      post: null,
    });
    expect(await inspectPostTarget(account, input, teamId)).toEqual({
      kind: "unavailable",
    });
  }
});

test("requires membership or a team selection before requesting post content", async () => {
  type Destination = Awaited<ReturnType<Account["readPostDestination"]>>;
  const privateChannel = { ...channel, kind: "P", joined: false } as const;
  const unjoinedTeam = { ...team, joined: false };
  const cases: [Destination, object][] = [
    [
      { postId, team: unjoinedTeam, channel: privateChannel },
      { kind: "joinTeam", team: unjoinedTeam, channel: privateChannel },
    ],
    [
      { postId, team, channel: privateChannel },
      { kind: "confirmPrivateChannel", team, channel: privateChannel },
    ],
    [
      { postId, team, channel: { ...channel, joined: false } },
      { kind: "joinChannel", team, channel: { ...channel, joined: false } },
    ],
    [
      { postId, team: null, channel: { ...channel, kind: "D" } },
      { kind: "selectTeam" },
    ],
    [
      { postId, team: null, channel: { ...channel, kind: "G", joined: false } },
      { kind: "unavailable" },
    ],
  ];
  for (const [destination, result] of cases) {
    const account = fixture();
    account.readPostDestination.mockResolvedValue(destination);
    expect(await inspectPostTarget(account, source, null)).toEqual(result);
    expect(account.readPostAnchor).not.toHaveBeenCalled();
  }
});

test("discards mismatched channels and checks cancellation between reads", async () => {
  const account = fixture(),
    different = "d".repeat(26);
  account.readFileAnchor.mockResolvedValueOnce({
    fileId,
    postId,
    channelId: different,
  });
  await expect(
    inspectPostTarget(account, fileSource, null),
  ).rejects.toBeInstanceOf(TypeError);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  account.readPostAnchor.mockResolvedValueOnce({
    postId,
    channelId: different,
    rootId: null,
    post: { ...reply, channelId: different, rootId: null },
  });
  await expect(inspectPostTarget(account, source, null)).rejects.toBeInstanceOf(
    TypeError,
  );
  const controller = new AbortController();
  account.readFileAnchor.mockImplementationOnce(async () => {
    controller.abort("left search");
    return { fileId, channelId, postId };
  });
  account.readPostDestination.mockClear();
  await expect(
    inspectPostTarget(account, fileSource, null, controller.signal),
  ).rejects.toBe("left search");
  expect(account.readPostDestination).not.toHaveBeenCalled();
});

test("cancelling while reading the post discards the completed target", async () => {
  const account = fixture();
  const controller = new AbortController();
  account.readPostAnchor.mockImplementationOnce(async () => {
    controller.abort("left search");
    return { postId, channelId, rootId, post: reply };
  });
  await expect(
    inspectPostTarget(account, source, teamId, controller.signal),
  ).rejects.toBe("left search");
});

test.each(["file", "destination", "post"] as const)(
  "recognizes only the relevant retention header during %s",
  async (stage) => {
    for (const [status, header, value, expected] of [
      [404, "", "", "unavailable"],
      [401, "", "", null],
      [
        403,
        "first-inaccessible-file-time",
        "1",
        stage === "file" ? "archived" : null,
      ],
      [
        403,
        "first-inaccessible-post-time",
        "1",
        stage === "post" ? "archived" : null,
      ],
      [403, "first-inaccessible-post-time", "7", null],
    ] as const) {
      const account = fixture(),
        error = new ResponseError(
          new Response(null, {
            status,
            headers: header ? { [header]: value } : {},
          }),
        );
      const read =
        stage === "file"
          ? account.readFileAnchor
          : stage === "destination"
            ? account.readPostDestination
            : account.readPostAnchor;
      read.mockRejectedValueOnce(error);
      const result = inspectPostTarget(account, fileSource, teamId);
      if (expected) await expect(result).resolves.toEqual({ kind: expected });
      else await expect(result).rejects.toBe(error);
    }
  },
);
