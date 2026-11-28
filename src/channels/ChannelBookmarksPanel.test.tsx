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
    readChannelFile: vi.fn<WorkspaceConnection["readChannelFile"]>(),
    readPostFiles: vi.fn<WorkspaceConnection["readPostFiles"]>(),
  };
  const open = vi.fn(),
    sessionIssue = vi.fn(),
    back = vi.fn();
  return { account, open, sessionIssue, back };
}
function Panel({
  ctx: { account, open, sessionIssue, back },
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
