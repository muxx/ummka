import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { ChannelBookmarksPanel } from "./ChannelBookmarksPanel.tsx";
import {
  AttachmentWindow,
  useAttachmentWindow,
} from "./PublishedAttachments.tsx";
import { PublishedLinkNavigation } from "./PublishedPostLink.tsx";
import { useWorkspaceBack } from "./use-workspace-back.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import "./workspace-dom.test-utils.ts";

const channel = "c".repeat(26),
  other = "o".repeat(26),
  fileId = "f".repeat(26),
  base = "https://chat.example/mm";
function fixture() {
  const readChannelBookmarks =
    vi.fn<WorkspaceConnection["readChannelBookmarks"]>();
  const account = {
    readChannelBookmarks,
    createChannelBookmark:
      vi.fn<WorkspaceConnection["createChannelBookmark"]>(),
    updateChannelBookmark:
      vi.fn<WorkspaceConnection["updateChannelBookmark"]>(),
    deleteChannelBookmark:
      vi.fn<WorkspaceConnection["deleteChannelBookmark"]>(),
    readChannelFile: vi.fn<WorkspaceConnection["readChannelFile"]>(),
    readPostFiles: vi.fn<WorkspaceConnection["readPostFiles"]>(),
  };
  const open = vi.fn(),
    sessionIssue = vi.fn(),
    back = vi.fn();
  return {
    account,
    open,
    sessionIssue,
    back,
    can: vi.fn<
      (
        action: "add" | "edit" | "delete",
        kind?: "link" | "file" | "board",
      ) => boolean
    >(() => false),
  };
}
function Panel({
  ctx: { account, open, sessionIssue, back, can },
  id = channel,
  online = true,
}: {
  ctx: ReturnType<typeof fixture>;
  id?: string;
  online?: boolean;
}) {
  const attachment = useAttachmentWindow(
    { connection: account, online, sessionIssue },
    id,
    "# Releases",
  );
  useWorkspaceBack(Boolean(attachment.selected), back);
  return (
    <PublishedLinkNavigation
      value={{ open: vi.fn(), openBookmark: open, serverUrl: base }}
    >
      <AttachmentWindow value={attachment}>
        <ChannelBookmarksPanel
          key={id}
          account={account}
          can={can}
          channelId={id}
          name="# Releases"
          serverUrl={base}
          online={online}
          language="en"
          back={back}
          sessionIssue={sessionIssue}
        />
      </AttachmentWindow>
    </PublishedLinkNavigation>
  );
}
afterEach(cleanup);
test("server ordering, scoped file preview, restricted files and the installation-relative board", async () => {
  const ctx = fixture(),
    { account, open } = ctx;
  const savedFile = {
    id: "f",
    name: "Runbook",
    imageUrl: "https://[fe80::1%25en0]/icon.png",
    destination: {
      kind: "file" as const,
      fileId,
      fileName: "manual.md",
      fileMimeType: "text/markdown",
    },
  };
  account.readChannelBookmarks.mockResolvedValue({
    kind: "available",
    bookmarks: [
      {
        id: "b",
        name: "Planning",
        destination: {
          kind: "board",
          targetId: "d".repeat(26),
          path: "/boards/team/plan",
        },
      },
      savedFile,
      {
        id: "r",
        name: "Restricted",
        destination: {
          kind: "file",
          fileId: "x".repeat(26),
          fileName: null,
          fileMimeType: null,
        },
      },
    ],
  });
  account.readChannelFile.mockResolvedValue({
    file: {
      id: fileId,
      name: "manual.md",
      mimeType: "text/markdown",
      size: 123,
    },
    postId: null,
  });
  render(<Panel ctx={ctx} />);
  const list = within(await screen.findByRole("list"));
  const rows = list.getAllByRole<HTMLButtonElement>("button");
  expect(rows.map((x) => x.querySelector("strong")?.textContent)).toEqual([
    "Planning",
    "Runbook",
    "Restricted",
  ]);
  expect(rows[1].querySelector("img")).toBeNull();
  expect(rows[2].disabled).toBe(true);
  expect(rows[2].textContent).toContain("File unavailable");
  expect(account.readChannelFile).not.toHaveBeenCalled();
  fireEvent.click(rows[1]);
  fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
  const details = within(
    await screen.findByRole("dialog", { name: "manual.md" }),
  );
  await details.findByText("MD");
  expect(rows[1].textContent).toContain("text/markdown");
  expect(account.readChannelFile).toHaveBeenCalledExactlyOnceWith(
    channel,
    fileId,
    expect.any(AbortSignal),
  );
  fireEvent.click(details.getByRole("button", { name: "Close" }));
  fireEvent.click(rows[0]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Open board in browser" }),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith(
    { kind: "board", href: base + "/boards/team/plan" },
    rows[0],
  );
});
test("network retry, license refusal, missing permission and session expiry remain distinct", async () => {
  const ctx = fixture(),
    { account, sessionIssue } = ctx;
  account.readChannelBookmarks
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce({ kind: "unlicensed" })
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    )
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 401 })),
    );
  const view = render(<Panel ctx={ctx} online={false} />);
  await screen.findByText("Connect to see channel bookmarks.");
  expect(account.readChannelBookmarks).not.toHaveBeenCalled();
  view.rerender(<Panel ctx={ctx} />);
  await screen.findByText("Couldn’t load channel bookmarks.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Channel bookmarks aren’t available on this server.");
  view.rerender(<Panel ctx={ctx} id={other} />);
  await screen.findByText("You don’t have access to these bookmarks.");
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  view.rerender(<Panel ctx={ctx} />);
  await waitFor(() =>
    expect(sessionIssue).toHaveBeenCalledExactlyOnceWith("unauthorized"),
  );
});
test("switching channels cancels the read and ignores a late list from the previous channel", async () => {
  const ctx = fixture(),
    { account } = ctx;
  type Listing = Awaited<ReturnType<typeof account.readChannelBookmarks>>;
  let resolve!: (list: Listing) => void;
  const pending = new Promise<Listing>((done) => {
    resolve = done;
  });
  account.readChannelBookmarks
    .mockReturnValueOnce(pending)
    .mockResolvedValue({ kind: "available", bookmarks: [] });
  const view = render(<Panel ctx={ctx} />);
  const signal = account.readChannelBookmarks.mock.calls[0][1];
  view.rerender(<Panel ctx={ctx} id={other} />);
  expect(signal?.aborted).toBe(true);
  await screen.findByText("No bookmarks yet");
  await act(async () =>
    resolve({
      kind: "available",
      bookmarks: [
        {
          id: "a",
          name: "Previous private channel",
          destination: { kind: "link", href: base },
        },
      ],
    }),
  );
  expect(screen.queryByText("Previous private channel")).toBeNull();
  expect(screen.getByText("No bookmarks yet")).toBeTruthy();
});

test("creates once, applies a replacement ID, and confirms deletion without reloading the list", async () => {
  const ctx = fixture();
  ctx.can.mockReturnValue(true);
  const link = {
    id: "b".repeat(26),
    name: "Guide",
    destination: { kind: "link" as const, href: "https://example.org/guide" },
  };
  ctx.account.readChannelBookmarks.mockResolvedValue({
    kind: "available",
    bookmarks: [],
  });
  render(<Panel ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add link" }));
  let dialog = within(screen.getByRole("dialog", { name: "Add link" }));
  fireEvent.change(dialog.getByLabelText("Name"), {
    target: { value: "Guide" },
  });
  fireEvent.change(dialog.getByLabelText("Link address"), {
    target: { value: link.destination.href },
  });
  let finish!: (row: typeof link) => void;
  ctx.account.createChannelBookmark.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const save = dialog.getByRole("button", { name: "Save" });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(ctx.account.createChannelBookmark).toHaveBeenCalledTimes(1);
  expect(ctx.account.createChannelBookmark).toHaveBeenCalledWith(
    channel,
    { type: "link", displayName: "Guide", linkUrl: link.destination.href },
    expect.any(AbortSignal),
  );
  await act(async () => finish(link));
  let row = await screen.findByRole("button", { name: "Guide" });
  expect(document.activeElement).toBe(row);
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  dialog = within(screen.getByRole("dialog", { name: "Edit bookmark" }));
  expect(
    (dialog.getByLabelText("Link address") as HTMLInputElement).value,
  ).toBe(link.destination.href);
  fireEvent.change(dialog.getByLabelText("Name"), {
    target: { value: "Updated" },
  });
  const updated = { ...link, id: "n".repeat(26), name: "Updated" };
  ctx.account.updateChannelBookmark.mockResolvedValue({
    updated,
    removedId: link.id,
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  row = await screen.findByRole("button", { name: "Updated" });
  expect(ctx.account.updateChannelBookmark).toHaveBeenCalledWith(
    channel,
    link,
    { displayName: "Updated" },
    expect.any(AbortSignal),
  );
  expect(document.activeElement).toBe(row);
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  dialog = within(screen.getByRole("dialog", { name: "Delete bookmark?" }));
  expect(document.activeElement).toBe(
    dialog.getByRole("button", { name: "Cancel" }),
  );
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(ctx.account.deleteChannelBookmark).not.toHaveBeenCalled();
  const restoredMenu = within(screen.getByRole("dialog", { name: "Updated" }));
  expect(document.activeElement).toBe(
    restoredMenu.getByRole("button", { name: "Delete" }),
  );
  fireEvent.click(restoredMenu.getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(row);
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  ctx.account.deleteChannelBookmark.mockResolvedValue(updated.id);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete bookmark?" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );
  await screen.findByText("No bookmarks yet");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Add link" }),
  );
  expect(ctx.account.deleteChannelBookmark).toHaveBeenCalledWith(
    channel,
    updated,
    expect.any(AbortSignal),
  );
  expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(1);
});

test("keeps an uncertain creation visible and refreshes before another attempt", async () => {
  const ctx = fixture();
  ctx.can.mockReturnValue(true);
  ctx.account.readChannelBookmarks.mockResolvedValue({
    kind: "available",
    bookmarks: [],
  });
  ctx.account.createChannelBookmark.mockRejectedValue(new TypeError("network"));
  render(<Panel ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add link" }));
  const dialog = within(screen.getByRole("dialog", { name: "Add link" }));
  fireEvent.change(dialog.getByLabelText("Name"), {
    target: { value: "Draft" },
  });
  fireEvent.change(dialog.getByLabelText("Link address"), {
    target: { value: "https://example.org/" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await dialog.findByRole("alert");
  expect((dialog.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Draft",
  );
  expect(
    (dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(2),
  );
  expect(ctx.account.createChannelBookmark).toHaveBeenCalledTimes(1);
});

test("a permitted file rename stays available when the file itself is restricted", async () => {
  const ctx = fixture();
  ctx.can.mockImplementation((action: string) => action === "edit");
  const hidden = {
    id: "b".repeat(26),
    name: "Plan",
    destination: {
      kind: "file" as const,
      fileId,
      fileName: null,
      fileMimeType: null,
    },
  };
  ctx.account.readChannelBookmarks.mockResolvedValue({
    kind: "available",
    bookmarks: [hidden],
  });
  render(<Panel ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Plan" }));
  expect(screen.queryByRole("button", { name: "Open file" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = within(screen.getByRole("dialog", { name: "Edit bookmark" }));
  expect(dialog.queryByLabelText("Link address")).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  expect(ctx.account.updateChannelBookmark).not.toHaveBeenCalled();
  const row = screen.getByRole("button", { name: "Plan" });
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const reopened = screen.getByRole("dialog", { name: "Edit bookmark" });
  fireEvent.click(reopened, { clientX: 0, clientY: 0 });
  expect(reopened.hasAttribute("open")).toBe(true);
  fireEvent.click(reopened, { clientX: 900, clientY: 900 });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(row);
  expect(ctx.account.updateChannelBookmark).not.toHaveBeenCalled();
});

test.each(["saved", "uncertain"] as const)(
  "closing an in-flight editor waits for its %s outcome before allowing another write",
  async (outcome) => {
    const ctx = fixture();
    ctx.can.mockReturnValue(true);
    const link = {
      id: "x".repeat(26),
      name: "Style guide",
      destination: { kind: "link" as const, href: "https://example.org/guide" },
    };
    ctx.account.readChannelBookmarks
      .mockResolvedValueOnce({ kind: "available", bookmarks: [] })
      .mockResolvedValue({ kind: "available", bookmarks: [link] });
    let finish!: () => void;
    ctx.account.createChannelBookmark.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === "saved"
              ? resolve(link)
              : reject(new Error("disconnected"));
        }),
    );
    render(<Panel ctx={ctx} />);
    const add = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Add link",
    });
    fireEvent.click(add);
    const dialog = within(screen.getByRole("dialog", { name: "Add link" }));
    fireEvent.change(dialog.getByLabelText("Name"), {
      target: { value: link.name },
    });
    fireEvent.change(dialog.getByLabelText("Link address"), {
      target: { value: link.destination.href },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByText("Saving bookmark…");
    expect(add.disabled).toBe(true);
    expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(1);
    expect(ctx.account.createChannelBookmark.mock.calls[0][2]?.aborted).toBe(
      false,
    );
    const heading = screen.getByRole("heading", { name: "Channel bookmarks" });
    expect(document.activeElement).toBe(heading);
    await act(async () => finish());
    await screen.findByRole("button", { name: link.name });
    expect(screen.queryByText("Saving bookmark…")).toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(ctx.account.createChannelBookmark).toHaveBeenCalledTimes(1);
    expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(
      outcome === "saved" ? 1 : 2,
    );
  },
);

test("keeps the draft during an outage and only reads on reconnect after an uncertain write", async () => {
  const ctx = fixture();
  ctx.can.mockReturnValue(true);
  const original = {
    id: "x".repeat(26),
    name: "Deployment guide",
    destination: { kind: "link" as const, href: "https://example.org/deploy" },
  };
  ctx.account.readChannelBookmarks
    .mockResolvedValueOnce({ kind: "available", bookmarks: [] })
    .mockResolvedValue({ kind: "available", bookmarks: [original] });
  let reject!: (error: Error) => void;
  ctx.account.createChannelBookmark.mockImplementationOnce(
    () =>
      new Promise((_, rejectWrite) => {
        reject = rejectWrite;
      }),
  );
  const panel = render(<Panel ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add link" }));
  let dialog = within(screen.getByRole("dialog", { name: "Add link" }));
  fireEvent.change(dialog.getByLabelText("Name"), {
    target: { value: original.name },
  });
  fireEvent.change(dialog.getByLabelText("Link address"), {
    target: { value: original.destination.href },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));

  panel.rerender(<Panel ctx={ctx} online={false} />);
  dialog = within(screen.getByRole("dialog", { name: "Add link" }));
  expect(ctx.account.createChannelBookmark.mock.calls[0][2]?.aborted).toBe(
    false,
  );
  expect(
    dialog.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
  ).toBe(true);
  await act(async () => reject(new Error("Connection lost")));
  await dialog.findByRole("alert");
  expect(dialog.getByLabelText<HTMLInputElement>("Name").value).toBe(
    original.name,
  );
  expect(dialog.getByLabelText<HTMLInputElement>("Link address").value).toBe(
    original.destination.href,
  );
  fireEvent.click(dialog.getByRole("button", { name: "Close" }));
  expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(1);
  await screen.findByText("Connect to see channel bookmarks.");

  panel.rerender(<Panel ctx={ctx} />);
  await screen.findByRole("button", { name: original.name });
  expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(2);
  expect(ctx.account.createChannelBookmark).toHaveBeenCalledTimes(1);
});

test("a late confirmation from another channel does not update the current bookmarks or move focus", async () => {
  const ctx = fixture();
  ctx.can.mockReturnValue(true);
  const original = {
    id: "x".repeat(26),
    name: "Old channel guide",
    destination: { kind: "link" as const, href: "https://example.org/guide" },
  };
  const current = {
    ...original,
    id: "b".repeat(26),
    name: "New channel guide",
  };
  ctx.account.readChannelBookmarks.mockImplementation(async (id) => ({
    kind: "available",
    bookmarks: id === channel ? [] : [current],
  }));
  let finish!: (bookmark: typeof original) => void;
  ctx.account.createChannelBookmark.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const panel = render(<Panel ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add link" }));
  const dialog = within(screen.getByRole("dialog", { name: "Add link" }));
  fireEvent.change(dialog.getByLabelText("Name"), {
    target: { value: original.name },
  });
  fireEvent.change(dialog.getByLabelText("Link address"), {
    target: { value: original.destination.href },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  panel.rerender(<Panel ctx={ctx} id={other} />);
  const row = await screen.findByRole("button", { name: current.name });
  row.focus();
  expect(ctx.account.createChannelBookmark.mock.calls[0][2]?.aborted).toBe(
    true,
  );
  await act(async () => finish(original));
  expect(screen.queryByRole("button", { name: original.name })).toBeNull();
  expect(document.activeElement).toBe(row);
  expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(2);
});

test("after deleting a bookmark, focus advances past rows without any available action", async () => {
  const ctx = fixture();
  ctx.can.mockImplementation(
    (action, kind) => action === "delete" && kind === "link",
  );
  const first = {
    id: "x".repeat(26),
    name: "First link",
    destination: { kind: "link" as const, href: "https://example.org/guide" },
  };
  const hidden = {
    id: "f".repeat(26),
    name: "Restricted file",
    destination: {
      kind: "file" as const,
      fileId,
      fileName: null,
      fileMimeType: null,
    },
  };
  const last = { ...first, id: "b".repeat(26), name: "Last link" };
  ctx.account.readChannelBookmarks.mockResolvedValue({
    kind: "available",
    bookmarks: [first, hidden, last],
  });
  ctx.account.deleteChannelBookmark.mockResolvedValue(first.id);
  render(<Panel ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: first.name }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete bookmark?" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: first.name })).toBeNull(),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: last.name }),
  );
  expect(ctx.account.readChannelBookmarks).toHaveBeenCalledTimes(1);
});
