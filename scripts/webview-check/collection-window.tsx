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
      throw Error(`Native collection Back failed: ${step}`);
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
    saved.getByRole("heading", {
      name: "Saved messages",
      description: "Only visible to you",
    });
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
    const item = row.closest("li");
    if (!item) throw Error("Saved message is outside the list");
    const removal = within(item).getByRole("button", {
      name: "Remove from saved",
    });
    const card = row.getBoundingClientRect();
    const action = removal.getBoundingClientRect();
    const actionSize = compact ? 44 : 32;
    if (
      Math.abs(action.left - card.right - 6) > 1 ||
      action.width !== actionSize ||
      action.height !== actionSize ||
      getComputedStyle(item).borderBlockEndWidth !== "0px"
    )
      throw Error(
        "Saved message hover and removal must have separate surfaces",
      );
    click(row);
    const thread = await findPane("Thread");
    await thread.findByText(
      "Reply visible only inside Town’s thread for @reader",
    );
    const steps = await ui.findByRole("group", { name: "Saved messages" });
    const stepAction = within(steps);
    if (stepAction.getByRole("status").textContent !== "1 of 60+")
      throw Error("Saved result position or continuation is missing");
    const backToSaved = stepAction.getByRole("button", {
      name: "Back to saved messages",
    });
    if (compact) {
      const bar = steps.getBoundingClientRect();
      const head = host
        .querySelector(".channels-thread > .channels-pane-head")
        ?.getBoundingClientRect();
      const hit = backToSaved.getBoundingClientRect();
      const at = (y: number) =>
        backToSaved.contains(
          document.elementFromPoint(hit.x + hit.width / 2, y),
        );
      if (
        !head ||
        bar.top < head.bottom - 1 ||
        hit.height < 44 ||
        !at(hit.top + 1) ||
        !at(hit.bottom - 1) ||
        at(bar.top - 1)
      )
        throw Error(
          "Compact saved return target extends outside the thread result bar",
        );
    }
    click(stepAction.getByRole("button", { name: "Next in list" }));
    await waitFor(() => {
      if (ui.queryByRole("complementary", { name: "Thread" }))
        throw Error("The saved step did not return to the channel post");
      const indicator = within(
        ui.getByRole("group", { name: "Saved messages" }),
      ).getByRole("status");
      if (indicator.textContent !== "2 of 60+")
        throw Error("The saved step counter did not advance");
    });
    click(
      within(ui.getByRole("group", { name: "Saved messages" })).getByRole(
        "button",
        { name: "Previous in list" },
      ),
    );
    await (await findPane("Thread")).findByText(
      "Reply visible only inside Town’s thread for @reader",
    );
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
    const pinsHeading = () =>
      pins.getByRole("heading", {
        name: "Pinned messages",
        description: "# Town Square · visible to all members",
      });
    if (document.activeElement !== pinsHeading())
      throw Error("Pinned results did not focus their own heading");
    const pin = await pins.findByRole("button", {
      name: /Town fixture message/,
    });
    if (!pins.queryByText("Saved by you"))
      throw Error("Confirmed personal marker missing in pins");
    click(pin);
    await ui.findByRole("button", { name: "Back to pinned messages" });
    await back("pinned-root");
    pins = await findPane("Pinned messages");
    pinsHeading();
    await waitFor(() => {
      if (
        document.activeElement !==
        pins.getByRole("button", { name: /Town fixture message/ })
      )
        throw Error("Lost pinned row focus");
    });
    click(pins.getByRole("button", { name: "Unpin for everyone" }));
    await pins.findByText("No pinned messages in this channel.");
    pinsHeading();
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
    const mentions = ui.getByRole("button", { name: "Mentions" });
    click(mentions);
    const mentionPane = await findPane("Mentions");
    const mentioned = await mentionPane.findByRole("button", {
      name: /for @reader/,
    });
    await mentionPane.findByText(/# Outside releases/);
    click(mentioned);
    await (await findPane("Thread")).findByText(
      "Reply visible only inside Town’s thread for @reader",
    );
    await back("mentioned-reply");
    const restoredMention = await (await findPane("Mentions")).findByRole(
      "button",
      { name: /for @reader/ },
    );
    await waitFor(() => {
      if (document.activeElement !== restoredMention)
        throw Error("Lost mentioned reply on return");
    });
    await back("mentions-list");
    await waitFor(() => {
      if (
        ui.queryByRole("complementary", { name: "Mentions" }) ||
        document.activeElement !== mentions
      )
        throw Error(
          "Closing mentions did not restore focus to its toolbar button",
        );
    });
    const timeline = (await ui.findByText("Town fixture message")).closest(
      "article",
    );
    if (!timeline) throw Error("Missing published Town post");
    const actions = within(timeline).getByRole("button", {
      name: "Message actions",
    });
    async function toggleBookmark(name: string, notice: string) {
      click(actions);
      const dialog = await within(document.body).findByRole("dialog", {
        name: "Message actions",
      });
      const bookmark = await within(dialog).findByRole("button", { name });
      click(bookmark);
      await ui.findByText(notice);
      if (dialog.isConnected || document.activeElement !== actions)
        throw Error("Bookmark action lost focus in the native timeline");
    }
    await toggleBookmark("Remove from Saved", "Removed from Saved.");
    await toggleBookmark(
      "Save",
      "Saved. Only you can see your saved messages.",
    );
    click(trigger);
    await (await findPane("Saved messages")).findByRole("button", {
      name: /Town fixture message/,
    });
  } finally {
    await driver.close();
    flushSync(() => root.unmount());
    host.remove();
    if (!original.installations.includes(url)) await forgetInstallation(url);
    if (original.selected && original.selected !== url)
      await selectInstallation(original.selected);
  }
}
