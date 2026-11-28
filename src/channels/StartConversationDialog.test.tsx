import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import "./workspace-dom.test-utils.ts";
import { channelProfile } from "../mattermost/channel-profiles.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { StartConversationDialog } from "./StartConversationDialog.tsx";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import type { WorkspaceRead } from "./workspace-data.ts";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const person = (i: number) =>
  channelProfile({
    id: String(i).padStart(26, "a"),
    username: `person-${i}`,
    deleteAt: 0,
  });
const own = person(0),
  peers = Array.from({ length: 9 }, (_, i) => person(i + 1));
function room(
  id: string,
  kind: "D" | "G",
  name: string,
): TeamSidebar["data"]["channels"][number] {
  return {
    id,
    kind,
    name,
    displayName: "",
    header: "",
    purpose: "",
    deleteAt: 0,
    createAt: 1,
    muted: false,
    lastPostAt: 0,
    lastRootPostAt: 0,
    totalMsgCount: 0,
    totalMsgCountRoot: 0,
    lastViewedAt: 0,
    msgCount: 0,
    msgCountRoot: 0,
    mentionCount: 0,
    mentionCountRoot: 0,
    urgentMentionCount: 0,
  };
}
type Account = Pick<
  WorkspaceConnection,
  "readConversationRecipients" | "openRecipientConversation"
>;
function setup() {
  const account: Account = {
    readConversationRecipients: vi
      .fn<Account["readConversationRecipients"]>()
      .mockResolvedValue({ profiles: [own, ...peers], nextPage: null }),
    openRecipientConversation: vi.fn<Account["openRecipientConversation"]>(),
  };
  const snapshot: TeamSidebar = {
    selectedChannel: null,
    data: { categories: [], channels: [] },
  };
  const props = {
    account,
    userId: own.id,
    teamId: "t".repeat(26),
    language: "en" as const,
    format: "username" as const,
    online: true,
    directory: {
      status: "ready",
      value: snapshot,
    } as WorkspaceRead<TeamSidebar>,
    refresh: vi.fn(),
    choose: vi.fn(),
    dismiss: vi.fn(),
    sessionIssue: vi.fn(),
  };
  return props;
}
const submit = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Open conversation" });
const tick = (name: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", {
    name: new RegExp(`${name}(?: |$)`),
  });
test("keeps selections outside the search or page and enforces seven peers or self alone", async () => {
  const p = setup();
  vi.mocked(p.account.readConversationRecipients).mockImplementation(
    async (_team, q) =>
      q.kind === "search"
        ? { profiles: [peers[8]], nextPage: null }
        : q.page === 0
          ? { profiles: [own, ...peers.slice(0, 4)], nextPage: 1 }
          : { profiles: peers.slice(4), nextPage: null },
  );
  vi.mocked(p.account.openRecipientConversation).mockResolvedValue({
    kind: "refused",
    refusal: {
      status: 403,
      code: "denied",
      message: "Private group restricted",
    },
  });
  render(<StartConversationDialog {...p} />);
  await screen.findByRole("checkbox", { name: /^person-1(?: |$)/ });
  expect(submit().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(tick("person-0"));
  expect(tick("person-1").getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(tick("person-0"));
  for (const i of [1, 2, 3, 4]) fireEvent.click(tick(`person-${i}`));
  expect(tick("person-0").getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await screen.findByRole("checkbox", { name: /^person-5(?: |$)/ });
  for (const i of [5, 6]) fireEvent.click(tick(`person-${i}`));
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: " @nine " },
  });
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /^person-9(?: |$)/ }),
  );
  expect(screen.getByText("7 of 7 selected · limit reached")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  expect(
    screen
      .getAllByRole("checkbox")
      .slice(0, 7)
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual([1, 2, 3, 4, 5, 6, 9].map((i) => `person-${i}`));
  await screen.findByRole("checkbox", { name: /^person-1(?: |$)/ });
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await screen.findByRole("checkbox", { name: /^person-8(?: |$)/ });
  expect(tick("person-8").getAttribute("aria-disabled")).toBe("true");
  expect(tick("person-9").checked).toBe(true);
  fireEvent.click(submit());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Private group restricted",
  );
  expect(p.account.openRecipientConversation).toHaveBeenCalledWith(
    [1, 2, 3, 4, 5, 6, 9].map((i) => person(i).id),
    expect.any(AbortSignal),
  );
  expect(tick("person-9").checked).toBe(true);
  expect(p.choose).not.toHaveBeenCalled();
});
test("drops the previous query and cancelled opening even when both requests ignore abort", async () => {
  const p = setup(),
    late =
      deferred<Awaited<ReturnType<Account["readConversationRecipients"]>>>(),
    opened =
      deferred<Awaited<ReturnType<Account["openRecipientConversation"]>>>();
  vi.mocked(p.account.readConversationRecipients).mockImplementation(
    async (_team, q) =>
      q.kind === "page"
        ? late.promise
        : { profiles: [peers[1]], nextPage: null },
  );
  vi.mocked(p.account.openRecipientConversation).mockReturnValue(
    opened.promise,
  );
  const view = render(<StartConversationDialog {...p} />);
  const old = vi.mocked(p.account.readConversationRecipients).mock.calls[0][2];
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "@new" },
  });
  expect(old?.aborted).toBe(true);
  const second = await screen.findByRole("checkbox", {
    name: /^person-2(?: |$)/,
  });
  await act(async () => late.resolve({ profiles: [own], nextPage: null }));
  expect(
    screen.queryByRole("checkbox", { name: /^person-0(?: |$)/ }),
  ).toBeNull();
  fireEvent.click(second);
  fireEvent.click(submit());
  fireEvent.click(submit());
  expect(p.account.openRecipientConversation).toHaveBeenCalledOnce();
  const signal = vi.mocked(p.account.openRecipientConversation).mock
    .calls[0][1];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    opened.resolve({
      kind: "applied",
      channelId: "g".repeat(26),
      channelKind: "D",
    }),
  );
  expect(p.refresh).not.toHaveBeenCalled();
  expect(p.choose).not.toHaveBeenCalled();
});
test("retries a failed sidebar read without a second creation, matching active ID and channel kind", async () => {
  const p = setup(),
    id = "g".repeat(26);
  const result = { kind: "applied", channelId: id, channelKind: "D" } as const;
  vi.mocked(p.account.openRecipientConversation).mockResolvedValue(result);
  const view = render(<StartConversationDialog {...p} />);
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /^person-0(?: |$)/ }),
  );
  fireEvent.click(submit());
  await waitFor(() => expect(p.refresh).toHaveBeenCalledOnce());
  view.rerender(
    <StartConversationDialog
      {...p}
      directory={{ status: "network", value: null }}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retry opening" }));
  const destination = room(id, "D", `${own.id}__${own.id}`);
  for (const wrong of [
    { ...destination, kind: "G" },
    { ...destination, deleteAt: 20 },
    { ...destination, id: "p".repeat(26) },
  ]) {
    view.rerender(
      <StartConversationDialog
        {...p}
        directory={{
          status: "ready",
          value: {
            selectedChannel: null,
            data: { channels: [wrong], categories: [] },
          },
        }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry opening" }),
    );
    expect(p.choose).not.toHaveBeenCalled();
  }
  view.rerender(
    <StartConversationDialog
      {...p}
      directory={{
        status: "ready",
        value: {
          selectedChannel: null,
          data: { channels: [destination], categories: [] },
        },
      }}
    />,
  );
  await waitFor(() => expect(p.choose).toHaveBeenCalledWith(destination));
  expect(p.account.openRecipientConversation).toHaveBeenCalledExactlyOnceWith(
    [own.id],
    expect.any(AbortSignal),
  );
});
test("opens the same group confirmed by the server after selecting in either order", async () => {
  const p = setup();
  const group = room("g".repeat(26), "G", "group-room");
  vi.mocked(p.account.openRecipientConversation).mockResolvedValue({
    kind: "applied",
    channelId: group.id,
    channelKind: "G",
  });
  const directory: WorkspaceRead<TeamSidebar> = {
    status: "ready",
    value: {
      selectedChannel: null,
      data: { channels: [group], categories: [] },
    },
  };
  for (const [index, order] of [
    [1, 2],
    [2, 1],
  ].entries()) {
    const view = render(
      <StartConversationDialog {...p} directory={directory} />,
    );
    for (const i of order)
      fireEvent.click(
        await screen.findByRole("checkbox", { name: `person-${i}` }),
      );
    fireEvent.click(submit());
    await waitFor(() => expect(p.choose).toHaveBeenCalledTimes(index + 1));
    expect(p.account.openRecipientConversation).toHaveBeenNthCalledWith(
      index + 1,
      order.map((i) => person(i).id),
      expect.any(AbortSignal),
    );
    view.unmount();
  }
  expect(p.choose.mock.calls).toEqual([[group], [group]]);
  expect(p.refresh).not.toHaveBeenCalled();
});
test("keeps the selection offline and reports an expired session through the account", async () => {
  const p = setup();
  vi.mocked(p.account.openRecipientConversation).mockResolvedValue({
    kind: "unauthorized",
  });
  const view = render(<StartConversationDialog {...p} />);
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /^person-1(?: |$)/ }),
  );
  view.rerender(<StartConversationDialog {...p} online={false} />);
  expect(submit().getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("1 selected · direct message")).toBeTruthy();
  view.rerender(<StartConversationDialog {...p} />);
  await screen.findByRole("checkbox", { name: /^person-1(?: |$)/ });
  expect(tick("person-1").checked).toBe(true);
  fireEvent.click(submit());
  await waitFor(() =>
    expect(p.sessionIssue).toHaveBeenCalledExactlyOnceWith("unauthorized"),
  );
});

test("selects a local result before remote eligibility and keeps the server order on subsequent pages", async () => {
  const p = setup();
  const later = deferred<{ profiles: typeof peers; nextPage: null }>();
  vi.mocked(p.account.readConversationRecipients).mockImplementation(
    async (_team, q, _signal, partial) => {
      if (q.kind === "page" && q.page === 0)
        return { profiles: [peers[0]], nextPage: 1 };
      partial?.({ profiles: [peers[2]], nextPage: null });
      return later.promise;
    },
  );
  render(<StartConversationDialog {...p} />);
  const more = await screen.findByRole("button", { name: "Show more" });
  fireEvent.click(more);
  const local = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: "person-3",
  });
  fireEvent.click(local);
  local.focus();
  expect(
    screen.getByText("Checking people from other installations…"),
  ).toBeTruthy();
  expect(local.checked).toBe(true);
  expect(screen.queryByRole("checkbox", { name: "person-2" })).toBeNull();
  await act(async () =>
    later.resolve({ profiles: [peers[1], peers[2]], nextPage: null }),
  );
  expect(
    screen
      .getAllByRole("checkbox")
      .map((row) => row.getAttribute("aria-label")),
  ).toEqual(["person-1", "person-2", "person-3"]);
  expect(tick("person-3")).toBe(local);
  expect(local.checked).toBe(true);
  expect(document.activeElement).toBe(local);
  expect(screen.getByText("1 person added")).toBeTruthy();
});

test("keeps paging filtered pages, and restarts at page zero after access is refused", async () => {
  const p = setup();
  const reads = vi.mocked(p.account.readConversationRecipients);
  reads
    .mockResolvedValueOnce({ profiles: [], nextPage: 1 })
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    )
    .mockResolvedValueOnce({ profiles: [peers[0]], nextPage: null });
  const view = render(<StartConversationDialog {...p} />);
  const more = await screen.findByRole("button", { name: "Show more" });
  expect(screen.queryByText("No people found")).toBeNull();
  fireEvent.click(more);
  await screen.findByText("You don’t have access to this list");
  expect(screen.getByRole("searchbox").getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  view.unmount();
  render(<StartConversationDialog {...p} />);
  await screen.findByRole("checkbox", { name: "person-1" });
  expect(reads.mock.calls.map(([, q]) => q)).toEqual([
    { kind: "page", page: 0 },
    { kind: "page", page: 1 },
    { kind: "page", page: 0 },
  ]);
});

test("ignores a superseded search's partial and final recipients", async () => {
  const p = setup();
  const late = deferred<{ profiles: typeof peers; nextPage: null }>();
  let update: Parameters<Account["readConversationRecipients"]>[3];
  let old: AbortSignal | undefined;
  const reads = vi.mocked(p.account.readConversationRecipients);
  reads.mockImplementation(async (_team, q, signal, progress) => {
    if (q.kind === "page") return { profiles: [own], nextPage: null };
    if (q.term === "first") {
      update = progress;
      old = signal;
      progress?.({ profiles: [peers[0]], nextPage: null });
      return late.promise;
    }
    return { profiles: [peers[1]], nextPage: null };
  });
  const view = render(<StartConversationDialog {...p} />);
  const search = screen.getByRole("searchbox");
  fireEvent.input(search, { target: { value: "first" } });
  await screen.findByRole("checkbox", { name: "person-1" });
  fireEvent.input(search, { target: { value: "second" } });
  await screen.findByRole("checkbox", { name: "person-2" });
  expect(old?.aborted).toBe(true);
  await act(async () => {
    update?.({ profiles: [peers[2]], nextPage: null });
    late.resolve({ profiles: [peers[3]], nextPage: null });
  });
  expect(
    screen
      .getAllByRole("checkbox")
      .map((row) => row.getAttribute("aria-label")),
  ).toEqual(["person-2"]);
  view.unmount();
  expect(reads.mock.calls.at(-1)?.[2]?.aborted).toBe(true);
});
