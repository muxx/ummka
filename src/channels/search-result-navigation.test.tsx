import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { channelProfile } from "../mattermost/channel-profiles.ts";
import "../empty-link-inbox.test-utils.ts";
import {
  bookmark,
  design,
  firstFile,
  fixture,
  home,
  other,
  reply,
  root,
  search,
  secondFile,
  summer,
  winter,
} from "./navigation-app.test-utils.tsx";

vi.mock("../mattermost/device-launch.ts", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("../mattermost/native-rest.ts", () => ({
  openAccountRestConnection: vi.fn(),
  getCurrentAccountId: vi.fn(),
}));
let nativeBack: (() => void) | undefined;
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async (pressed: () => void) => {
    nativeBack = pressed;
    return {
      unregister() {
        if (nativeBack === pressed) nativeBack = undefined;
      },
    };
  }),
}));
test.each([
  [true, root],
  [false, reply],
  [true, reply],
] as const)(
  "opens a search row at the exact published post and restores the originating draft %#",
  async (collapsed, target) => {
    const { account } = fixture({ collapsed });
    const results = await search();
    const trigger = await results.findByRole("button", {
      name: target === root ? "Search root snippet" : "Search reply snippet",
    });
    fireEvent.click(trigger);
    const row = await screen.findByText(target.message);
    await waitFor(() =>
      expect(document.activeElement).toBe(row.closest("article")),
    );
    expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
    expect(
      account.readChannelWindow.mock.calls.some(
        ([q]) => q.channelId === design && q.kind === "latest",
      ),
    ).toBe(false);
    if (collapsed && target === reply) {
      expect(
        screen.getByRole("complementary", { name: "Thread" }).contains(row),
      ).toBe(true);
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Reply in thread…",
          }).value,
        ).toBe("Unfinished reply"),
      );
    } else
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Message #Design…",
          }).value,
        ).toBe("Target draft"),
      );
    fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
    const restored = await screen.findByRole("button", {
      name: trigger.textContent ?? "",
    });
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: "Message #Home…",
        }).value,
      ).toBe("Original unfinished draft"),
    );
    expect(document.activeElement).toBe(restored);
  },
);
test.each([root, reply])(
  "one Escape from an addressed post restores its search row",
  async (target) => {
    const { account } = fixture();
    const results = await search();
    const action = {
      name: target === root ? "Search root snippet" : "Search reply snippet",
    };
    fireEvent.click(await results.findByRole("button", action));
    const addressed = await screen.findByText(target.message);
    await waitFor(() =>
      expect(document.activeElement).toBe(addressed.closest("article")),
    );
    fireEvent.keyDown(addressed, { key: "Escape" });
    const restored = await screen.findByRole("button", action);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: "Message #Home…",
        }).value,
      ).toBe("Original unfinished draft"),
    );
  },
);

test("a thread opened manually above an addressed channel closes before returning to search", async () => {
  fixture();
  const results = await search();
  const action = { name: "Search root snippet" };
  fireEvent.click(await results.findByRole("button", action));
  const addressed = (await screen.findByText(root.message)).closest("article");
  if (!addressed) throw Error("Expected the addressed row");
  fireEvent.click(
    within(addressed).getByRole("button", { name: /Open thread/ }),
  );
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  fireEvent.keyDown(thread, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(screen.queryByRole("button", action)).toBeNull();
  expect(screen.getByRole("button", { name: "Back to results" })).toBeTruthy();
  fireEvent.keyDown(addressed, { key: "Escape" });
  const restored = await screen.findByRole("button", action);
  await waitFor(() => expect(document.activeElement).toBe(restored));
});

test("the compact destination keeps a visible way back when its channel disappears", async () => {
  const { account } = fixture();
  const results = await search();
  const action = { name: "Search reply snippet" };
  fireEvent.click(await results.findByRole("button", action));
  await screen.findByText(reply.message);
  const read = account.readTeamSidebar.getMockImplementation();
  if (!read) throw Error("Fixture needs a saved sidebar");
  account.readTeamSidebar.mockImplementation(async (team) => {
    const saved = await read(team);
    return {
      ...saved,
      data: {
        ...saved.data,
        channels: saved.data.channels.filter((row) => row.id !== design),
      },
    };
  });
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(screen.queryByText(reply.message)).toBeNull());
    const back = screen.getByRole("button", { name: "Back to results" });
    expect(back.closest(".channels-panes")?.getAttribute("data-page")).toBe(
      "conversation",
    );
    expect(
      within(screen.getByRole("main")).getByText(
        "This content is no longer available to your account.",
      ),
    ).toBeTruthy();
    fireEvent.click(back);
    const restored = await screen.findByRole("button", action);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
  } finally {
    online.mockRestore();
  }
});
test("restores the second file for one post and keeps bookmarks without a post action", async () => {
  const { account } = fixture();
  const results = await search();
  fireEvent.click(await results.findByRole("button", { name: "Files" }));
  await results.findByText("bookmark.pdf");
  expect(
    results.queryByRole("button", {
      name: "Show message with file bookmark.pdf",
    }),
  ).toBeNull();
  fireEvent.click(results.getByRole("button", { name: "Load more" }));
  fireEvent.click(
    await results.findByRole("button", {
      name: "Show message with file second.pdf",
    }),
  );
  await screen.findByText(root.message);
  expect(account.readFileAnchor.mock.calls[0]?.[0]).toBe(secondFile);
  fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
  const target = await screen.findByRole("button", {
    name: "Show message with file second.pdf",
  });
  await waitFor(() => expect(document.activeElement).toBe(target));
  expect(account.readFileSearchPage).toHaveBeenCalledTimes(2);
  expect(account.rememberTeamSearch).toHaveBeenCalledTimes(1);
});
test("a result in another team survives replacement of the Channels workspace and closes its old search", async () => {
  const { account } = fixture({ cross: true });
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  const row = await screen.findByText(root.message);
  await waitFor(() =>
    expect(document.activeElement).toBe(row.closest("article")),
  );
  expect(account.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(summer);
  expect(screen.getByRole("button", { name: /team, Summer/i })).toBeTruthy();
  expect(screen.queryByText("Back to results")).toBeNull();
  expect(
    account.refreshChannelHistory.mock.calls
      .flat()
      .some((q) => q.channelId === other),
  ).toBe(false);
});
test.each(["deleted", "archived", "unattached"] as const)(
  "a %s result leaves its origin available",
  async (reason) => {
    const { account } = fixture();
    const results = await search();
    let button: HTMLElement;
    if (reason === "unattached") {
      account.readFileAnchor.mockResolvedValueOnce({
        fileId: firstFile,
        channelId: design,
        postId: null,
      });
      fireEvent.click(await results.findByRole("button", { name: "Files" }));
      button = await results.findByRole("button", {
        name: "Show message with file first.pdf",
      });
    } else {
      account.readPostAnchor.mockRejectedValueOnce(
        new ResponseError(
          new Response(null, {
            status: reason === "deleted" ? 404 : 403,
            headers:
              reason === "archived"
                ? { "first-inaccessible-post-time": "1" }
                : {},
          }),
        ),
      );
      button = await results.findByRole("button", {
        name: "Search root snippet",
      });
    }
    fireEvent.click(button);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("alert").textContent).toMatch(
      reason === "deleted"
        ? /deleted/
        : reason === "archived"
          ? /history/
          : /no longer attached/,
    );
    fireEvent.click(dialog.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  },
);
test("private consent can be dismissed before joining and a confirmed join opens the fresh message", async () => {
  const { account, targetInfo } = fixture();
  const unjoined = {
    ...targetInfo,
    channel: { ...targetInfo.channel, kind: "P" as const, joined: false },
  };
  account.readPostDestination.mockResolvedValue(unjoined);
  const results = await search(),
    row = await results.findByRole("button", { name: "Search root snippet" });
  fireEvent.click(row);
  const first = within(await screen.findByRole("dialog"));
  await act(async () =>
    fireEvent.click(first.getByRole("button", { name: "Cancel" })),
  );
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
  fireEvent.click(row);
  const prompt = within(await screen.findByRole("dialog"));
  account.changeOwnMembership.mockImplementationOnce(async () => {
    account.readPostDestination.mockResolvedValue(targetInfo);
    return { kind: "applied" };
  });
  fireEvent.click(prompt.getByRole("button", { name: "Join and open" }));
  await screen.findByText(root.message);
  expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
    { kind: "channel", id: design },
    "join",
  );
});
test("manual channel selection cancels a delayed result, including a late 401", async () => {
  const { account } = fixture();
  let reject!: (reason: unknown) => void;
  account.readPostAnchor.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Third channel" }));
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(account.signOutOnDevice).not.toHaveBeenCalled();
  expect(screen.queryByText(root.message)).toBeNull();
  expect(screen.getByRole("heading", { name: "Third channel" })).toBeTruthy();
});

test("only the selected account’s joined direct conversation can open within its current team", async () => {
  const { account, targetInfo } = fixture({ direct: true });
  const info = {
    postId: root.id,
    team: null,
    channel: { ...targetInfo.channel, kind: "D" as const, joined: false },
  };
  account.readPostDestination.mockResolvedValue(info);
  const results = await search(),
    button = await results.findByRole("button", {
      name: "Search root snippet",
    });
  fireEvent.click(button);
  const deny = within(await screen.findByRole("dialog"));
  expect(deny.getByRole("alert").textContent).toMatch(/unavailable/);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(deny.getByRole("button", { name: "OK" })),
  );
  account.readPostDestination.mockResolvedValue({
    ...info,
    channel: { ...info.channel, joined: true },
  });
  fireEvent.click(button);
  const row = await screen.findByText(root.message);
  await waitFor(() =>
    expect(document.activeElement).toBe(row.closest("article")),
  );
  expect(account.selectSidebarChannel).toHaveBeenCalledExactlyOnceWith(
    winter,
    design,
  );
  expect(account.selectJoinedTeam).not.toHaveBeenCalled();
});
test("offline results remain readable and only a new explicit online activation reads the target", async () => {
  const { account } = fixture();
  const results = await search();
  const row = await results.findByRole("button", {
    name: "Search root snippet",
  });
  const online = vi.spyOn(navigator, "onLine", "get");
  try {
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(account.readPostAnchor).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(account.readPostDestination).not.toHaveBeenCalled();
    fireEvent.click(row);
    await screen.findByText(root.message);
    expect(account.readPostDestination).toHaveBeenCalledTimes(1);
  } finally {
    online.mockRestore();
  }
});
test("repeated activation shares one request and a different result supersedes a late session error", async () => {
  const { account } = fixture();
  let fail!: (error: unknown) => void;
  account.readPostAnchor.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const results = await search();
  const old = await results.findByRole("button", {
    name: "Search root snippet",
  });
  fireEvent.click(old);
  fireEvent.click(old);
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(
    results.getByRole("button", { name: "Search reply snippet" }),
  );
  const row = await screen.findByText(reply.message);
  await act(async () =>
    fail(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(document.activeElement).toBe(row.closest("article"));
  expect(account.signOutOnDevice).not.toHaveBeenCalled();
});
test("the destination adopts newly published membership while the source sidebar still lacks the joined channel", async () => {
  const { account, targetInfo } = fixture();
  const original = account.readTeamSidebar.getMockImplementation();
  if (!original) throw Error("Fixture sidebar required");
  let published = false;
  account.readTeamSidebar.mockImplementation(async (team) => {
    const snapshot = await original(team);
    return published
      ? snapshot
      : {
          ...snapshot,
          data: {
            ...snapshot.data,
            channels: snapshot.data.channels.filter(
              (item) => item.id !== design,
            ),
          },
        };
  });
  const results = await search();
  const refreshes = account.refreshTeamSidebar.mock.calls.length;
  account.readPostDestination.mockResolvedValueOnce({
    ...targetInfo,
    channel: { ...targetInfo.channel, joined: false },
  });
  account.refreshTeamSidebar.mockImplementationOnce(async () => {
    published = true;
    return true;
  });
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await screen.findByText(root.message);
  expect(await screen.findByText("You joined the channel.")).toBeTruthy();
  expect(account.refreshTeamSidebar).toHaveBeenCalledTimes(refreshes + 1);
});

test("an accepted team join followed by a server refusal reports both outcomes without switching teams", async () => {
  const { account, targetInfo } = fixture({ cross: true });
  const outside = {
    ...targetInfo,
    team: { ...targetInfo.team, joined: false },
    channel: { ...targetInfo.channel, joined: false, kind: "P" as const },
  };
  account.readPostDestination.mockResolvedValue(outside);
  account.changeOwnMembership.mockImplementation(async (membership) => {
    if (membership.kind === "team") {
      account.readPostDestination.mockResolvedValue({
        ...outside,
        team: targetInfo.team,
      });
      return { kind: "applied" };
    }
    return {
      kind: "refused",
      refusal: {
        status: 403,
        code: "channel.join.denied",
        message: "Channel invitation required",
      },
    };
  });
  const results = await search();
  const button = await results.findByRole("button", {
    name: "Search root snippet",
  });
  fireEvent.click(button);
  const prompt = within(await screen.findByRole("dialog"));
  fireEvent.click(prompt.getByRole("button", { name: "Join and open" }));
  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toContain("You joined the team.");
  expect(notice.textContent).toContain("Channel invitation required");
  expect(account.selectJoinedTeam).not.toHaveBeenCalled();
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(document.activeElement).toBe(button));
});
test("manually switching teams while a result is being verified keeps the new team after a late unauthorized response", async () => {
  const { account } = fixture();
  let reject!: (reason: unknown) => void;
  account.readPostAnchor.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: /team, Winter/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Summer/i }));
  await screen.findByRole("button", { name: /team, Summer/i });
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(
    screen.queryByRole("complementary", { name: "Search results" }),
  ).toBeNull();
  expect(screen.getByRole("heading", { name: "Other" })).toBeTruthy();
  expect(account.signOutOnDevice).not.toHaveBeenCalled();
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
});

test("Back while joining keeps ownership with the waiting dialog after the submit button disappears", async () => {
  const { account, targetInfo } = fixture();
  account.readPostDestination.mockResolvedValue({
    ...targetInfo,
    channel: { ...targetInfo.channel, kind: "P", joined: false },
  });
  let finish!: (value: { kind: "applied" }) => void;
  const joining = new Promise<{ kind: "applied" }>((resolve) => {
    finish = resolve;
  });
  account.changeOwnMembership.mockReturnValueOnce(joining);
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  const button = within(await screen.findByRole("dialog")).getByRole("button", {
    name: "Join and open",
  });
  button.focus();
  fireEvent.click(button);
  const waiting = await screen.findByRole("dialog", { name: "Joining…" });
  await waitFor(() =>
    expect(account.changeOwnMembership).toHaveBeenCalledTimes(1),
  );
  expect(waiting.contains(document.activeElement)).toBe(false);
  if (process.env.TAURI_ENV_PLATFORM === "android") {
    expect(nativeBack).toBeTypeOf("function");
    act(() => nativeBack?.());
  } else fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Joining…" })).toBe(waiting);
  expect(
    screen.getByRole("complementary", { name: "Search results" }),
  ).toBeTruthy();
  account.readPostDestination.mockResolvedValue(targetInfo);
  await act(async () => finish({ kind: "applied" }));
  await screen.findByText(root.message);
  expect(account.changeOwnMembership).toHaveBeenCalledTimes(1);
});

test.each([root, reply])(
  "opens a saved root or collapsed reply by ID, then returns to its scroll position and channel draft $id",
  async (target) => {
    const { account } = fixture();
    const trigger = await screen.findByRole("button", {
      name: "Saved messages",
    });
    fireEvent.click(trigger);
    const pane = await screen.findByRole("complementary", {
      name: "Saved messages",
    });
    const title =
      target === root ? "Saved root preview" : "Saved reply preview";
    const button = await within(pane).findByRole("button", {
      name: new RegExp(title),
    });
    expect(within(pane).getAllByRole("listitem")[0].textContent).toContain(
      "Saved reply preview",
    );
    expect(within(pane).getByText("Pinned")).toBeTruthy();
    const scroll = pane.querySelector(".collection-rows") as HTMLElement;
    scroll.scrollTop = 17;
    fireEvent.click(button);
    const post = await screen.findByText(target.message);
    if (target === reply)
      expect(
        screen.getByRole("complementary", { name: "Thread" }).contains(post),
      ).toBe(true);
    expect(account.readPostAnchor).toHaveBeenCalledWith(
      target.id,
      expect.any(AbortSignal),
    );
    if (target === root)
      fireEvent.click(
        screen.getByRole("button", { name: "Back to saved messages" }),
      );
    else fireEvent.keyDown(window, { key: "Escape" });
    const restored = await screen.findByRole("button", {
      name: new RegExp(title),
    });
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(restored.closest(".collection-rows")?.scrollTop).toBe(17);
    expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
    const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Home…",
    });
    await waitFor(() => expect(draft.value).toBe("Original unfinished draft"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  },
);

test("opens pins in the selected channel, distinguishes a confirmed personal mark, and forgets it after unsaving", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  fireEvent.click(trigger);
  await screen.findByText("Saved root preview");
  const menu = screen.getByRole("button", { name: "Channel menu, Home" });
  const pins = async () => {
    fireEvent.click(menu);
    const item = screen.getByRole("button", { name: "Pinned messages" });
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    return within(
      await screen.findByRole("complementary", { name: "Pinned messages" }),
    );
  };
  let opened = await pins();
  await opened.findByText("Home pin");
  expect(opened.getByText("Saved by you")).toBeTruthy();
  expect(account.readPinnedChannelPosts).toHaveBeenCalledWith(
    home,
    expect.any(AbortSignal),
  );
  expect(
    opened.getByRole("button", { name: "Unpin for everyone" }),
  ).toBeTruthy();
  fireEvent.click(opened.getByRole("button", { name: "Close collection" }));
  expect(document.activeElement).toBe(menu);
  fireEvent.click(trigger);
  const row = (await screen.findByText("Saved root preview")).closest(
    "li",
  ) as HTMLElement;
  const remove = within(row).getByRole("button", { name: "Remove from saved" });
  remove.focus();
  fireEvent.click(remove);
  await waitFor(() => expect(row.isConnected).toBe(false));
  expect(account.setPostSaved).toHaveBeenCalledWith(
    root.id,
    false,
    expect.any(AbortSignal),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Remove from saved" }),
  );
  opened = await pins();
  await opened.findByText("Home pin");
  expect(opened.queryByText("Saved by you")).toBeNull();
  expect(account.setPostPinned).not.toHaveBeenCalled();
  account.setPostPinned.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  const action = opened.getByRole("button", { name: "Unpin for everyone" });
  fireEvent.click(action);
  expect(await opened.findByRole("alert")).toBeTruthy();
  expect(opened.getByText("Home pin")).toBeTruthy();
  fireEvent.click(action);
  await opened.findByText("No pinned messages in this channel.");
  expect(account.setPostPinned).toHaveBeenCalledTimes(2);
});

test.each(["saved", "pins"] as const)(
  "a cold offline %s collection can be retried explicitly and keeps focus through failure and success",
  async (kind) => {
    const { account } = fixture();
    const trigger = await screen.findByRole("button", {
      name: "Saved messages",
    });
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      act(() => window.dispatchEvent(new Event("offline")));
      if (kind === "saved") fireEvent.click(trigger);
      else {
        fireEvent.click(
          screen.getByRole("button", { name: "Channel menu, Home" }),
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Pinned messages" }),
        );
      }
      const name = kind === "saved" ? "Saved messages" : "Pinned messages";
      const pane = within(await screen.findByRole("complementary", { name }));
      const read =
        kind === "saved"
          ? account.readSavedPosts
          : account.readPinnedChannelPosts;
      expect(read).not.toHaveBeenCalled();
      read.mockRejectedValueOnce(new TypeError("Disconnected"));
      let retry = await pane.findByRole("button", { name: "Try again" });
      retry.focus();
      fireEvent.click(retry);
      await pane.findByRole("alert");
      expect(document.activeElement).toBe(pane.getByRole("heading", { name }));
      retry = pane.getByRole("button", { name: "Try again" });
      retry.focus();
      fireEvent.click(retry);
      const label = kind === "saved" ? "Saved root preview" : "Home pin";
      const row = await pane.findByRole("button", { name: new RegExp(label) });
      expect(document.activeElement).toBe(pane.getByRole("heading", { name }));
      expect(row.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(row);
      expect(account.readPostAnchor).not.toHaveBeenCalled();
      online.mockReturnValue(true);
      act(() => window.dispatchEvent(new Event("online")));
      expect(account.readPostAnchor).not.toHaveBeenCalled();
      fireEvent.click(row);
      await waitFor(() =>
        expect(account.readPostAnchor).toHaveBeenCalledOnce(),
      );
    } finally {
      online.mockRestore();
    }
  },
);

test("a saved direct message keeps its known location when absent from the sidebar", async () => {
  const { account } = fixture({ direct: true });
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  const peer = "z".repeat(26);
  account.readSavedProfiles.mockResolvedValue({
    profiles: { [peer]: channelProfile({ id: peer, username: "aurora" }) },
    usernames: {},
  });
  fireEvent.click(trigger);
  const saved = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  expect(await saved.findByText("aurora · direct message")).toBeTruthy();
  expect(
    saved.getByText("aurora · direct message · reply in thread"),
  ).toBeTruthy();
});

test("labels empty published bodies and attachments in saved rows", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  account.readSavedPosts.mockResolvedValueOnce({
    items: [
      { id: root.id, channelId: design, message: "---" },
      { id: reply.id, channelId: design, message: "", fileIds: [bookmark] },
    ],
    firstInaccessiblePostTime: 0,
  });
  fireEvent.click(trigger);
  const pane = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  expect(await pane.findByText("Attachment")).toBeTruthy();
  expect(pane.getByText("Message")).toBeTruthy();
});

test("a hidden saved page remains traversable, preserves the previous rows on retry, and discards a revoked response", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  account.readSavedPostUpperBound.mockResolvedValue(121);
  account.readSavedPostsAtOffset
    .mockResolvedValueOnce({ items: [], firstInaccessiblePostTime: 0 })
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce({
      items: [{ id: bookmark, channelId: design, message: "Oldest visible" }],
      firstInaccessiblePostTime: 1,
    });
  let onVisible: (() => void) | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private readonly notify: (
          rows: { isIntersecting: boolean; intersectionRatio: number }[],
        ) => void,
      ) {}
      observe(el: Element) {
        if (el.classList.contains("collection-edge"))
          onVisible = () =>
            this.notify([{ isIntersecting: true, intersectionRatio: 1 }]);
      }
      disconnect() {}
    },
  );
  fireEvent.click(trigger);
  const pane = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  await pane.findByText("Earlier saved messages haven’t loaded yet.");
  await waitFor(() => expect(onVisible).toBeTypeOf("function"));
  await act(async () => onVisible?.());
  await waitFor(() =>
    expect(account.readSavedPostsAtOffset).toHaveBeenCalledTimes(1),
  );
  await act(async () => onVisible?.());
  await pane.findByRole("alert");
  expect(pane.getByText("Saved reply preview")).toBeTruthy();
  fireEvent.click(
    pane.getByRole("button", { name: "Retry loading earlier saved messages" }),
  );
  await pane.findByText("Oldest visible");
  expect(
    pane.queryByText("Earlier saved messages haven’t loaded yet."),
  ).toBeNull();
  expect(
    account.readSavedPostsAtOffset.mock.calls.map(([, offset]) => offset),
  ).toEqual([60, 120, 120]);
  expect(account.readSavedPostUpperBound).toHaveBeenCalledTimes(1);
  account.readSavedPosts.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  fireEvent.click(pane.getByRole("button", { name: "Refresh" }));
  await pane.findByText("This collection is no longer available.");
  expect(pane.queryByText("Saved root preview")).toBeNull();
  expect(pane.queryByText("Oldest visible")).toBeNull();
});

test("archived channels show the pinned messages and keep the shared action hidden", async () => {
  const { account } = fixture({ archivedHome: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Channel menu, Home" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
  const pins = within(
    await screen.findByRole("complementary", { name: "Pinned messages" }),
  );
  await pins.findByText("Home pin");
  expect(pins.queryByRole("button", { name: "Unpin for everyone" })).toBeNull();
  expect(account.setPostPinned).not.toHaveBeenCalled();
});

test("closing the collection cancels its pending read including a late unauthorized response", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  let fail!: (error: Error) => void;
  account.readSavedPosts.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  fireEvent.click(trigger);
  const pane = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  await pane.findByText("Loading messages…");
  await waitFor(() => expect(account.readSavedPosts).toHaveBeenCalledTimes(1));
  const signal = account.readSavedPosts.mock.calls[0][2];
  fireEvent.click(pane.getByRole("button", { name: "Close collection" }));
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    fail(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Channel menu, Home" }),
  ).toBeTruthy();
});

test("the channel heading can receive WebKit's pointer focus before a pin-menu click", async () => {
  fixture();
  const menu = await screen.findByRole("button", {
    name: "Channel menu, Home",
  });
  fireEvent.click(menu);
  const item = screen.getByRole("button", { name: "Pinned messages" });
  fireEvent.pointerDown(item);
  fireEvent.mouseDown(item);
  const heading = screen.getByRole("heading", { level: 1, name: "Home" });
  heading.focus();
  expect(item.isConnected).toBe(true);
  fireEvent.mouseUp(item);
  fireEvent.click(item);
  expect(
    await screen.findByRole("complementary", { name: "Pinned messages" }),
  ).toBeTruthy();
});
