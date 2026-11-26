import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ChannelNotificationsDialog } from "./ChannelNotificationsDialog.tsx";
import "./workspace-dom.test-utils.ts";

type Props = ComponentProps<typeof ChannelNotificationsDialog>;
const initial = {
  account: {
    desktop: "mention",
    push: "mention",
    desktopNotificationSound: "Bing",
  },
  channel: { desktop: "all" },
};
function setup(overrides: Partial<Props> = {}) {
  const read = vi
    .fn<Props["account"]["readChannelNotifications"]>()
    .mockResolvedValue(initial);
  const write = vi
    .fn<Props["account"]["updateChannelNotifications"]>()
    .mockResolvedValue(undefined);
  const props: Props = {
    channelId: "c".repeat(26),
    kind: "O",
    name: "Release runway",
    account: {
      readChannelNotifications: read,
      updateChannelNotifications: write,
    },
    online: true,
    collapsed: true,
    language: "en",
    saved: vi.fn(),
    back: vi.fn(),
    dismiss: vi.fn(),
    sessionIssue: vi.fn(),
    ...overrides,
  };
  const view = render(<ChannelNotificationsDialog {...props} />);
  return { props, read, write, view };
}
afterEach(cleanup);
const button = (name: string) => screen.getByRole("button", { name });
const group = (name: string) => within(screen.getByRole("group", { name }));
test("loads scoped settings and focuses mute; a rejected save keeps edits for manual retry", async () => {
  const { read, write, props } = setup();
  write.mockRejectedValueOnce(new TypeError("connection lost"));
  const mute = await screen.findByRole("checkbox", { name: /Mute channel/ });
  expect(document.activeElement).toBe(mute);
  expect(read.mock.calls[0][0]).toBe(props.channelId);
  fireEvent.click(group("On mobile").getByRole("radio", { name: /Nothing/ }));
  fireEvent.click(button("Save"));
  await screen.findByRole("alert");
  expect(write).toHaveBeenCalledTimes(1);
  expect(props.dismiss).not.toHaveBeenCalled();
  expect(
    group("On mobile").getByRole<HTMLInputElement>("radio", { name: /Nothing/ })
      .checked,
  ).toBe(true);
  fireEvent.click(button("Save"));
  await act(async () => {});
  expect(props.dismiss).toHaveBeenCalledOnce();
  expect(props.saved).toHaveBeenCalledOnce();
  expect(write.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    [props.channelId, { push: "none" }],
    [props.channelId, { push: "none" }],
  ]);
});
test("no changes and cancellation never submit; grouped mentions, mute and reset retain choices", async () => {
  const { write, props } = setup({ kind: "G" });
  const mute = await screen.findByRole("checkbox", {
    name: /Mute conversation/,
  });
  expect(
    group("On mobile").getByRole<HTMLInputElement>("radio", {
      name: /All new messages/,
    }).checked,
  ).toBe(true);
  fireEvent.click(button("Save"));
  expect(props.dismiss).toHaveBeenCalledOnce();
  fireEvent.click(mute);
  expect(
    group("On mobile").getByRole("radio", { name: /Nothing/ }),
  ).toBeTruthy();
  expect(screen.getByText("Conversation muted")).toBeTruthy();
  fireEvent.click(mute);
  fireEvent.click(button("Reset · On desktop"));
  fireEvent.click(button("Cancel"));
  expect(write).not.toHaveBeenCalled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(props.back).toHaveBeenCalledOnce();
});
test("ignores duplicate saves and late completions after leaving the account", async () => {
  const { props, write, view } = setup();
  let finish: () => void = () => {};
  write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /Mute channel/ }),
  );
  const form = button("Save").closest("form");
  if (!form) throw Error("Missing notification form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(write).toHaveBeenCalledOnce();
  const account = { ...props.account };
  view.rerender(<ChannelNotificationsDialog {...props} account={account} />);
  expect(write.mock.calls[0][2]?.aborted).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => finish());
  expect(props.dismiss).toHaveBeenCalledOnce();
});
test("retries a failed read and preserves edits while offline", async () => {
  const read = vi
    .fn<Props["account"]["readChannelNotifications"]>()
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValue(initial);
  const write = vi.fn<Props["account"]["updateChannelNotifications"]>();
  setup({
    online: false,
    account: {
      readChannelNotifications: read,
      updateChannelNotifications: write,
    },
  });
  await screen.findByRole("alert");
  fireEvent.click(button("Try again"));
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /Mute channel/ }),
  );
  fireEvent.click(button("Save"));
  expect(screen.getByRole("alert").textContent).toContain("offline");
  expect(write).not.toHaveBeenCalled();
});
test("account-wide suppression stays accessible; muted settings can be edited ahead of unmuting", async () => {
  const read = vi
    .fn<Props["account"]["readChannelNotifications"]>()
    .mockResolvedValue({
      account: { channel: "false", push: "all" },
      channel: { markUnread: "mention" },
    });
  const write = vi
    .fn<Props["account"]["updateChannelNotifications"]>()
    .mockResolvedValue(undefined);
  setup({
    account: {
      readChannelNotifications: read,
      updateChannelNotifications: write,
    },
  });
  const ignore = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: /Ignore mentions/,
  });
  expect(ignore.getAttribute("aria-disabled")).toBe("true");
  ignore.focus();
  expect(document.activeElement).toBe(ignore);
  fireEvent.click(ignore);
  expect(ignore.checked).toBe(true);
  fireEvent.click(group("On mobile").getByRole("radio", { name: /Nothing/ }));
  fireEvent.click(button("Save"));
  await act(async () => {});
  expect(write.mock.calls[0][1]).toEqual({ push: "none" });
});
test("sound plays only on a user choice, closes on unmount, and saving another setting does not play", async () => {
  const play = vi.fn().mockResolvedValue(undefined),
    pause = vi.fn(),
    load = vi.fn();
  class AudioFixture {
    onended = null;
    play = play;
    pause = pause;
    load = load;
    removeAttribute = vi.fn();
  }
  vi.stubGlobal("Audio", AudioFixture);
  const { write, view } = setup();
  const select = await screen.findByRole("combobox", { name: /Sound/ });
  expect(play).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: "Ripple" } });
  expect(play).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(group("On mobile").getByRole("radio", { name: /Nothing/ }));
  expect(play).toHaveBeenCalledOnce();
  view.unmount();
  expect(pause).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
});
