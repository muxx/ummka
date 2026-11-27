import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";

export async function checkChannelNotificationsWindow(
  host: HTMLElement,
  pressBack: (step: "channel-menu" | "notifications") => Promise<void>,
) {
  const ui = within(host);
  const click = (element: HTMLElement) =>
    flushSync(() => fireEvent.click(element));
  const title = within(
    await ui.findByRole("heading", { name: "Town Square", level: 1 }),
  ).getByRole("button", {
    name: "Channel menu, Town Square",
    description: "Public channel",
  });
  const frame = host.querySelector(".channels-frame");
  if (!frame) throw Error("Channels frame missing from the menu fixture");
  const compact = frame.clientWidth <= 740;
  const header = title.closest("header");
  if (header?.getBoundingClientRect().height !== (compact ? 53 : 70))
    throw Error("Unexpected conversation header height");
  if (compact) {
    const { top, left, bottom, right, height } = title.getBoundingClientRect();
    if (
      height !== 44 ||
      document.elementFromPoint(left + 1, top + 1)?.closest("button") !==
        title ||
      document.elementFromPoint(right - 1, bottom - 1)?.closest("button") !==
        title
    )
      throw Error("The two-line conversation heading must be one touch target");
  }
  const draft = ui.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #Town Square…",
  });
  const originalDraft = draft.value;
  if (!originalDraft)
    throw Error("The notification fixture needs a channel draft");
  click(title);
  const menu = await ui.findByRole("menu", { name: "Channel menu" });
  const sheet = menu.closest("dialog");
  if (compact) {
    if (!sheet?.open)
      throw Error("The compact channel menu needs a modal sheet");
    const bounds = sheet.getBoundingClientRect();
    if (
      Math.abs(bounds.left) > 1 ||
      Math.abs(bounds.right - innerWidth) > 1 ||
      Math.abs(bounds.bottom - innerHeight) > 1 ||
      within(menu)
        .getAllByRole("menuitem")
        .some((button) => button.getBoundingClientRect().height < 44)
    )
      throw Error(
        "The compact channel menu must fit the bottom of the viewport",
      );
  } else if (
    sheet ||
    menu.getBoundingClientRect().top < title.getBoundingClientRect().bottom
  ) {
    throw Error("The desktop channel menu must stay below its opener");
  }
  await pressBack("channel-menu");
  await waitFor(() => {
    if (menu.isConnected || document.activeElement !== title)
      throw Error("Channel menu Back did not restore its opener");
  });
  click(title);
  click(await ui.findByRole("menuitem", { name: "Notifications" }));
  const dialog = within(
    await ui.findByRole("dialog", { name: "Notifications" }),
  );
  const mute = await dialog.findByRole("checkbox", { name: /Mute channel/ });
  if (document.activeElement !== mute)
    throw Error("Notification form did not focus mute");
  await pressBack("notifications");
  const returned = await ui.findByRole("menuitem", { name: "Notifications" });
  if (document.activeElement !== returned)
    throw Error("Notification Back did not restore the selected menu item");
  click(returned);
  const reopened = within(
    await ui.findByRole("dialog", { name: "Notifications" }),
  );
  const mobile = within(
    await reopened.findByRole("group", { name: "On mobile" }),
  );
  const nothing = mobile.getByRole<HTMLInputElement>("radio", {
    name: /Nothing/,
  });
  click(nothing);
  const save = reopened.getByRole("button", { name: "Save" });
  click(save);
  await reopened.findByRole("alert");
  if (!nothing.checked || document.activeElement !== save)
    throw Error(
      "Server rejection discarded the notification edits or submit focus",
    );
  click(save);
  await waitFor(() => {
    if (ui.queryByRole("dialog") || document.activeElement !== title)
      throw Error("Saving did not restore the channel title");
  });
  click(title);
  click(await ui.findByRole("menuitem", { name: "Notifications" }));
  const confirmed = within(
    await ui.findByRole("dialog", { name: "Notifications" }),
  );
  const savedMobile = within(
    await confirmed.findByRole("group", { name: "On mobile" }),
  );
  if (
    !savedMobile.getByRole<HTMLInputElement>("radio", { name: /Nothing/ })
      .checked
  )
    throw Error("Confirmed setting was missing after reopening");
  click(confirmed.getByRole("button", { name: "Cancel" }));
  const canceled = await ui.findByRole("menuitem", { name: "Notifications" });
  if (document.activeElement !== canceled)
    throw Error("Cancel did not restore the notification menu item");
  flushSync(() => fireEvent.keyDown(window, { key: "Escape" }));
  await waitFor(() => {
    if (canceled.isConnected || document.activeElement !== title)
      throw Error("Leaving the menu did not restore the channel title");
  });
  if (!draft.isConnected || draft.value !== originalDraft)
    throw Error("Editing notifications discarded the channel draft");
}
