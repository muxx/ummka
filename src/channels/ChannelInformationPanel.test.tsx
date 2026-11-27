import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import { ChannelInformationPanel } from "./ChannelInformationPanel.tsx";
import "./workspace-dom.test-utils.ts";

type Props = ComponentProps<typeof ChannelInformationPanel>;
const teamId = "t".repeat(26),
  channelId = "c".repeat(26),
  userId = "u".repeat(26);
const channel = projectTeamSidebar({
  teamId,
  categories: [],
  channels: [
    {
      channel: {
        id: channelId,
        teamId,
        type: "P",
        displayName: "Releases",
        name: "releases",
        purpose: "**Release communication**",
        header: "Weekly status",
        deleteAt: 0,
      },
      membership: { channelId, userId },
    },
  ],
}).channels[0];
function setup(props: Partial<Props> = {}) {
  const read = vi
    .fn<Props["account"]["readChannelNotifications"]>()
    .mockResolvedValue({ account: { desktop: "mention" }, channel: {} });
  const count = vi
    .fn<Props["account"]["readChannelMemberCount"]>()
    .mockResolvedValue(7);
  const params: Props = {
    account: {
      readChannelMemberCount: count,
      readChannelNotifications: read,
    },
    channel,
    name: "Releases",
    language: "en",
    online: true,
    openPins: vi.fn(),
    focusRow: undefined,
    openMembers: vi.fn(),
    close: vi.fn(),
    sessionIssue: vi.fn(),
    notifications: vi.fn(),
    notificationRevision: 0,
    denied: vi.fn(),
    ...props,
  };
  return {
    view: render(<ChannelInformationPanel {...params} />),
    params,
    read,
    count,
  };
}
afterEach(cleanup);
test("shows metadata, reads the member count once and refreshes the notification summary after a confirmed write", async () => {
  const { read, count, params, view } = setup();
  await screen.findByText("7");
  expect(count.mock.calls[0][0]).toBe(channelId);
  expect(document.activeElement?.textContent).toBe("About this channel");
  expect(screen.getByText("Weekly status")).toBeTruthy();
  expect(screen.getByText("Release communication").tagName).toBe("STRONG");
  const row = screen.getByRole("button", {
    name: /Notifications.*Follows your account/,
  });
  fireEvent.click(row);
  expect(params.notifications).toHaveBeenCalledWith(row);
  read.mockResolvedValue({ account: {}, channel: { markUnread: "mention" } });
  view.rerender(
    <ChannelInformationPanel {...params} notificationRevision={1} />,
  );
  await screen.findByRole("button", { name: /Notifications.*Channel muted/ });
  expect(count).toHaveBeenCalledOnce();
});
test.each(["D", "archived"] as const)(
  "keeps metadata and skips notification reads for %s",
  async (kind) => {
    const { read } = setup({
      notifications: undefined,
      channel:
        kind === "D" ? { ...channel, kind: "D" } : { ...channel, deleteAt: 1 },
    });
    await screen.findByText("7");
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
  },
);
test("offline keeps metadata and never invents a count; reconnection reads once", async () => {
  const { view, params, read, count } = setup({ online: false });
  expect(screen.getByText("Releases", { selector: "section p" })).toBeTruthy();
  expect(screen.queryByText("0")).toBeNull();
  expect(count).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  view.rerender(<ChannelInformationPanel {...params} online />);
  await screen.findByText("7");
  expect(count).toHaveBeenCalledOnce();
});
test("a count failure permits independent retry and a late result after closing has no effect", async () => {
  let resolve!: (n: number) => void;
  const count = vi
    .fn<Props["account"]["readChannelMemberCount"]>()
    .mockRejectedValueOnce(Error("offline"))
    .mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  const read = vi
    .fn<Props["account"]["readChannelNotifications"]>()
    .mockResolvedValue({ account: {}, channel: { desktop: "none" } });
  const { view, params } = setup({
    account: {
      readChannelMemberCount: count,
      readChannelNotifications: read,
    },
  });
  await screen.findByText("Custom channel setting");
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(count).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledOnce();
  view.unmount();
  expect(count.mock.calls[1][1]?.aborted).toBe(true);
  await act(async () => resolve(3));
  expect(params.sessionIssue).not.toHaveBeenCalled();
});
