import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { channelProfile } from "../mattermost/channel-profiles.ts";
import { ChannelMembersPanel } from "./ChannelMembersPanel.tsx";

type Props = ComponentProps<typeof ChannelMembersPanel>;
const member = (username: string, guest = false) => ({
  profile: channelProfile({
    id: username.padEnd(26, "c"),
    username,
    firstName: username,
    lastName: "Example",
  }),
  schemeGuest: guest,
  schemeAdmin: false,
  roles: "channel_user",
});
const ada = member("ada"),
  lin = member("lin", true);
type Page = Awaited<ReturnType<Props["account"]["readChannelMemberDirectory"]>>;
function setup() {
  const read = vi.fn<Props["account"]["readChannelMemberDirectory"]>();
  const props: Props = {
    account: { readChannelMemberDirectory: read },
    channelId: "c".repeat(26),
    name: "Releases",
    nameFormat: "full_name",
    language: "en",
    online: true,
    back: vi.fn(),
    close: vi.fn(),
    sessionIssue: vi.fn(),
  };
  return { props, read };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
test("paginates at the visible boundary, deduplicates in server order and retries the same page", async () => {
  const observed = vi.fn<(target: Element, enter: () => void) => void>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private readonly onIntersection: (
          entries: { isIntersecting: boolean; intersectionRatio: number }[],
        ) => void,
      ) {}
      observe(target: Element) {
        observed(target, () =>
          this.onIntersection([{ isIntersecting: true, intersectionRatio: 1 }]),
        );
      }
      disconnect() {}
    },
  );
  const { props, read } = setup();
  read
    .mockResolvedValueOnce({ members: [ada], nextPage: 1 })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ members: [ada, lin], nextPage: null });
  render(<ChannelMembersPanel {...props} />);
  const more = await screen.findByRole("button", { name: "Show more members" });
  const enter = await waitFor(() => {
    expect(observed).toHaveBeenCalledExactlyOnceWith(
      more,
      expect.any(Function),
    );
    return observed.mock.calls[0][1];
  });
  more.focus();
  act(enter);
  const retry = await screen.findByRole("button", { name: "Try again" });
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry);
  expect((await screen.findByText("Guest")).closest("li")).toBe(
    document.activeElement,
  );
  expect(
    screen
      .getAllByRole("listitem")
      .map((r) => r.querySelector("strong")?.textContent),
  ).toEqual(["ada Example", "lin Example"]);
  expect(read.mock.calls.map((call) => call[1])).toEqual([
    { kind: "page", page: 0 },
    { kind: "page", page: 1 },
    { kind: "page", page: 1 },
  ]);
});
test("keeps focus in the list when the last page contains only existing members", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { props, read } = setup();
  read
    .mockResolvedValueOnce({ members: [ada, lin], nextPage: 1 })
    .mockResolvedValueOnce({ members: [lin], nextPage: null });
  render(<ChannelMembersPanel {...props} />);
  const more = await screen.findByRole("button", { name: "Show more members" });
  more.focus();
  await act(async () => fireEvent.click(more));
  expect(
    screen.queryByRole("button", { name: "Show more members" }),
  ).toBeNull();
  expect(document.activeElement).toBe(screen.getAllByRole("listitem").at(-1));
});
test("a new search cancels in-flight reads; an old response cannot replace the current query", async () => {
  vi.useFakeTimers();
  const { props, read } = setup();
  let resolvePage: ((p: Page) => void) | undefined;
  read
    .mockImplementationOnce(
      () =>
        new Promise<Page>((resolve) => {
          resolvePage = resolve;
        }),
    )
    .mockResolvedValueOnce({ members: [lin], nextPage: null })
    .mockResolvedValueOnce({ members: [], nextPage: null });
  render(<ChannelMembersPanel {...props} />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "li" } });
  fireEvent.change(input, { target: { value: " lin " } });
  expect(read.mock.calls[0][2]?.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(99));
  expect(read).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(read.mock.calls[1][1]).toEqual({ kind: "search", term: "lin" });
  await act(async () => {
    resolvePage?.({ members: [ada], nextPage: null });
  });
  expect(screen.queryByText("@ada")).toBeNull();
  expect(screen.getByText("@lin")).toBeTruthy();
  await act(async () => fireEvent.change(input, { target: { value: "" } }));
  expect(screen.getByText("No members to show")).toBeTruthy();
});
test("an access denial drops previously visible rows; offline and session expiry do not expose the list", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { props, read } = setup();
  read
    .mockResolvedValueOnce({ members: [ada], nextPage: 1 })
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    )
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 401 })),
    );
  const view = render(<ChannelMembersPanel {...props} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Show more members" }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("@ada")).toBeNull();
  view.rerender(<ChannelMembersPanel {...props} online={false} />);
  expect(screen.getByRole("status").textContent).toContain("Connect");
  expect(read).toHaveBeenCalledTimes(2);
  view.rerender(<ChannelMembersPanel {...props} />);
  await screen.findByRole("alert");
  expect(props.sessionIssue).toHaveBeenCalledWith("unauthorized");
});
