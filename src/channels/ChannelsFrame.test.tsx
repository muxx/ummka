import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChannelsFrame } from "./ChannelsFrame";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const labels = {
  navigation: "Channels",
  chooseTeam: "Switch team",
  account: "Alex's account",
  closeThread: "Close thread",
};
function frame() {
  return {
    labels,
    teamName: "Aurora",
    accountName: "Alex",
    emptyTitle: "Choose a channel",
    channel: { id: "general", title: "General" },
    page: "conversation" as const,
    navigation: (
      <button type="button" aria-current="page">
        General row
      </button>
    ),
    onNavigation: vi.fn(),
    onTeam: vi.fn(),
    onAccount: vi.fn(),
    children: (
      <>
        <input aria-label="Draft" />
        <button type="button">Open replies</button>
        <button type="button">Open another thread</button>
      </>
    ),
  };
}

test("keeps one named conversation and wires the team, account and navigation actions", () => {
  const props = frame();
  const { rerender } = render(<ChannelsFrame {...props} />);
  const mobile = ["android", "ios"].includes(
    process.env.TAURI_ENV_PLATFORM ?? "",
  );
  expect(Boolean(screen.queryByRole("img", { name: "ummka" }))).toBe(mobile);
  expect(screen.getByRole("main", { name: "General" })).toBeTruthy();
  const account = screen.getByRole("button", { name: labels.account });
  expect(account.hasAttribute("data-tauri-drag-region")).toBe(false);
  fireEvent.click(account);
  fireEvent.click(screen.getByRole("button", { name: "Switch team, Aurora" }));
  fireEvent.click(screen.getByRole("button", { name: labels.navigation }));
  expect(props.onAccount).toHaveBeenCalledOnce();
  expect(props.onTeam).toHaveBeenCalledOnce();
  expect(props.onNavigation).toHaveBeenCalledOnce();
  rerender(<ChannelsFrame {...props} channel={null} />);
  expect(screen.getByRole("main", { name: "Choose a channel" })).toBeTruthy();
});

test("restores the thread opener, or the heading after removal, and keeps the conversation mounted", () => {
  const props = frame();
  const { rerender } = render(<ChannelsFrame {...props} />);
  const draft = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(draft, { target: { value: "Local draft" } });
  const open = screen.getByRole("button", { name: "Open replies" });
  const thread = {
    id: "post",
    title: "Replies",
    subtitle: "# General",
    content: <p>Reply content</p>,
    close: vi.fn(),
  };
  // A pointer click in WebKit can open a thread without focusing the button.
  fireEvent.click(open);
  rerender(<ChannelsFrame {...props} thread={thread} />);
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Replies", description: "# General" }),
  );
  // A desktop reader can return to the draft while the thread stays visible.
  draft.focus();
  fireEvent.click(screen.getByRole("button", { name: labels.closeThread }));
  expect(thread.close).toHaveBeenCalledOnce();
  rerender(<ChannelsFrame {...props} />);
  expect(document.activeElement).toBe(open);
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.value).toBe("Local draft");
  rerender(<ChannelsFrame {...props} thread={thread} />);
  rerender(
    <ChannelsFrame {...props} thread={thread}>
      <p>Post was removed</p>
    </ChannelsFrame>,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Replies" }),
  );
  rerender(
    <ChannelsFrame {...props}>
      <p>Post was removed</p>
    </ChannelsFrame>,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "General" }),
  );
});

test("restores the second opener after switching threads and clicking back into the conversation", () => {
  const props = frame();
  const { rerender } = render(<ChannelsFrame {...props} />);
  const first = screen.getByRole("button", { name: "Open replies" });
  const second = screen.getByRole("button", { name: "Open another thread" });
  const thread = {
    id: "first",
    title: "First thread",
    subtitle: "# General",
    content: <p>First reply</p>,
    close: vi.fn(),
  };
  const otherContext =
    "Darya Morozova, Egor Zimin, Alexandra Severova, Gleb Torosov";
  fireEvent.click(first);
  rerender(<ChannelsFrame {...props} thread={thread} />);
  fireEvent.click(second);
  rerender(
    <ChannelsFrame
      {...props}
      thread={{
        ...thread,
        id: "second",
        title: "Second thread",
        subtitle: otherContext,
      }}
    />,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", {
      name: "Second thread",
      description: otherContext,
    }),
  );
  fireEvent.click(screen.getByRole("textbox"));
  rerender(<ChannelsFrame {...props} />);
  expect(document.activeElement).toBe(second);
});

test("returns to the selected sidebar row or the team control when the row disappears", () => {
  const props = frame();
  const { rerender } = render(<ChannelsFrame {...props} />);
  rerender(<ChannelsFrame {...props} page="navigation" />);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "General row" }),
  );
  rerender(<ChannelsFrame {...props} />);
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "General" }),
  );
  rerender(<ChannelsFrame {...props} navigation={null} page="navigation" />);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Switch team, Aurora" }),
  );
});
