import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import {
  connectInstallation,
  forgetInstallation,
  readInstallationSelection,
  selectInstallation,
} from "../../src/mattermost/installation-registry.ts";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";

export async function checkCollectionWindow(url: string, controlPort: string) {
  const original = await readInstallationSelection();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    ui = within(host);
  const click = (button: HTMLElement) =>
    flushSync(() => fireEvent.click(button));
  const findPane = async (name: string) =>
    within(await ui.findByRole("complementary", { name }, { timeout: 10000 }));
  const driver = await openNativeRestConnection(
    `https://127.0.0.1:${controlPort}`,
  );
  async function back(step: string) {
    const response = await driver.fetchApi(
      `${driver.basePath}/api/v4/system/ping?step=collection-back-${step}`,
    );
    if (response.status !== 204)
      throw Error("Native collection Back failed: " + step);
  }
  try {
    await connectInstallation(url);
    flushSync(() => root.render(<App language="en" />));
    const town = await ui.findByText(
      "Town fixture message",
      {},
      { timeout: 15000 },
    );
    const draft = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    const originalText = "Unsent collection window draft";
    flushSync(() =>
      fireEvent.input(draft, { target: { value: originalText } }),
    );
    const trigger = ui.getByRole("button", { name: "Saved messages" });
    click(trigger);
    let saved = await findPane("Saved messages");
    const row = await saved.findByRole("button", {
      name: /Reply visible only inside Town/,
    });
    const frame = host.querySelector(".channels-frame");
    if (!frame) throw Error("Channels frame missing");
    const compact = frame.clientWidth <= 740;
    if (
      (town.getClientRects().length === 0) !== compact ||
      !row.getClientRects().length
    )
      throw Error("Wrong collection layout for the native window");
    click(row);
    const thread = await findPane("Thread");
    await thread.findByText("Reply visible only inside Town’s thread");
    await back("saved-reply");
    saved = await findPane("Saved messages");
    const returned = await saved.findByRole("button", {
      name: /Reply visible only inside Town/,
    });
    await waitFor(() => {
      if (document.activeElement !== returned)
        throw Error("Lost collection row focus");
    });
    const boundary = saved.getByText(
      "Earlier saved messages haven’t loaded yet.",
    );
    boundary.scrollIntoView({ block: "end" });
    const control = await openNativeRestConnection(url);
    try {
      const response = await control.fetchApi(
        `${control.basePath}/api/v4/system/ping?step=boundary`,
      );
      if (response.status !== 204)
        throw Error("Saved continuation was not pending");
    } finally {
      await control.close();
    }
    const scroller = returned.closest<HTMLElement>(".collection-rows");
    if (!scroller) throw Error("Missing saved list viewport");
    const bounds = scroller.getBoundingClientRect();
    const buttons = Array.from(
      scroller.querySelectorAll<HTMLButtonElement>("[data-collection-post]"),
    );
    // Keep the loading edge visible while exercising a clipped row at the top.
    const isClipped = (el: HTMLElement) => {
      const row = el.getBoundingClientRect();
      return row.top < bounds.top && row.bottom > bounds.top;
    };
    if (!buttons.some(isClipped)) scroller.scrollTop -= 6;
    if (
      !buttons.some(isClipped) ||
      boundary.getBoundingClientRect().top >= bounds.bottom
    )
      throw Error(
        "Expected both the saved loading edge and a clipped first row",
      );
    const visible = buttons.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= bounds.top && r.bottom <= bounds.bottom;
    });
    const remove = visible[0],
      keep = visible[2];
    if (!remove?.parentElement || !keep)
      throw Error("Too few page rows to verify the reading position");
    const oldY = keep.getBoundingClientRect().top;
    click(
      within(remove.parentElement).getByRole("button", {
        name: "Remove from saved",
      }),
    );
    await waitFor(() => {
      if (remove.isConnected) throw Error("Personal removal not confirmed");
    });
    await saved.findByText(
      "Oldest saved window result",
      {},
      { timeout: 10000 },
    );
    if (Math.abs(keep.getBoundingClientRect().top - oldY) > 1)
      throw Error("Appending a page moved the reading position");
    if (boundary.isConnected)
      throw Error("Completed collection still displayed the loading edge");
    await back("saved-list");
    await waitFor(() => {
      if (document.activeElement !== trigger)
        throw Error("Saved control did not regain focus");
    });
    const menu = ui.getByRole("button", { name: "Channel menu, Town Square" });
    click(menu);
    click(ui.getByRole("menuitem", { name: "Pinned messages" }));
    let pins = await findPane("Pinned messages");
    const pin = await pins.findByRole("button", {
      name: /Town fixture message/,
    });
    if (!pins.queryByText("Saved by you"))
      throw Error("Confirmed personal marker missing in pins");
    click(pin);
    await ui.findByRole("button", { name: "Back to pinned messages" });
    await back("pinned-root");
    pins = await findPane("Pinned messages");
    await waitFor(() => {
      if (
        document.activeElement !==
        pins.getByRole("button", { name: /Town fixture message/ })
      )
        throw Error("Lost pinned row focus");
    });
    click(pins.getByRole("button", { name: "Unpin for everyone" }));
    await pins.findByText("No pinned messages in this channel.");
    await back("pinned-list");
    await waitFor(() => {
      if (document.activeElement !== menu)
        throw Error("Channel menu did not regain focus");
    });
    if (
      document.activeElement !== menu ||
      ui.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #Town Square…",
      }).value !== originalText
    )
      throw Error(
        "The channel opener or unsent draft did not survive both collections",
      );
  } finally {
    await driver.close();
    flushSync(() => root.unmount());
    host.remove();
    if (!original.installations.includes(url)) await forgetInstallation(url);
    if (original.selected && original.selected !== url)
      await selectInstallation(original.selected);
  }
}
