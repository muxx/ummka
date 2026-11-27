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
import type { EntryLanguage } from "../entry/language.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import { ChannelTimeline } from "./ChannelTimeline.tsx";
import {
  AttachmentWindow,
  useAttachmentWindow,
} from "./PublishedAttachments.tsx";
import type { PublishedFile } from "./post-attachment-cards.ts";
import { useWorkspaceBack } from "./use-workspace-back.ts";
import "./workspace-dom.test-utils.ts";

const a = "a".repeat(26),
  b = "b".repeat(26),
  c = "c".repeat(26);
const room = "k".repeat(26);
const end = { kind: "end" } as const;
function message(attachments: LocalPost["attachments"], index = 0): LocalPost {
  return {
    id: `${index}`.padStart(26, "p"),
    channelId: room,
    userId: "u".repeat(26),
    rootId: null,
    createAt: index,
    updateAt: index,
    editAt: 0,
    message: "",
    messageSource: null,
    hashtags: "",
    isPinned: false,
    type: "",
    attachments,
  };
}
function Timeline({
  rows,
  connected,
  scope,
  owner,
  language,
}: {
  rows: LocalPost[];
  connected: boolean;
  scope: string;
  owner: Pick<
    Parameters<typeof useAttachmentWindow>[0],
    "connection" | "sessionIssue"
  >;
  language: EntryLanguage;
}) {
  const files = useAttachmentWindow(
    { ...owner, online: connected },
    scope,
    "# General",
  );
  useWorkspaceBack(Boolean(files.selected), null);
  return (
    <AttachmentWindow value={files}>
      <ChannelTimeline
        channelId={room}
        page={{
          posts: rows,
          older: end,
          newer: end,
          firstInaccessiblePostTime: 0,
        }}
        locale={language}
        timeZone="UTC"
        author={() => undefined}
        offline={!connected}
      />
    </AttachmentWindow>
  );
}
function setup(
  posts: LocalPost[],
  language: EntryLanguage = "en",
  online = true,
) {
  const readPostFiles =
    vi.fn<
      (
        _room: string,
        _post: string,
        _signal?: AbortSignal,
      ) => Promise<PublishedFile[]>
    >();
  const sessionIssue = vi.fn();
  const connection = { readPostFiles };
  const owner = { connection, sessionIssue };
  const result = render(
    <Timeline
      owner={owner}
      language={language}
      rows={posts}
      connected={online}
      scope="first"
    />,
  );
  return {
    readPostFiles,
    sessionIssue,
    change: (rows: LocalPost[], connected = online, scope = "first") =>
      result.rerender(
        <Timeline
          owner={owner}
          language={language}
          rows={rows}
          connected={connected}
          scope={scope}
        />,
      ),
  };
}
beforeEach(() => {
  // jsdom has no layout. The real WebViews check visibility and focus independently.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("renders only server-observed cards, orders by identity, and restores the chosen duplicate offline", async () => {
  const post = message({
    fileIds: [b, a],
    files: [
      { id: a, name: "same.pdf", size: 1024, mimeType: "application/pdf" },
      {
        id: c,
        name: "photo.png",
        mimeType: "image/png",
        width: 20,
        height: 30,
      },
      { id: b, name: "same.pdf", size: 0, archived: true },
    ],
  });
  const f = setup([post], "ru", false);
  const cards = screen.getAllByRole("button", { name: /Открыть вложение/ });
  expect(cards.map((el) => el.dataset.fileId)).toEqual([b, a, c]);
  expect(cards[0].getAttribute("aria-label")).toContain("0 Б, В архиве");
  fireEvent.click(cards[1]);
  const modal = screen.getByRole("dialog", { name: "same.pdf" });
  expect(within(modal).getByText("1 КБ")).toBeTruthy();
  expect(within(modal).getByText("PDF")).toBeTruthy();
  const close = within(modal).getByRole("button", { name: "Закрыть" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(cards[1]));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(f.readPostFiles).not.toHaveBeenCalled();
});

test("60 file-only posts do not fetch before activation and the open reads only the requested file", async () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    message({ fileIds: [a, b] }, i),
  );
  const f = setup(rows);
  expect(
    screen.getAllByRole("button", { name: /Open attachment/ }),
  ).toHaveLength(120);
  expect(f.readPostFiles).not.toHaveBeenCalled();
  f.readPostFiles.mockResolvedValueOnce([
    { id: b, name: "two.txt" },
    { id: a, name: "first.pdf" },
  ]);
  const trigger = screen.getAllByRole("button", {
    name: "Open attachment 1, details on server",
  })[0];
  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", { name: "first.pdf" })).toBeTruthy();
  expect(f.readPostFiles).toHaveBeenCalledTimes(1);
  expect(f.readPostFiles).toHaveBeenCalledWith(
    room,
    trigger.closest("article")?.dataset.postId,
    expect.any(AbortSignal),
  );
  expect(screen.queryByText("two.txt")).toBeNull();
});

test("a newer redaction erases the open file, returns to the row, and cannot resurrect it after refresh", async () => {
  const post = message({ fileIds: [a] });
  const f = setup([post], "ru");
  let done!: (value: PublishedFile[]) => void;
  f.readPostFiles.mockReturnValueOnce(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  const button = screen.getByRole("button", { name: /Открыть вложение/ });
  fireEvent.click(button);
  const observed = f.readPostFiles.mock.calls[0][2];
  const row = button.closest("article");
  f.change([
    message({
      redactedFileCount: 2,
      fileIds: [a],
      files: [{ id: a, name: "redacted.txt" }],
    }),
  ]);
  expect(screen.getByText("2 скрытых вложения")).toBeTruthy();
  expect(screen.queryByText("redacted.txt")).toBeNull();
  expect(observed?.aborted).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => done([{ id: a, name: "earlier.txt" }]));
  expect(screen.queryByText("earlier.txt")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(row));
  f.change([post]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(f.readPostFiles).toHaveBeenCalledTimes(1);
});

test("distinguishes missing, forbidden, retryable errors and offline metadata", async () => {
  const post = message({ fileIds: [a] });
  const f = setup([post], "en", false);
  const trigger = () => screen.getByRole("button", { name: /Open attachment/ });
  fireEvent.click(trigger());
  expect(
    screen.getByText("File details aren’t saved on this device."),
  ).toBeTruthy();
  expect(f.readPostFiles).not.toHaveBeenCalled();
  f.change([post], true);
  expect(f.readPostFiles).not.toHaveBeenCalled();
  f.readPostFiles.mockRejectedValueOnce(new TypeError("network"));
  fireEvent.click(screen.getByRole("button", { name: "Load details" }));
  expect(await screen.findByText("Couldn’t load file details.")).toBeTruthy();
  f.readPostFiles.mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("File details are unavailable.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  f.readPostFiles.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  fireEvent.click(trigger());
  expect(
    await screen.findByText("You don’t have access to this file."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  f.readPostFiles.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 404 })),
  );
  fireEvent.click(trigger());
  expect(
    await screen.findByText("The message or file is no longer on the server."),
  ).toBeTruthy();
  expect(f.readPostFiles).toHaveBeenCalledTimes(4);
});

test("ignores an old selection after another card or account has taken focus", async () => {
  const post = message({ fileIds: [a, b] });
  const f = setup([post]);
  let done!: (value: PublishedFile[]) => void;
  f.readPostFiles.mockReturnValueOnce(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Open attachment 1/ }));
  const one = f.readPostFiles.mock.calls[0][2];
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  f.readPostFiles.mockResolvedValueOnce([{ id: b, name: "second.txt" }]);
  fireEvent.click(screen.getByRole("button", { name: /Open attachment 2/ }));
  const dialog = await screen.findByRole("dialog", { name: "second.txt" });
  await act(async () => done([{ id: a, name: "old.txt" }]));
  expect(one?.aborted).toBe(true);
  expect(screen.queryByText("old.txt")).toBeNull();
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "Close" }),
  );
  f.change([post], true, "other-account");
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {});
  expect(document.activeElement).toBe(document.body);
});

test("cancelling an in-flight metadata read keeps the dialog open and discards its late response", async () => {
  const f = setup([message({ fileIds: [a] })]);
  let deliver!: (files: PublishedFile[]) => void;
  f.readPostFiles.mockReturnValueOnce(
    new Promise((resolve) => {
      deliver = resolve;
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Open attachment 1, details on server",
    }),
  );
  const signal = f.readPostFiles.mock.calls[0][2];
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(signal?.aborted).toBe(true);
  await act(async () => deliver([{ id: a, name: "obsolete" }]));
  expect(screen.queryByText("obsolete")).toBeNull();
  f.readPostFiles.mockResolvedValueOnce([
    { id: a, name: "report", mimeType: "text/plain" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Load details" }));
  const details = await screen.findByRole("dialog", { name: "report" });
  expect(within(details).getByText("text/plain")).toBeTruthy();
  f.change([message({ fileIds: [a] })], false);
  expect(screen.getByRole("dialog", { name: "report" })).toBeTruthy();
});

test("announces the server-details cue in the language of an unnamed attachment", () => {
  setup([message({ fileIds: [a] })], "ru");
  expect(
    screen.getByRole("button", {
      name: "Открыть вложение 1, сведения на сервере",
    }),
  ).toBeTruthy();
});
