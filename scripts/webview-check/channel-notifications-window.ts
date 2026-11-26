import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";

export async function checkChannelNotificationsWindow(
  host: HTMLElement,
  pressBack: () => Promise<void>,
) {
  const ui = within(host);
  const click = (element: HTMLElement) =>
    flushSync(() => fireEvent.click(element));
  const title = within(
    await ui.findByRole("heading", { name: "Town Square", level: 1 }),
  ).getByRole("button");
  const draft = ui.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #Town Square…",
  });
  const originalDraft = draft.value;
  if (!originalDraft)
    throw Error("The notification fixture needs a channel draft");
  click(title);
  click(await ui.findByRole("menuitem", { name: "Notifications" }));
  const dialog = within(
    await ui.findByRole("dialog", { name: "Notifications" }),
  );
  const mute = await dialog.findByRole("checkbox", { name: /Mute channel/ });
  if (document.activeElement !== mute)
    throw Error("Notification form did not focus mute");
  await pressBack();
  click(await ui.findByRole("menuitem", { name: "Notifications" }));
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
  click(reopened.getByRole("button", { name: "Save" }));
  await reopened.findByRole("alert");
  if (!nothing.checked)
    throw Error("Server rejection discarded notification edits");
  click(reopened.getByRole("button", { name: "Save" }));
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
  if (!draft.isConnected || draft.value !== originalDraft)
    throw Error("Editing notifications discarded the channel draft");
}
