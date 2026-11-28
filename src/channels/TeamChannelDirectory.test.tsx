import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import {
  type DirectoryProps,
  TeamChannelDirectory,
} from "./TeamChannelDirectory.tsx";
import "./workspace-dom.test-utils.ts";

const teamId = "t".repeat(26),
  self = "u".repeat(26);
function room(char: string, title: string, kind = "O", deleteAt = 0) {
  return {
    id: char.repeat(26),
    displayName: title,
    name: char + "-channel",
    kind,
    deleteAt,
    purpose: "Channel description",
    header: "Release calendar",
  };
}
const mine = room("m", "General"),
  available = room("v", "Release notes"),
  privateRoom = room("p", "Private planning", "P"),
  archive = room("a", "Old public", "O", 100);
function readState(rows = [mine]): DirectoryProps["state"] {
  return {
    status: "ready",
    value: {
      selectedChannel: mine.id,
      data: projectTeamSidebar({
        teamId,
        categories: [],
        channels: rows.map((r) => ({
          channel: {
            id: r.id,
            displayName: r.displayName,
            name: r.name,
            type: r.kind,
            deleteAt: r.deleteAt,
          },
          membership: { channelId: r.id, userId: self },
        })),
      }),
    },
  };
}
let atEdge: () => void;
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        atEdge = () => cb([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);
type Account = DirectoryProps["account"];
function setup(canBrowse = true) {
  const account = {
    readChannelDirectoryPage: vi
      .fn<Account["readChannelDirectoryPage"]>()
      .mockResolvedValue({ items: [mine, available], hasMore: false }),
    searchChannelDirectory: vi
      .fn<Account["searchChannelDirectory"]>()
      .mockResolvedValue([mine, privateRoom, archive, available]),
    changeOwnMembership: vi
      .fn<Account["changeOwnMembership"]>()
      .mockResolvedValue({ kind: "applied" }),
  };
  const props = {
    account,
    teamId,
    state: readState(),
    language: "en" as const,
    online: true,
    choose: vi.fn(),
    refresh: vi.fn(),
    sessionIssue: vi.fn(),
    canBrowse,
  };
  const view = render(<TeamChannelDirectory {...props} />);
  const update = (next: Partial<typeof props>) =>
    view.rerender(<TeamChannelDirectory {...{ ...props, ...next }} />);
  return { ...props, update, unmount: view.unmount };
}
const browse = () =>
  fireEvent.click(screen.getByRole("tab", { name: "Available" }));
test("members browse on demand, filter active public nonmembers, return to the same page and cancel without joining", async () => {
  const { account } = setup();
  expect(account.readChannelDirectoryPage).not.toHaveBeenCalled();
  browse();
  const opener = await screen.findByRole("button", { name: "Release notes" });
  expect(screen.queryByRole("button", { name: "General" })).toBeNull();
  const search = screen.getByRole("searchbox", { name: "Find a channel" });
  fireEvent.change(search, { target: { value: "  #release  " } });
  await waitFor(() =>
    expect(account.searchChannelDirectory).toHaveBeenCalledOnce(),
  );
  expect(account.searchChannelDirectory.mock.calls[0].slice(0, 2)).toEqual([
    teamId,
    "release",
  ]);
  expect(screen.queryByRole("button", { name: "Private planning" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Old public" })).toBeNull();
  const row = await screen.findByRole("button", { name: "Release notes" });
  fireEvent.click(row);
  const dialog = within(screen.getByRole("dialog", { name: "Join channel?" }));
  expect(dialog.getByText("Release calendar", { exact: false })).toBeTruthy();
  expect(
    dialog.getByText("Channel description", { exact: false }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    dialog.getByRole("button", { name: "Join" }),
  );
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(document.activeElement).toBe(row));
  fireEvent.click(screen.getByRole("tab", { name: "My channels" }));
  browse();
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect(
    (await screen.findByRole("button", { name: "Release notes" })).textContent,
  ).toBe(opener.textContent);
  expect(account.readChannelDirectoryPage).toHaveBeenCalledOnce();
});
test("a filtered full page can continue and a late page after a failed scroll can only be retried explicitly", async () => {
  const { account } = setup();
  account.readChannelDirectoryPage
    .mockResolvedValueOnce({ items: [mine], hasMore: true })
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce({ items: [available], hasMore: false });
  browse();
  await screen.findByRole("button", { name: "Load more channels" });
  act(() => atEdge());
  const retry = await screen.findByRole("button", { name: "Try again" });
  await act(async () => atEdge());
  expect(account.readChannelDirectoryPage).toHaveBeenCalledTimes(2);
  retry.focus();
  fireEvent.click(retry);
  const room = await screen.findByRole("button", { name: "Release notes" });
  expect(document.activeElement).toBe(room);
  expect(
    account.readChannelDirectoryPage.mock.calls.map(([query]) => query.page),
  ).toEqual([0, 1, 1]);
});
test("a known server refusal removes both page and search rows across a tab switch", async () => {
  const { account } = setup();
  browse();
  await screen.findByRole("button", { name: "Release notes" });
  account.searchChannelDirectory.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "hidden" },
  });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("tab", { name: "My channels" }));
  browse();
  expect(screen.queryByRole("button", { name: "Release notes" })).toBeNull();
  expect(account.readChannelDirectoryPage).toHaveBeenCalledOnce();
});
test("confirmed and unconfirmed join wait for a fresh membership; checking never sends a second write", async () => {
  const { account, choose, refresh, update } = setup();
  account.changeOwnMembership.mockResolvedValueOnce({ kind: "unconfirmed" });
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Release notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  const check = await screen.findByRole("button", { name: "Check membership" });
  expect(choose).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(check);
  expect(refresh).toHaveBeenCalledOnce();
  update({ state: { ...readState(), status: "refreshing" } });
  expect(choose).not.toHaveBeenCalled();
  update({ state: readState([mine, available]) });
  await waitFor(() =>
    expect(choose).toHaveBeenCalledExactlyOnceWith(available.id),
  );
  expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
    { kind: "channel", id: available.id },
    "join",
  );
});
test("a second click cannot repeat an in-flight join; an old team never navigates after unmount", async () => {
  const { account, choose, unmount, refresh } = setup();
  let finish!: (value: { kind: "applied" }) => void;
  account.changeOwnMembership.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Release notes" }));
  const join = screen.getByRole("button", { name: "Join" });
  fireEvent.click(join);
  fireEvent.click(join);
  expect(account.changeOwnMembership).toHaveBeenCalledOnce();
  unmount();
  await act(async () => finish({ kind: "applied" }));
  expect(choose).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
test("a guest or missing permission never opens public rows; revocation withdraws an open confirmation", async () => {
  const { account, update } = setup(false);
  expect(screen.queryByRole("tab", { name: "Available" })).toBeNull();
  const filter = screen.getByRole("searchbox");
  fireEvent.change(filter, { target: { value: "General" } });
  expect(
    screen.getByRole("button", { name: "General, Public channel" }),
  ).toBeTruthy();
  fireEvent.change(filter, { target: { value: "hidden" } });
  expect(screen.getByText("Change your search.")).toBeTruthy();
  expect(account.readChannelDirectoryPage).not.toHaveBeenCalled();
  expect(account.searchChannelDirectory).not.toHaveBeenCalled();
  update({ canBrowse: true });
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Release notes" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  update({ canBrowse: false });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Release notes")).toBeNull();
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
});

test("empty available results distinguish a search miss from an empty catalog", async () => {
  const { account } = setup();
  account.readChannelDirectoryPage.mockResolvedValueOnce({
    items: [mine],
    hasMore: false,
  });
  account.searchChannelDirectory.mockResolvedValueOnce([]);
  browse();
  const field = screen.getByRole("searchbox");
  const empty = await screen.findByRole("heading", {
    name: "No available channels",
  });
  expect(empty.closest('[role="status"]')?.textContent).toContain(
    "You’ve joined all public channels on this team.",
  );
  fireEvent.change(field, { target: { value: "release" } });
  const miss = await screen.findByRole("heading", {
    name: "No matching channels",
  });
  expect(miss.closest('[role="status"]')?.textContent).toContain(
    "Change your search or switch tabs.",
  );
  fireEvent.change(field, { target: { value: "" } });
  expect(
    screen.getByRole("heading", { name: "No available channels" }),
  ).toBeTruthy();
  expect(account.readChannelDirectoryPage).toHaveBeenCalledOnce();
  expect(account.searchChannelDirectory).toHaveBeenCalledOnce();
});

test("a queued scroll notification does not fetch another page after leaving Available", async () => {
  const { account } = setup();
  account.readChannelDirectoryPage.mockResolvedValueOnce({
    items: [available],
    hasMore: true,
  });
  browse();
  await screen.findByRole("button", { name: "Load more channels" });
  const late = atEdge;
  fireEvent.click(screen.getByRole("tab", { name: "My channels" }));
  await act(async () => late());
  expect(account.readChannelDirectoryPage).toHaveBeenCalledOnce();
});
test("a lost row returns focus to the filter after cancelling", async () => {
  const { update } = setup();
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Release notes" }));
  update({ state: readState([mine, available]) });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("searchbox")),
  );
});
test("a confirmed join waits for refreshed membership before navigating", async () => {
  const { choose, refresh, update, account } = setup();
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Release notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(choose).not.toHaveBeenCalled();
  update({ state: { ...readState([mine, available]), status: "refreshing" } });
  expect(choose).not.toHaveBeenCalled();
  update({ state: readState([mine, available]) });
  await waitFor(() =>
    expect(choose).toHaveBeenCalledExactlyOnceWith(available.id),
  );
  expect(account.changeOwnMembership).toHaveBeenCalledOnce();
});
test("a fresh negative check permits only a second explicit join", async () => {
  const { choose, refresh, update, account } = setup();
  account.changeOwnMembership.mockResolvedValueOnce({ kind: "unconfirmed" });
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Release notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Check membership" }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  update({ state: readState() });
  await screen.findByText("You’re not a member of this channel.");
  expect(account.changeOwnMembership).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(account.changeOwnMembership).toHaveBeenCalledTimes(2);
  expect(choose).not.toHaveBeenCalled();
});
test("a definitive refusal shows the Mattermost message and a lost session returns to account handling", async () => {
  const { account, choose, refresh, sessionIssue } = setup();
  account.changeOwnMembership
    .mockResolvedValueOnce({
      kind: "refused",
      refusal: {
        status: 403,
        code: "channel.permission",
        message: "This team restricts membership.",
      },
    })
    .mockResolvedValueOnce({ kind: "unauthorized" });
  browse();
  const row = await screen.findByRole("button", { name: "Release notes" });
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await screen.findByText("This team restricts membership.");
  expect(screen.queryByRole("button", { name: "Check membership" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await waitFor(() =>
    expect(sessionIssue).toHaveBeenCalledExactlyOnceWith("unauthorized"),
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(choose).not.toHaveBeenCalled();
});
