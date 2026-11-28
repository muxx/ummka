import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountPostCollections } from "../mattermost/account-post-collections.ts";
import { accountSearch } from "../mattermost/account-search.ts";
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
  user,
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
    const targetLabel = {
      name: target === root ? "Search root snippet" : "Search reply snippet",
    };
    const trigger = await results.findByRole("button", targetLabel);
    const list = trigger.closest(".search-result-list");
    if (!list) throw Error("Expected the result's scroll container");
    list.scrollTop = 37;
    fireEvent.click(trigger);
    const row = await screen.findByText(target.message);
    await waitFor(() =>
      expect(document.activeElement).toBe(row.closest("article")),
    );
    expect(row.closest("article")?.hasAttribute("data-post-arrival")).toBe(
      true,
    );
    expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
    expect(
      account.readChannelWindow.mock.calls.some(
        ([q]) => q.channelId === design && q.kind === "latest",
      ),
    ).toBe(false);
    if (collapsed && target === reply) {
      const thread = screen.getByRole("complementary", { name: "Thread" });
      expect(thread.contains(row)).toBe(true);
      expect(
        within(thread).getByRole("heading", {
          name: "Thread",
          description: "# Design",
        }),
      ).toBeTruthy();
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
    const restored = await screen.findByRole("button", targetLabel);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(restored.closest(".search-result-list")?.scrollTop).toBe(37);
    expect(restored.getAttribute("aria-current")).toBe("true");
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
    if (!saved) return null;
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
    return published || !snapshot
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

test("an accepted team selection invalidates an older result before the queued sidebar write resumes", async () => {
  const { account } = fixture();
  const readAnchor = account.readPostAnchor.getMockImplementation();
  const selectTeam = account.selectJoinedTeam.getMockImplementation();
  if (!readAnchor || !selectTeam)
    throw Error("Missing the account fixture implementations");
  let finishAnchor!: () => void;
  let finishTeam!: () => void;
  account.readPostAnchor.mockImplementationOnce(
    (...args) =>
      new Promise((resolve) => {
        finishAnchor = () => resolve(readAnchor(...args));
      }),
  );
  account.selectJoinedTeam.mockImplementationOnce(
    (...args) =>
      new Promise((resolve) => {
        finishTeam = () => resolve(selectTeam(...args));
      }),
  );
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Switch team, Winter" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Teams and servers" })).getByRole(
      "button",
      { name: "Summer" },
    ),
  );
  await waitFor(() =>
    expect(account.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(summer),
  );

  const before = account.readTeamSidebar.mock.calls.length;
  await act(async () => finishAnchor());
  expect(account.readTeamSidebar).toHaveBeenCalledTimes(before + 1);
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  await act(async () => finishTeam());
  await screen.findByRole("heading", { name: "Other" });
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  expect(screen.queryByText(root.message)).toBeNull();
});

test.each([root, reply])(
  "a refused team selection preserves the addressed $id and its search return",
  async (target) => {
    const { account } = fixture();
    const result = {
      name: target === root ? "Search root snippet" : "Search reply snippet",
    };
    fireEvent.click(await (await search()).findByRole("button", result));
    const addressed = (await screen.findByText(target.message)).closest(
      "article",
    );
    await waitFor(() => expect(document.activeElement).toBe(addressed));
    const backToResults = screen.getByRole("button", {
      name: "Back to results",
    });
    let replyToWrite!: (accepted: boolean) => void;
    account.selectJoinedTeam.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          replyToWrite = resolve;
        }),
    );
    if (target === root) {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch team, Winter" }),
      );
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Account" }));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Teams and servers",
        }),
      );
    }
    const picker = within(
      screen.getByRole("dialog", { name: "Teams and servers" }),
    );
    const summerRow = picker.getByRole("button", { name: "Summer" });
    fireEvent.click(summerRow);
    await waitFor(() =>
      expect(account.selectJoinedTeam).toHaveBeenCalledWith(summer),
    );
    expect(addressed?.isConnected).toBe(true);
    expect(screen.queryByRole("button", { name: "Back to results" })).toBe(
      backToResults,
    );
    await act(async () => replyToWrite(false));
    expect(picker.getByRole("alert").textContent).toContain(
      "still in “Winter”",
    );
    expect(document.activeElement).toBe(summerRow);
    expect(addressed?.isConnected).toBe(true);
    fireEvent.click(picker.getByRole("button", { name: "Close team picker" }));
    expect(screen.getByRole("button", { name: "Back to results" })).toBe(
      backToResults,
    );
    fireEvent.click(backToResults);
    const original = await screen.findByRole("button", result);
    await waitFor(() => expect(document.activeElement).toBe(original));
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
    expect(
      (
        await screen.findByRole<HTMLTextAreaElement>("textbox", {
          name: "Message #Home…",
        })
      ).value,
    ).toBe("Original unfinished draft");
  },
);

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
    const item = screen.getByRole("menuitem", { name: "Pinned messages" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Conversation info" }),
    );
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
  expect(account.writeSavedPost).toHaveBeenCalledWith(
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
  expect(
    opened.getByRole("heading", {
      name: "Pinned messages",
      description: "# Home · visible to all members",
    }),
  ).toBeTruthy();
  expect(account.setPostPinned).toHaveBeenCalledTimes(2);
});

test("pins identify their source during first read and after a channel switch", async () => {
  const { account } = fixture();
  account.readPinnedChannelPosts.mockImplementationOnce(
    () => new Promise(() => {}),
  );
  account.readPinnedChannelPosts.mockResolvedValueOnce({
    items: [],
    firstInaccessiblePostTime: 0,
  });
  async function openPins(room: string) {
    fireEvent.click(
      await screen.findByRole("button", { name: `Channel menu, ${room}` }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Pinned messages" }));
    return within(
      screen.getByRole("complementary", { name: "Pinned messages" }),
    );
  }
  const initial = await openPins("Home");
  expect(initial.getByText("Loading messages…")).toBeTruthy();
  expect(document.activeElement).toBe(
    initial.getByRole("heading", {
      name: "Pinned messages",
      description: "# Home · visible to all members",
    }),
  );
  const signal = account.readPinnedChannelPosts.mock.calls[0]?.[1];
  fireEvent.click(screen.getByRole("button", { name: "Third channel" }));
  expect(signal?.aborted).toBe(true);
  expect(
    screen.queryByRole("complementary", { name: "Pinned messages" }),
  ).toBeNull();
  const next = await openPins("Third channel");
  await next.findByText("No pinned messages in this channel.");
  expect(
    next.getByRole("heading", {
      name: "Pinned messages",
      description: "# Third channel · visible to all members",
    }),
  ).toBeTruthy();
  expect(account.readPinnedChannelPosts.mock.calls.map(([id]) => id)).toEqual([
    home,
    other,
  ]);
  expect(account.readChannelIdentity).not.toHaveBeenCalled();
});

test.each([
  ["P", "# Home"],
  ["D", "aurora"],
  ["G", "Home"],
] as const)(
  "pins use the display name for conversation kind %s",
  async (homeKind, caption) => {
    const peer = "z".repeat(26);
    const { account } = fixture({
      homeKind,
      homeName: [user, peer].join("__"),
    });
    account.readSavedProfiles.mockResolvedValue({
      profiles: { [peer]: channelProfile({ id: peer, username: "aurora" }) },
      usernames: {},
    });
    const name = homeKind === "D" ? "aurora" : "Home";
    fireEvent.click(
      await screen.findByRole("button", { name: `Channel menu, ${name}` }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Pinned messages" }));
    expect(
      screen.getByRole("heading", {
        name: "Pinned messages",
        description: `${caption} · visible to all members`,
      }),
    ).toBeTruthy();
    expect(account.readChannelIdentity).not.toHaveBeenCalled();
  },
);

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
          screen.getByRole("menuitem", { name: "Pinned messages" }),
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
      { id: root.id, channelId: design, message: "---", cards: [] },
      {
        id: reply.id,
        channelId: design,
        message: "",
        fileIds: [bookmark],
        cards: [],
      },
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

test.each(["search", "saved"] as const)(
  "%s rejects a malformed result page before display and retries the same query with partial file details",
  async (source) => {
    const { account } = fixture();
    const fetchApi = vi.fn<typeof fetch>();
    const config = new Configuration({
      basePath: "https://fixture.test/site",
      fetchApi,
    });
    const named = {
      id: root.id,
      channel_id: design,
      message: "[note]: https://example.test",
      file_ids: [bookmark],
      metadata: {
        files: [
          {
            id: bookmark,
            post_id: root.id,
            channel_id: design,
            name: "verified.log",
          },
        ],
      },
    };
    const partial = {
      id: reply.id,
      channel_id: design,
      message: "",
      file_ids: [firstFile],
    };
    const page = (second: typeof partial & { metadata?: object }) =>
      Response.json({
        order: [root.id, reply.id],
        posts: { [root.id]: named, [reply.id]: second },
        matches: {},
        first_inaccessible_post_time: 0,
      });
    fetchApi
      .mockResolvedValueOnce(
        page({
          ...partial,
          message: "Visible text cannot mask a corrupt file",
          metadata: {
            files: [{ id: firstFile, post_id: root.id, name: "foreign.log" }],
          },
        }),
      )
      .mockResolvedValueOnce(page(partial));
    let panel: ReturnType<typeof within>;
    if (source === "search") {
      account.readPostSearchPage.mockImplementation(
        accountSearch(config, (read) => read()).readPostSearchPage,
      );
      panel = await search();
    } else {
      account.readSavedPosts.mockImplementation(
        accountPostCollections(config, user, (read) => read()).readSavedPosts,
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Saved messages" }),
      );
      panel = within(
        await screen.findByRole("complementary", { name: "Saved messages" }),
      );
    }
    const retry = await panel.findByRole("button", { name: "Try again" });
    expect(panel.queryByText("verified.log")).toBeNull();
    expect(panel.queryByText("foreign.log")).toBeNull();
    expect(
      panel.queryByText("Visible text cannot mask a corrupt file"),
    ).toBeNull();
    fireEvent.click(retry);
    expect(await panel.findByText("verified.log")).toBeTruthy();
    expect(
      panel.getByText(source === "search" ? "Attachment 1" : "Attachment"),
    ).toBeTruthy();
    expect(panel.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(fetchApi).toHaveBeenCalledTimes(2);
    const first = fetchApi.mock.calls[0],
      second = fetchApi.mock.calls[1];
    expect(second[0]).toEqual(first[0]);
    expect(second[1]?.body).toEqual(first[1]?.body);
  },
);

test("saved rows use the current card title and reveal an available filename after the cards are cleared", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  const source = {
    id: root.id,
    channelId: design,
    message: "",
    fileIds: [bookmark],
    attachments: {
      fileIds: [bookmark],
      files: [{ id: bookmark, name: "release-notes.txt" }],
    },
  };
  async function show(cards: [{ title: string; fields: [] }] | []) {
    account.readSavedPosts.mockResolvedValue({
      items: [{ ...source, cards }],
      firstInaccessiblePostTime: 0,
    });
    fireEvent.click(trigger);
    return within(
      await screen.findByRole("complementary", { name: "Saved messages" }),
    );
  }
  let pane = await show([{ title: "Original release", fields: [] }]);
  expect(await pane.findByText("Original release")).toBeTruthy();
  expect(pane.queryByText("release-notes.txt")).toBeNull();
  fireEvent.click(pane.getByRole("button", { name: "Close collection" }));
  pane = await show([{ title: "Updated release", fields: [] }]);
  expect(await pane.findByText("Updated release")).toBeTruthy();
  expect(pane.queryByText("Original release")).toBeNull();
  fireEvent.click(pane.getByRole("button", { name: "Close collection" }));
  pane = await show([]);
  expect(await pane.findByText("release-notes.txt")).toBeTruthy();
  expect(pane.queryByText("Updated release")).toBeNull();
});

test("a hidden saved page remains traversable, preserves the previous rows on retry, and discards a revoked response", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  account.readPreferences.mockResolvedValue({
    ids: new Set([root.id, reply.id, bookmark]),
    upperBound: 121,
  });
  account.readSavedPostsAtOffset
    .mockResolvedValueOnce({ items: [], firstInaccessiblePostTime: 0 })
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce({
      items: [
        {
          id: bookmark,
          channelId: design,
          message: "Oldest visible",
          cards: [],
        },
      ],
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
  expect(account.readPreferences).toHaveBeenCalledTimes(1);
  account.readSavedPosts.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  fireEvent.click(pane.getByRole("button", { name: "Close collection" }));
  fireEvent.click(trigger);
  const reopened = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  await reopened.findByText("This collection is no longer available.");
  expect(reopened.queryByText("Saved root preview")).toBeNull();
  expect(reopened.queryByText("Oldest visible")).toBeNull();
});

test.each([
  ["O", "Public channel", "Home"],
  ["P", "Private channel", "Home"],
  ["D", "Direct message", "Direct message"],
  ["G", "Group message", "Home"],
] as const)(
  "describes a %s conversation with no saved topic",
  async (homeKind, description, title) => {
    fixture({ homeKind, homeHeader: " \n " });
    const button = await screen.findByRole("button", {
      name: `Channel menu, ${title}`,
      description,
    });
    expect(button.closest("h1")?.getAttribute("aria-label")).toBe(title);
    expect(
      button
        .querySelector(".conversation-heading-mark")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  },
);

test("describes the known conversation with yourself through its channel identity", async () => {
  fixture({ homeKind: "D", homeName: `${user}__${user}` });
  expect(
    await screen.findByRole("button", {
      name: /^Channel menu,/,
      description: "Notes to yourself",
    }),
  ).toBeTruthy();
});

test("shows the saved topic as text and replaces it on conversation switch", async () => {
  const address = "https://example.test/releases";
  const topic = `Релиз Release · مرحباً · ${address}`;
  fixture({ homeHeader: `  Релиз Release \n مرحباً · ${address}  ` });
  const button = await screen.findByRole("button", {
    name: "Channel menu, Home",
    description: topic,
  });
  expect(
    within(button.closest("header") ?? document.body).queryByRole("link"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Third channel" }));
  expect(
    await screen.findByRole("button", {
      name: "Channel menu, Third channel",
      description: "Public channel",
    }),
  ).toBeTruthy();
  expect(screen.queryByText(topic)).toBeNull();
});

test("does not show conversation metadata while its sidebar is unavailable", async () => {
  const { account } = fixture({ homeHeader: "Private topic" });
  const read = account.readTeamSidebar.getMockImplementation();
  if (!read) throw Error("Expected a saved team sidebar fixture");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  account.readTeamSidebar.mockImplementation(async (team) => {
    await pending;
    return read(team);
  });
  await waitFor(() => expect(account.readTeamSidebar).toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "Home" })).toBeNull();
  expect(screen.queryByText("Private topic")).toBeNull();
  release();
  expect(
    await screen.findByRole("button", {
      name: "Channel menu, Home",
      description: "Private topic",
    }),
  ).toBeTruthy();
});

test.each(["O", "P", "G"] as const)(
  "opens personal notifications from an active %s channel title",
  async (homeKind) => {
    const { account } = fixture({ homeKind });
    fireEvent.click(
      await screen.findByRole("button", { name: /^Channel menu,/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Notifications" }));
    const form = within(
      await screen.findByRole("dialog", { name: "Notifications" }),
    );
    await form.findByRole("checkbox", {
      name: homeKind === "G" ? /Mute conversation/ : /Mute channel/,
    });
    expect(account.readChannelNotifications).toHaveBeenCalledWith(
      home,
      expect.any(AbortSignal),
    );
  },
);

test("opens channel information from the header, saves notifications and returns focus to each opener", async () => {
  const { account } = fixture();
  const info = await screen.findByRole("button", { name: "Channel info" });
  expect(account.readChannelMemberCount).not.toHaveBeenCalled();
  fireEvent.click(info);
  const panel = within(
    await screen.findByRole("complementary", { name: "About this channel" }),
  );
  await panel.findByText("7");
  const row = await panel.findByRole("button", {
    name: /Notifications.*Follows your account/,
  });
  fireEvent.click(row);
  const dialog = within(
    await screen.findByRole("dialog", { name: "Notifications" }),
  );
  fireEvent.click(
    await dialog.findByRole("checkbox", { name: /Mute channel/ }),
  );
  account.readChannelNotifications.mockResolvedValue({
    account: {},
    channel: { markUnread: "mention" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  expect(
    await panel.findByRole("button", { name: /Notifications.*Channel muted/ }),
  ).toBe(row);
  expect(document.activeElement).toBe(row);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen.queryByRole("complementary", { name: "About this channel" }),
  ).toBeNull();
  expect(document.activeElement).toBe(info);
  expect(account.readChannelMemberCount).toHaveBeenCalledOnce();
});

test.each([
  ["Channel menu, Home", "Conversation info"],
  ["Channel actions", "Info"],
])(
  "opens channel information from %s and restores its own button",
  async (name, item) => {
    const { account } = fixture();
    const opener = await screen.findByRole("button", { name });
    fireEvent.click(opener);
    const action = await screen.findByRole("menuitem", { name: item });
    expect(document.activeElement).toBe(action);
    expect(account.readChannelMemberCount).not.toHaveBeenCalled();
    expect(account.readChannelMemberDirectory).not.toHaveBeenCalled();
    expect(account.readFileSearchPage).not.toHaveBeenCalled();
    fireEvent.click(action);
    const about = await screen.findByRole("complementary", {
      name: "About this channel",
    });
    await within(about).findByText("7");
    expect(screen.queryByRole("menu")).toBeNull();
    const close = within(about).getByRole("button", {
      name: "Close channel info",
    });
    fireEvent.click(close);
    expect(document.activeElement).toBe(opener);
  },
);

test("pins opened from channel details restore the post, the pins action and the header in order", async () => {
  const { account } = fixture();
  fireEvent.click(await screen.findByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  account.readPinnedChannelPosts.mockResolvedValue({
    items: [
      {
        id: root.id,
        channelId: design,
        message: "Pinned project note",
        cards: [],
      },
    ],
    firstInaccessiblePostTime: 0,
  });
  const info = screen.getByRole("button", { name: "Channel info" });
  fireEvent.click(info);
  const open = await screen.findByRole("button", { name: "Pinned messages" });
  expect(account.readPinnedChannelPosts).not.toHaveBeenCalled();
  fireEvent.click(open);
  const pin = await screen.findByRole("button", {
    name: /Pinned project note/,
  });
  expect(screen.getByText("# Design · visible to all members")).toBeTruthy();
  fireEvent.click(pin);
  await screen.findByRole("button", { name: "Back to pinned messages" });
  const back = () => fireEvent.keyDown(window, { key: "Escape" });
  back();
  const restored = await screen.findByRole("button", {
    name: /Pinned project note/,
  });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  back();
  const action = await screen.findByRole("button", { name: "Pinned messages" });
  expect(document.activeElement).toBe(action);
  back();
  expect(document.activeElement).toBe(info);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Design…",
    }).value,
  ).toBe("Target draft");
});

test("closing an empty pins list restores details above an addressed search reply", async () => {
  const { account } = fixture();
  account.readPinnedChannelPosts.mockResolvedValue({
    items: [],
    firstInaccessiblePostTime: 0,
  });
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search reply snippet" }),
  );
  await screen.findByText(reply.message);
  fireEvent.click(screen.getByRole("button", { name: "Channel info" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Pinned messages" }),
  );
  await screen.findByText("No pinned messages in this channel.");
  fireEvent.click(screen.getByRole("button", { name: "Close collection" }));
  const pins = await screen.findByRole("button", { name: "Pinned messages" });
  expect(document.activeElement).toBe(pins);
  fireEvent.keyDown(window, { key: "Escape" });
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  expect(within(thread).getByText(reply.message)).toBeTruthy();
});

test("a refused pins read drops its return to channel details", async () => {
  const { account } = fixture();
  account.readPinnedChannelPosts.mockRejectedValue(
    new ResponseError(new Response(null, { status: 403 })),
  );
  const info = await screen.findByRole("button", { name: "Channel info" });
  fireEvent.click(info);
  fireEvent.click(
    await screen.findByRole("button", { name: "Pinned messages" }),
  );
  const list = await screen.findByRole("complementary", {
    name: "Pinned messages",
  });
  await within(list).findByRole("alert");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen.queryByRole("complementary", {
      name: /About this channel|Pinned messages/,
    }),
  ).toBeNull();
  expect(document.activeElement).toBe(info);
});

test("changing channels cancels the pins read and discards its return to the previous channel details", async () => {
  const { account } = fixture();
  account.readPinnedChannelPosts.mockImplementationOnce(
    () => new Promise(() => {}),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Channel info" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Pinned messages" }),
  );
  await waitFor(() =>
    expect(account.readPinnedChannelPosts).toHaveBeenCalledOnce(),
  );
  const signal = account.readPinnedChannelPosts.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  expect(signal?.aborted).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen.queryByRole("complementary", {
      name: /About this channel|Pinned messages/,
    }),
  ).toBeNull();
});

test("losing access while reading channel details moves focus to the access notice heading", async () => {
  const { account } = fixture();
  let denyHistory!: (e: Error) => void;
  account.refreshChannelHistory.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        denyHistory = reject;
      }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Channel info" }));
  const heading = await screen.findByRole("heading", {
    name: "About this channel",
  });
  expect(document.activeElement).toBe(heading);
  await waitFor(() => expect(denyHistory).toBeTypeOf("function"));
  await act(async () =>
    denyHistory(new ResponseError(new Response(null, { status: 403 }))),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Channel info" })).toBeNull(),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", {
      level: 1,
      name: "This content is no longer available to your account.",
    }),
  );
});

test("switching channels cancels both open detail reads and ignores their late results", async () => {
  const { account } = fixture();
  let finishCount!: (count: number) => void;
  let finishRule!: (
    rule: Awaited<ReturnType<typeof account.readChannelNotifications>>,
  ) => void;
  account.readChannelMemberCount.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCount = resolve;
      }),
  );
  account.readChannelNotifications.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRule = resolve;
      }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Channel info" }));
  await waitFor(() =>
    expect(account.readChannelNotifications).toHaveBeenCalledOnce(),
  );
  const oldCount = account.readChannelMemberCount.mock.calls[0][1];
  const oldRule = account.readChannelNotifications.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  expect(oldCount?.aborted).toBe(true);
  expect(oldRule?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Channel info" }));
  const panel = within(
    await screen.findByRole("complementary", { name: "About this channel" }),
  );
  await panel.findByText("7");
  await act(async () => {
    finishCount(99);
    finishRule({ account: {}, channel: { markUnread: "mention" } });
  });
  expect(panel.queryByText("99")).toBeNull();
  expect(
    panel.getByRole("button", { name: /Notifications.*Follows your account/ }),
  ).toBeTruthy();
});

test("revoked member statistics dismiss channel details and refresh the directory", async () => {
  const { account } = fixture();
  const info = await screen.findByRole("button", { name: "Channel info" });
  let rejectCount!: (reason: Error) => void;
  account.readChannelMemberCount.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectCount = reject;
      }),
  );
  fireEvent.click(info);
  await screen.findByRole("complementary", { name: "About this channel" });
  const refreshes = account.refreshTeamSidebar.mock.calls.length;
  await act(async () =>
    rejectCount(new ResponseError(new Response(null, { status: 403 }))),
  );
  await waitFor(() =>
    expect(account.refreshTeamSidebar.mock.calls.length).toBeGreaterThan(
      refreshes,
    ),
  );
  expect(
    screen.queryByRole("complementary", { name: "About this channel" }),
  ).toBeNull();
  expect(info.getAttribute("aria-expanded")).toBe("false");
});

test("a direct conversation keeps pins available and excludes channel notifications", async () => {
  const { account } = fixture({ homeKind: "D" });
  fireEvent.click(
    await screen.findByRole("button", { name: /^Channel menu,/ }),
  );
  expect(
    screen.getByRole("menuitem", { name: "Pinned messages" }),
  ).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Notifications" })).toBeNull();
  expect(account.readChannelNotifications).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Pinned messages" }));
  expect(
    screen.getByRole("heading", {
      name: "Pinned messages",
      description: "Visible to channel members",
    }),
  ).toBeTruthy();
});

test("revoked channel history closes its notifications and cancels the pending read", async () => {
  const { account } = fixture({ homeHeader: "Restricted topic" });
  let rejectRefresh!: (reason: Error) => void;
  account.refreshChannelHistory.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectRefresh = reject;
      }),
  );
  account.readChannelNotifications.mockImplementation(
    () => new Promise(() => {}),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Channel menu, Home",
      description: "Restricted topic",
    }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Notifications" }));
  await screen.findByRole("dialog", { name: "Notifications" });
  const signal = account.readChannelNotifications.mock.calls[0]?.[1];
  expect(signal?.aborted).toBe(false);
  await waitFor(() => expect(account.refreshChannelHistory).toHaveBeenCalled());
  await act(async () =>
    rejectRefresh(new ResponseError(new Response(null, { status: 403 }))),
  );
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Channel menu, Home" }),
  ).toBeNull();
  expect(screen.queryByRole("heading", { name: "Home" })).toBeNull();
  expect(screen.queryByText("Restricted topic")).toBeNull();
  expect(account.updateChannelNotifications).not.toHaveBeenCalled();
});

test("removing the selected channel from the joined sidebar closes its notification form", async () => {
  const { account } = fixture();
  fireEvent.click(
    await screen.findByRole("button", { name: "Channel menu, Home" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Notifications" }));
  const form = await screen.findByRole("dialog", { name: "Notifications" });
  await within(form).findByRole("checkbox", { name: /Mute channel/ });
  const before = await account.readTeamSidebar(winter);
  if (!before) throw Error("Fixture sidebar required");
  account.readTeamSidebar.mockResolvedValue({
    selectedChannel: null,
    data: { ...before.data, channels: [] },
  });
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(form.isConnected).toBe(false));
    expect(screen.queryByRole("button", { name: /^Channel menu,/ })).toBeNull();
    expect(account.updateChannelNotifications).not.toHaveBeenCalled();
  } finally {
    online.mockRestore();
  }
});

test("archived channels show the pinned messages and keep the shared action hidden", async () => {
  const { account } = fixture({
    archivedHome: true,
    homeHeader: "Previous topic",
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Channel menu, Home",
      description: "Archived channel",
    }),
  );
  expect(screen.queryByText("Previous topic")).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Notifications" })).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Pinned messages" }));
  const pins = within(
    await screen.findByRole("complementary", { name: "Pinned messages" }),
  );
  await pins.findByText("Home pin");
  expect(pins.queryByRole("button", { name: "Unpin for everyone" })).toBeNull();
  expect(account.setPostPinned).not.toHaveBeenCalled();
});

test.each(["Saved messages", "Pinned messages", "Mentions"])(
  "the compact %s header places Back before its heading and the scroll target after it",
  async (name) => {
    fixture();
    if (name === "Pinned messages") {
      fireEvent.click(
        await screen.findByRole("button", { name: "Channel menu, Home" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name }));
    } else {
      fireEvent.click(await screen.findByRole("button", { name }));
    }
    const pane = within(await screen.findByRole("complementary", { name }));
    const heading = pane.getByRole("heading", { name });
    const back = pane.getByRole("button", {
      name: name === "Mentions" ? "Close panel" : "Close collection",
    });
    const contents = pane.getByRole("region", { name: "Side panel contents" });
    expect(
      back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(contents) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(contents.tabIndex).toBe(0);
  },
);

test("reopening Saved keeps the previous rows through a failed refresh and retries with focus", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  fireEvent.click(trigger);
  const pane = () =>
    within(screen.getByRole("complementary", { name: "Saved messages" }));
  const options = { name: /Saved reply preview/ };
  await pane().findByRole("button", options);
  expect(pane().queryByRole("button", { name: "Refresh" })).toBeNull();
  fireEvent.click(trigger);
  let fail!: (error: Error) => void;
  account.readSavedPosts.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  fireEvent.click(trigger);
  await pane().findByText("Updating the list…");
  const stale = pane().getByRole("button", options);
  stale.focus();
  expect(stale.getAttribute("aria-disabled")).toBe("false");
  await act(async () =>
    fail(new TypeError("Native REST request failed", { cause: "network" })),
  );
  const retry = await pane().findByRole("button", {
    name: "Retry update: Saved messages",
  });
  expect(document.activeElement).toBe(stale);
  expect(
    pane().getByText(
      "Saved messages couldn’t update: no connection. Showing the previous response",
    ),
  ).toBeTruthy();
  let finish!: (
    value: Awaited<ReturnType<typeof account.readSavedPosts>>,
  ) => void;
  const previous = await account.readSavedPosts.mock.results[0].value;
  account.readSavedPosts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  retry.focus();
  fireEvent.click(retry);
  const waiting = await pane().findByText("Updating the list…");
  expect(document.activeElement).toBe(waiting.parentElement);
  await act(async () => finish(previous));
  await pane().findByText("Saved messages updated");
  expect(document.activeElement).toBe(stale);
  expect(account.readSavedPosts.mock.calls.map(([, offset]) => offset)).toEqual(
    [0, 0, 0],
  );
});

test.each([false, true])(
  "a late denial after the Saved retry control appears respects the current attempt (retried: %s)",
  async (retried) => {
    const { account } = fixture();
    const opener = await screen.findByRole("button", {
      name: "Saved messages",
    });
    fireEvent.click(opener);
    let pane = within(
      await screen.findByRole("complementary", { name: "Saved messages" }),
    );
    await pane.findByText("Saved root preview");
    let refuse!: (error: Error) => void;
    account.readPreferences.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    account.readSavedPosts.mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 503 })),
    );
    fireEvent.click(pane.getByRole("button", { name: "Close collection" }));
    fireEvent.click(opener);
    pane = within(
      await screen.findByRole("complementary", { name: "Saved messages" }),
    );
    const retry = await pane.findByRole("button", {
      name: "Retry update: Saved messages",
    });
    expect(
      pane.getByText(
        "Saved messages couldn’t update. Showing the previous response",
      ),
    ).toBeTruthy();
    retry.focus();
    if (retried) {
      fireEvent.click(retry);
      await pane.findByText("Saved messages updated");
    }
    await act(async () =>
      refuse(new ResponseError(new Response(null, { status: 403 }))),
    );
    if (retried) {
      expect(pane.getByText("Saved root preview")).toBeTruthy();
      expect(
        pane.queryByText("This collection is no longer available."),
      ).toBeNull();
    } else {
      expect(pane.getByRole("alert").textContent).toBe(
        "This collection is no longer available.",
      );
      expect(pane.queryByText("Saved root preview")).toBeNull();
      expect(pane.queryByText(/showing the previous response/i)).toBeNull();
      expect(document.activeElement).toBe(
        pane.getByRole("heading", { name: "Saved messages" }),
      );
    }
    expect(account.readSavedPosts).toHaveBeenCalledTimes(retried ? 3 : 2);
  },
);

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
  await pane.findByText("Loading saved messages…");
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
  const item = screen.getByRole("menuitem", { name: "Pinned messages" });
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

test("opens a mentioned reply and returns to its row, scroll position and toolbar opener", async () => {
  const { account } = fixture();
  const readPage = vi.fn().mockResolvedValue({
    items: [{ ...reply, message: "A mention for @reader" }],
    nextPage: null,
    firstInaccessiblePostTime: 0,
  });
  account.openRecentMentions.mockResolvedValue({ readPage });
  const trigger = await screen.findByRole("button", { name: "Mentions" });
  await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
  fireEvent.click(trigger);
  const row = await screen.findByRole("button", {
    name: /A mention for @reader/,
  });
  const list = row.closest(".collection-rows") as HTMLElement;
  list.scrollTop = 19;
  fireEvent.click(row);
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(thread).findByText(reply.message)).toBeTruthy();
  expect(account.readPostAnchor).toHaveBeenCalledWith(
    reply.id,
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to mentions" }));
  const restored = await screen.findByRole("button", {
    name: /A mention for @reader/,
  });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect(restored.closest(".collection-rows")?.scrollTop).toBe(19);
  expect(readPage).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("a temporary mention read failure is distinct from empty and retries the same query", async () => {
  const { account } = fixture();
  const readPage = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue({
      items: [],
      nextPage: null,
      firstInaccessiblePostTime: 0,
    });
  account.openRecentMentions.mockResolvedValue({ readPage });
  const trigger = await screen.findByRole("button", { name: "Mentions" });
  await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
  fireEvent.click(trigger);
  const pane = within(
    await screen.findByRole("complementary", { name: "Mentions" }),
  );
  await pane.findByRole("alert");
  expect(pane.queryByText("No mentions yet")).toBeNull();
  const retry = pane.getByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  await pane.findByText("No mentions yet");
  expect(document.activeElement).toBe(
    pane.getByRole("heading", { name: "Mentions" }),
  );
  expect(account.openRecentMentions).toHaveBeenCalledTimes(1);
  expect(readPage.mock.calls.map((call) => call[0])).toEqual([0, 0]);
});

test("keyboard pagination returns to retry after a refusal and focuses the first new mention", async () => {
  const { account } = fixture();
  const first = { ...root, message: "First mention" };
  const second = { ...reply, message: "Earlier mention" };
  const readPage = vi
    .fn()
    .mockResolvedValueOnce({
      items: [first],
      nextPage: 1,
      firstInaccessiblePostTime: 0,
    })
    .mockRejectedValueOnce(new TypeError("connection lost"))
    .mockResolvedValueOnce({
      items: [first, second],
      nextPage: null,
      firstInaccessiblePostTime: 0,
    });
  account.openRecentMentions.mockResolvedValue({ readPage });
  const trigger = await screen.findByRole("button", { name: "Mentions" });
  await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
  fireEvent.click(trigger);
  const pane = within(
    await screen.findByRole("complementary", { name: "Mentions" }),
  );
  const next = await pane.findByRole("button", {
    name: "Load earlier mentions",
  });
  next.focus();
  fireEvent.click(next);
  const retry = await pane.findByRole("button", { name: "Try again" });
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry);
  const item = await pane.findByRole("button", { name: /Earlier mention/ });
  expect(document.activeElement).toBe(item);
  expect(readPage.mock.calls.map(([index]) => index)).toEqual([0, 1, 1]);
});

test("mentions paint immediately, resolve a repeated outside channel once and forget a previous view's late name", async () => {
  const { account } = fixture();
  const outside = "v".repeat(26);
  const identity = {
    id: outside,
    kind: "P" as const,
    teamId: summer,
    name: "release",
    displayName: "Release team",
    deleteAt: 0,
  };
  let finish!: (value: typeof identity) => void;
  account.readChannelIdentity.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  account.openRecentMentions.mockResolvedValue({
    readPage: vi.fn().mockResolvedValue({
      items: [
        { ...root, channelId: outside },
        { ...reply, channelId: outside },
      ],
      nextPage: null,
      firstInaccessiblePostTime: 0,
    }),
  });
  const open = await screen.findByRole("button", { name: "Mentions" });
  await waitFor(() => expect(open.hasAttribute("disabled")).toBe(false));
  fireEvent.click(open);
  await screen.findByText(root.message);
  await screen.findByText(reply.message);
  expect(account.readChannelIdentity).toHaveBeenCalledTimes(1);
  const old = account.readChannelIdentity.mock.calls[0][1];
  fireEvent.keyDown(window, { key: "Escape" });
  expect(old?.aborted).toBe(true);
  account.readChannelIdentity.mockResolvedValueOnce({
    ...identity,
    displayName: "New team",
  });
  fireEvent.click(open);
  const pane = within(
    await screen.findByRole("complementary", { name: "Mentions" }),
  );
  await waitFor(() => expect(pane.getAllByText(/# New team/)).toHaveLength(2));
  await act(async () => finish(identity));
  expect(pane.queryByText(/Release team/)).toBeNull();
  expect(account.readChannelIdentity).toHaveBeenCalledTimes(2);
});

test("saved messages resolve an unlisted direct conversation using the peer profile", async () => {
  const { account } = fixture();
  const outside = "v".repeat(26),
    peer = "z".repeat(26);
  account.readChannelIdentity.mockResolvedValue({
    id: outside,
    kind: "D",
    teamId: "",
    name: [user, peer].join("__"),
    displayName: "",
    deleteAt: 0,
  });
  account.readSavedProfiles.mockImplementation(
    async (query: { ids: string[] }) => ({
      profiles: query.ids.includes(peer)
        ? { [peer]: channelProfile({ id: peer, username: "aurora" }) }
        : {},
      usernames: {},
    }),
  );
  account.readSavedPosts.mockResolvedValue({
    items: [
      { id: root.id, channelId: outside, message: "Saved outside", cards: [] },
    ],
    firstInaccessiblePostTime: 0,
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  const pane = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  await pane.findByText(/aurora/);
  expect(pane.queryByText(/__/)).toBeNull();
  expect(account.readChannelIdentity).toHaveBeenCalledTimes(1);
});

test("search labels an outside channel and retains its result when another channel refuses metadata", async () => {
  const { account } = fixture();
  const outside = "v".repeat(26),
    unavailable = "z".repeat(26);
  account.readPostSearchPage.mockResolvedValue({
    items: [
      { id: root.id, channelId: outside, message: "Release note", cards: [] },
      {
        id: reply.id,
        channelId: unavailable,
        message: "Other note",
        cards: [],
      },
    ],
    matches: null,
    isEnd: true,
    firstInaccessiblePostTime: 0,
  });
  account.readChannelIdentity.mockImplementation(async (id) => {
    if (id === unavailable)
      throw new ResponseError(new Response(null, { status: 403 }));
    return {
      id,
      kind: "O",
      name: "release",
      displayName: "Shared releases",
      teamId: summer,
      deleteAt: 0,
    };
  });
  const results = await search();
  await results.findByText("# Shared releases");
  expect(results.getByRole("button", { name: "Other note" })).toBeTruthy();
  expect(results.queryByText(unavailable)).toBeNull();
  expect(account.readChannelIdentity).toHaveBeenCalledTimes(2);
});

test("steps between a saved channel post and reply, then Back opens the same selected row without rereading the list", async () => {
  const { account } = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  fireEvent.click(trigger);
  const pane = within(
    await screen.findByRole("complementary", { name: "Saved messages" }),
  );
  fireEvent.click(
    await pane.findByRole("button", { name: /Saved root preview/ }),
  );
  const group = () =>
    within(screen.getByRole("group", { name: "Saved messages" }));
  await screen.findByRole("group", { name: "Saved messages" });
  expect(group().getByRole("status").textContent).toBe("2 of 2");
  expect(group().getByRole("button", { name: "Next in list" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(group().getByRole("button", { name: "Previous in list" }));
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  await within(thread).findByText(reply.message);
  expect(group().getByRole("status").textContent).toBe("1 of 2");
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(2));
  if (nativeBack) await act(async () => nativeBack?.());
  else fireEvent.keyDown(window, { key: "Escape" });
  const selected = await screen.findByRole("button", {
    name: /Saved reply preview/,
  });
  expect(selected.getAttribute("aria-current")).toBe("true");
  expect(document.activeElement).toBe(selected);
  expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #Home…",
      })
    ).value,
  ).toBe("Original unfinished draft");
});

test("a collection return requests the visible channel anchor from local history", async () => {
  const { account } = fixture();
  const anchor = {
    ...root,
    id: "s".repeat(26),
    channelId: home,
    message: "Reading from the middle",
    rootId: null,
  };
  const read = account.readChannelWindow.getMockImplementation();
  account.readChannelWindow.mockImplementation(async (query) =>
    query.channelId === home
      ? {
          posts: [anchor],
          older: { kind: "end" },
          newer: { kind: "more", postId: anchor.id },
          firstInaccessiblePostTime: 0,
        }
      : (read?.(query) ?? null),
  );
  const text = await screen.findByText(anchor.message);
  const article = text.closest("article");
  const viewport = text.closest(".timeline-scroll");
  if (!article || !viewport) throw Error("Missing channel timeline fixture");
  Object.defineProperty(viewport, "clientHeight", { value: 300 });
  Object.defineProperty(viewport, "scrollHeight", { value: 1200 });
  viewport.scrollTop = 330;
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
    new DOMRect(30, 20, 400, 300),
  );
  vi.spyOn(article, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 55, 380, 100),
  );
  fireEvent.click(screen.getByRole("button", { name: "Saved messages" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Saved root preview/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Back to saved messages" }),
  );
  await waitFor(() =>
    expect(account.readChannelWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "around",
        channelId: home,
        postId: anchor.id,
      }),
    ),
  );
  expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(anchor.message)).toBeTruthy();
});

test.each(["saved", "mentions"] as const)(
  "the account handles one rejected %s refresh while reading its result",
  async (kind) => {
    const { account } = fixture();
    const name = kind === "saved" ? "Saved messages" : "Mentions";
    const row = {
      name: kind === "saved" ? /Saved reply preview/ : /Mentioned reply/,
    };
    let reject!: (reason: Error) => void;
    const denied = () =>
      new Promise<never>((_, fail) => {
        reject = fail;
      });
    if (kind === "mentions") {
      const readPage = vi
        .fn()
        .mockResolvedValueOnce({
          items: [{ ...reply, message: "Mentioned reply" }],
          nextPage: null,
          firstInaccessiblePostTime: 0,
        })
        .mockImplementationOnce(denied);
      account.openRecentMentions.mockResolvedValue({ readPage });
    }
    account.signOutOnDevice.mockImplementationOnce(() => new Promise(() => {}));
    const trigger = await screen.findByRole("button", { name });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    fireEvent.click(trigger);
    await screen.findByRole("button", row);
    fireEvent.click(trigger);
    if (kind === "saved") account.readSavedPosts.mockImplementationOnce(denied);
    fireEvent.click(trigger);
    await screen.findByText("Updating the list…");
    fireEvent.click(screen.getByRole("button", row));
    const thread = await screen.findByRole("complementary", { name: "Thread" });
    await within(thread).findByText(reply.message);
    expect(screen.queryByRole("complementary", { name })).toBeNull();
    await act(async () =>
      reject(new ResponseError(new Response(null, { status: 401 }))),
    );
    await waitFor(() =>
      expect(account.signOutOnDevice).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  },
);

test("a late rejected refresh from a closed account cannot sign out a newly opened account", async () => {
  const previous = fixture();
  const trigger = await screen.findByRole("button", { name: "Saved messages" });
  fireEvent.click(trigger);
  await screen.findByRole("button", { name: /Saved reply preview/ });
  fireEvent.click(trigger);
  let reject!: (reason: Error) => void;
  previous.account.readSavedPosts.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(previous.account.readSavedPosts).toHaveBeenCalledTimes(2),
  );
  const signal = previous.account.readSavedPosts.mock.calls[1][2];
  previous.view.unmount();
  expect(signal?.aborted).toBe(true);
  const next = fixture({
    launch: async () => ({
      status: "ready",
      serverUrl: "https://other.example.test",
      userId: "b".repeat(26),
      installations: ["https://other.example.test"],
    }),
  });
  const opener = await screen.findByRole("button", { name: "Saved messages" });
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(opener.isConnected).toBe(true);
  expect(previous.account.signOutOnDevice).not.toHaveBeenCalled();
  expect(next.account.signOutOnDevice).not.toHaveBeenCalled();
});

test("dropping offline during a collection step preserves the verified result and disables both inputs", async () => {
  const { account } = fixture();
  const read = account.readSavedPosts.getMockImplementation();
  account.readSavedPosts.mockImplementation(async (...args) => {
    const data = await read?.(...args);
    if (!data) throw Error("Fixture has no saved rows");
    return {
      ...data,
      items: [
        ...data.items,
        {
          id: bookmark,
          channelId: design,
          createAt: 1,
          message: "Old sample",
          cards: [],
        },
      ],
    };
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Saved root preview/ }),
  );
  const group = within(
    await screen.findByRole("group", { name: "Saved messages" }),
  );
  const before = group.getByRole<HTMLButtonElement>("button", {
    name: "Previous in list",
  });
  const after = group.getByRole<HTMLButtonElement>("button", {
    name: "Next in list",
  });
  expect(before.disabled || after.disabled).toBe(false);
  let finish!: () => void;
  const resolveAnchor = account.readPostAnchor.getMockImplementation();
  if (!resolveAnchor) throw Error("Missing destination fixture");
  account.readPostAnchor.mockImplementationOnce(async (...args) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return resolveAnchor(...args);
  });
  fireEvent.click(before);
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(2));
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(before.disabled && after.disabled).toBe(true));
    await act(async () => finish());
    fireEvent.click(before);
    fireEvent.click(after);
    fireEvent.keyDown(window, {
      code: "KeyG",
      key: "g",
      ctrlKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(window, { code: "KeyG", key: "g", ctrlKey: true });
    expect(account.readPostAnchor).toHaveBeenCalledTimes(2);
    expect(group.getByRole("status").textContent).toBe("2 of 3");
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
    expect(await screen.findByText(root.message)).toBeTruthy();
    fireEvent.click(
      group.getByRole("button", { name: "Back to saved messages" }),
    );
    expect(
      (
        await screen.findByRole("button", { name: /Saved root preview/ })
      ).getAttribute("aria-current"),
    ).toBe("true");
  } finally {
    online.mockRestore();
  }
});

test("finishing the collection from a thread focuses its visible addressed reply", async () => {
  fixture();
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Saved reply preview/ }),
  );
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  const post = (await within(thread).findByText(reply.message)).closest(
    "article",
  );
  const main = screen.getByRole("main");
  if (!post) throw Error("Reply article missing");
  const hidden = post.cloneNode(false) as HTMLElement;
  hidden.hidden = true;
  main.append(hidden);
  vi.spyOn(post, "getClientRects").mockReturnValue([
    new DOMRect(0, 40, 300, 100),
  ] as unknown as DOMRectList);
  const end = await screen.findByRole("button", {
    name: "Finish browsing the list",
  });
  end.focus();
  fireEvent.click(end);
  expect(document.activeElement).toBe(post);
  expect(screen.queryByRole("group", { name: "Saved messages" })).toBeNull();
  expect(thread.isConnected).toBe(true);
  hidden.remove();
});

test("members open from details, restore the opening row and cancel a pending read when changing channels", async () => {
  const { account } = fixture();
  const info = await screen.findByRole("button", { name: "Channel info" });
  fireEvent.click(info);
  const members = await screen.findByRole("button", { name: /^Members/ });
  expect(account.readChannelMemberDirectory).not.toHaveBeenCalled();
  fireEvent.click(members);
  const panel = within(
    await screen.findByRole("complementary", { name: "Members" }),
  );
  await panel.findByText("No members to show");
  expect(account.readChannelMemberDirectory).toHaveBeenCalledWith(
    home,
    { kind: "page", page: 0 },
    expect.any(AbortSignal),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  const returned = await screen.findByRole("button", { name: /^Members/ });
  expect(document.activeElement).toBe(returned);
  account.readChannelMemberDirectory.mockImplementationOnce(
    () => new Promise(() => {}),
  );
  fireEvent.click(returned);
  await screen.findByRole("searchbox", { name: "Find a member" });
  const signal = account.readChannelMemberDirectory.mock.calls.at(-1)?.[2];
  expect(signal?.aborted).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole("complementary", { name: "Members" })).toBeNull();
});

test("members in the channel menu are loaded only by selecting the item and Back returns to the title", async () => {
  const { account } = fixture();
  const menu = await screen.findByRole("button", {
    name: "Channel menu, Home",
  });
  fireEvent.click(menu);
  const action = screen.getByRole("menuitem", { name: "Members" });
  expect(account.readChannelMemberDirectory).not.toHaveBeenCalled();
  fireEvent.click(action);
  const panel = await screen.findByRole("complementary", { name: "Members" });
  await within(panel).findByText("No members to show");
  expect(account.readChannelMemberDirectory).toHaveBeenCalledWith(
    home,
    { kind: "page", page: 0 },
    expect.any(AbortSignal),
  );
  expect(account.readChannelMemberCount).not.toHaveBeenCalled();
  fireEvent.click(
    within(panel).getByRole("button", { name: "Back to conversation" }),
  );
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(document.activeElement).toBe(menu);
});

test("files from the title menu are scoped to the selected channel and Back skips details", async () => {
  const { account } = fixture();
  fireEvent.click(await screen.findByRole("button", { name: "Design" }));
  const menu = await screen.findByRole("button", {
    name: "Channel menu, Design",
  });
  fireEvent.click(menu);
  const action = screen.getByRole("menuitem", { name: "Channel files" });
  expect(account.readFileSearchPage).not.toHaveBeenCalled();
  fireEvent.click(action);
  const panel = await screen.findByRole("complementary", {
    name: "Channel files",
  });
  await within(panel).findByRole("button", {
    name: "Open attachment first.pdf",
  });
  expect(account.readFileSearchPage).toHaveBeenCalledWith(
    expect.objectContaining({ terms: `channel:${design}`, page: 0 }),
    expect.any(AbortSignal),
  );
  expect(account.readChannelMemberCount).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(document.activeElement).toBe(menu);
});

test("opens scoped files from channel info and returns from the message to the same file and list", async () => {
  const { account } = fixture();
  fireEvent.click(await screen.findByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  const info = screen.getByRole("button", { name: "Channel info" });
  fireEvent.click(info);
  const files = await screen.findByRole("button", { name: "Channel files" });
  expect(account.readFileSearchPage).not.toHaveBeenCalled();
  fireEvent.click(files);
  const panel = await screen.findByRole("complementary", {
    name: "Channel files",
  });
  const standalone = await within(panel).findByRole("button", {
    name: "Open attachment bookmark.pdf",
  });
  fireEvent.click(standalone);
  const bookmarkDetails = await screen.findByRole("dialog", {
    name: "bookmark.pdf",
  });
  expect(within(bookmarkDetails).getByText("0 B, empty file")).toBeTruthy();
  expect(
    within(bookmarkDetails).queryByRole("button", { name: "Go to message" }),
  ).toBeNull();
  fireEvent.click(
    within(bookmarkDetails).getByRole("button", { name: "Close" }),
  );
  fireEvent.click(
    within(panel).getByRole("button", { name: "Show more files" }),
  );
  const second = await within(panel).findByRole("button", {
    name: "Open attachment second.pdf",
  });
  const body = panel.querySelector<HTMLElement>("[data-channel-files]");
  if (!body) throw new Error("Missing channel file list");
  body.scrollTop = 35;
  fireEvent.click(second);
  const details = await screen.findByRole("dialog", { name: "second.pdf" });
  fireEvent.click(
    within(details).getByRole("button", { name: "Go to message" }),
  );
  const back = await screen.findByRole("button", {
    name: "Back to channel files",
  });
  expect(
    screen.queryByRole("complementary", { name: "Channel files" }),
  ).toBeNull();
  await screen.findByText(root.message);
  fireEvent.click(back);
  expect(
    await screen.findByRole("complementary", { name: "Channel files" }),
  ).toBe(panel);
  await waitFor(() => expect(document.activeElement).toBe(second));
  expect(body.scrollTop).toBe(35);
  expect(account.readFileSearchPage).toHaveBeenCalledTimes(2);
  expect(
    account.readChannelFile.mock.calls.map(([channel, id]) => [channel, id]),
  ).toEqual([
    [design, bookmark],
    [design, secondFile],
  ]);
  fireEvent.keyDown(window, { key: "Escape" });
  const restored = await screen.findByRole("button", { name: "Channel files" });
  expect(document.activeElement).toBe(restored);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(info);
});

test("channel files discard loaded rows after removal and retry the same page on a connection error", async () => {
  const { account } = fixture();
  fireEvent.click(await screen.findByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  fireEvent.click(screen.getByRole("button", { name: "Channel info" }));
  fireEvent.click(await screen.findByRole("button", { name: "Channel files" }));
  const panel = within(
    await screen.findByRole("complementary", { name: "Channel files" }),
  );
  const card = await panel.findByRole("button", {
    name: "Open attachment first.pdf",
  });
  account.readFileSearchPage.mockRejectedValueOnce(new Error("disconnected"));
  fireEvent.click(panel.getByRole("button", { name: "Show more files" }));
  await panel.findByText("Couldn’t load channel files.");
  expect(card.isConnected).toBe(true);
  account.readFileSearchPage.mockResolvedValueOnce({
    items: [],
    isEnd: true,
    firstInaccessibleFileTime: 0,
  });
  account.readChannelIdentity.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  fireEvent.click(panel.getByRole("button", { name: "Try again" }));
  await panel.findByText("Channel files are unavailable.");
  expect(card.isConnected).toBe(false);
  expect(account.readFileSearchPage.mock.calls.map(([q]) => q.page)).toEqual([
    0, 1, 1,
  ]);
});

test("the server's file-search policy controls the channel info action", async () => {
  const { account } = fixture({ fileSearch: false });
  const menu = await screen.findByRole("button", {
    name: "Channel menu, Home",
  });
  fireEvent.click(menu);
  expect(screen.queryByRole("menuitem", { name: "Channel files" })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(await screen.findByRole("button", { name: "Channel info" }));
  const about = await screen.findByRole("complementary", {
    name: "About this channel",
  });
  expect(
    within(about).queryByRole("button", { name: "Channel files" }),
  ).toBeNull();
  expect(account.readFileSearchPage).not.toHaveBeenCalled();
});

test("leaving a channel aborts the pending file read before a late row can appear", async () => {
  const { account } = fixture();
  let finish!: (
    value: Awaited<ReturnType<typeof account.readFileSearchPage>>,
  ) => void;
  account.readFileSearchPage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Channel info" }));
  fireEvent.click(await screen.findByRole("button", { name: "Channel files" }));
  await waitFor(() =>
    expect(account.readFileSearchPage).toHaveBeenCalledOnce(),
  );
  const signal = account.readFileSearchPage.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { level: 1, name: "Design" });
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    finish({
      items: [
        { id: firstFile, channelId: home, postId: null, name: "old-file.txt" },
      ],
      isEnd: true,
      firstInaccessibleFileTime: 0,
    }),
  );
  expect(screen.queryByText("old-file.txt")).toBeNull();
});

function resizeWorkspace(initialWidth: number) {
  let width = initialWidth;
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe(node: HTMLElement) {
        if (!node.classList.contains("workspace-window")) return;
        Object.defineProperty(node, "clientWidth", { get: () => width });
        resize = this.callback;
        resize();
      }
      disconnect() {}
    },
  );
  return (nextWidth: number) => {
    width = nextWidth;
    act(resize);
  };
}

test("the wide member button shares the overview count and returns focus after resizing", async () => {
  const resize = resizeWorkspace(901);
  const { account } = fixture();
  const header = await screen.findByRole("button", { name: "Members · 7" });
  const info = screen.getByRole("button", { name: "Channel info" });
  fireEvent.click(info);
  const about = await screen.findByRole("complementary", {
    name: "About this channel",
  });
  expect(within(about).getByText("7")).toBeTruthy();
  expect(account.readChannelMemberCount).toHaveBeenCalledOnce();
  fireEvent.click(header);
  const roster = await screen.findByRole("complementary", { name: "Members" });
  expect(
    within(roster).queryByRole("button", { name: "Back to channel info" }),
  ).toBeNull();
  fireEvent.click(header);
  expect(roster.isConnected).toBe(false);
  expect(document.activeElement).toBe(header);
  fireEvent.click(header);
  await screen.findByRole("complementary", { name: "Members" });
  resize(900);
  expect(header.isConnected).toBe(false);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(info);
  expect(account.readChannelMemberCount).toHaveBeenCalledOnce();
});

test.each(["P", "G", "D"] as const)(
  "wide member entry respects conversation kind %s",
  async (homeKind) => {
    resizeWorkspace(1180);
    const { account } = fixture({ homeKind });
    const info = await screen.findByRole("button", { name: "Channel info" });
    if (homeKind === "D") {
      expect(screen.queryByRole("button", { name: /^Members/ })).toBeNull();
      expect(account.readChannelMemberCount).not.toHaveBeenCalled();
      fireEvent.click(info);
      const about = await screen.findByRole("complementary", {
        name: "About this channel",
      });
      fireEvent.click(within(about).getByRole("button", { name: /^Members/ }));
    } else {
      fireEvent.click(
        await screen.findByRole("button", { name: "Members · 7" }),
      );
    }
    await screen.findByRole("complementary", { name: "Members" });
    expect(account.readChannelMemberDirectory.mock.calls[0][0]).toBe(home);
  },
);
