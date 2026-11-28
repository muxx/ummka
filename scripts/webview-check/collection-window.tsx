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

const click = (button: HTMLElement) => flushSync(() => fireEvent.click(button));

function checkPixels(label: string, actual: number, expected: number) {
  if (Math.abs(actual - expected) > 1)
    throw Error(`${label}: expected ${expected} CSS px, got ${actual}`);
}

function checkOverviewRowGap(overview: HTMLElement) {
  const section = overview.querySelector(
    ".channel-information-body > section:last-of-type",
  );
  if (!section || getComputedStyle(section).borderBlockEndWidth === "0px")
    throw Error("The last description section has no divider");
  const first = within(overview).getByRole("button", { name: /^Members/ });
  checkPixels(
    "From the description divider to the first row’s hover surface",
    first.getBoundingClientRect().top - section.getBoundingClientRect().bottom,
    8,
  );
}

function checkOverviewRows(overview: HTMLElement, compact: boolean) {
  const actions = within(overview);
  const rows = [
    { name: /^Members\b/, detail: true },
    { name: "Pinned messages" },
    { name: "Channel files" },
    { name: "Channel bookmarks" },
    { name: /^Notifications\b/, detail: true },
  ];
  let previous: DOMRect | undefined;
  for (const { name, detail } of rows) {
    const row = actions.getByRole("button", { name });
    const label = row.querySelector("strong");
    const subtitle = row.querySelector("small");
    const icon = row.querySelector("svg");
    if (!label || !icon || Boolean(subtitle) !== Boolean(detail))
      throw Error(`Wrong label or detail for overview row ${name}`);
    const bounds = row.getBoundingClientRect();
    const title = label.getBoundingClientRect();
    const textHeight = subtitle
      ? subtitle.getBoundingClientRect().bottom - title.top
      : title.height;
    // System text scaling can make the measured text taller than the minimum.
    const contentHeight = Math.max(
      textHeight,
      icon.getBoundingClientRect().height,
    );
    checkPixels(
      `Height of the overview action ${name}`,
      bounds.height,
      Math.max(compact || detail ? 44 : 32, contentHeight + 8),
    );
    if (previous)
      checkPixels(
        `Gap above the overview action ${name}`,
        bounds.top - previous.bottom,
        0,
      );
    previous = bounds;
  }
}

async function checkOverviewActions(overview: HTMLElement, compact: boolean) {
  const heading = within(overview).getByRole("heading", {
    name: "About this channel",
  });
  const header = heading.closest("header");
  if (!header) throw Error("Channel overview has no header");
  const actions = within(header);
  if (compact) {
    const back = await actions.findByRole("button", {
      name: "Back to conversation",
    });
    const bounds = back.getBoundingClientRect();
    if (
      actions.getAllByRole("button").length !== 1 ||
      bounds.right > heading.getBoundingClientRect().left + 1 ||
      bounds.width < 43 ||
      bounds.height < 43
    )
      throw Error("The compact overview needs a single leading Back target");
    return;
  }
  const expand = await actions.findByRole("button", { name: "Expand panel" });
  const checkRightGroup = (toggle: HTMLElement) => {
    const closeBox = actions
      .getByRole("button", { name: "Close channel info" })
      .getBoundingClientRect();
    const expandBox = toggle.getBoundingClientRect();
    checkPixels(
      "Channel overview close inset",
      header.getBoundingClientRect().right - closeBox.right,
      11,
    );
    checkPixels(
      "Gap between expand and close",
      closeBox.left - expandBox.right,
      4,
    );
    checkPixels("Width of the close button", closeBox.width, 32);
    checkPixels("Width of the expand button", expandBox.width, 32);
  };
  checkRightGroup(expand);
  const width = overview.getBoundingClientRect().width;
  click(expand);
  await waitFor(() => {
    const restore = actions.getByRole("button", {
      name: "Restore narrow panel",
    });
    if (
      overview.getBoundingClientRect().width <= width + 1 ||
      document.activeElement !== restore
    )
      throw Error("Expanding channel info did not widen it and keep focus");
    checkRightGroup(restore);
  });
  click(actions.getByRole("button", { name: "Restore narrow panel" }));
  await waitFor(() => {
    checkPixels(
      "Restored channel overview width",
      overview.getBoundingClientRect().width,
      width,
    );
    checkRightGroup(actions.getByRole("button", { name: "Expand panel" }));
  });
}

async function checkBookmarksBack(workspace: HTMLElement) {
  const ui = within(workspace);
  const bookmarks = ui.getByRole("complementary", {
    name: "Channel bookmarks",
  });
  const back = within(bookmarks).getByRole("button", {
    name: "Back to channel info",
  });
  if (!back.getClientRects().length)
    throw Error("Bookmarks opened from channel info have no visible Back");
  click(back);
  const overview = within(
    await ui.findByRole("complementary", {
      name: "About this channel",
    }),
  );
  await waitFor(() => {
    if (
      bookmarks.isConnected ||
      document.activeElement !==
        overview.getByRole("button", { name: "Channel bookmarks" })
    )
      throw Error("The Bookmarks Back button did not restore its opening row");
  });
  return overview;
}

export async function checkCollectionWindow(url: string, controlPort: string) {
  const original = await readInstallationSelection();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    ui = within(host);
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
  async function fixtureStatus(step: "boundary" | "pins-refresh") {
    const connection = await openNativeRestConnection(url);
    try {
      return (
        await connection.fetchApi(
          `${connection.basePath}/api/v4/system/ping?step=${step}`,
        )
      ).status;
    } finally {
      await connection.close();
    }
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
    await saved.findByRole("alert", {}, { timeout: 10000 });
    saved.getByRole("heading", { name: "Saved messages couldn’t load" });
    if (saved.queryByRole("list") || saved.queryByText(/no connection/i))
      throw Error("An invalid saved page was displayed or reported as offline");
    click(saved.getByRole("button", { name: "Try again" }));
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
    if ((await fixtureStatus("boundary")) !== 204)
      throw Error("Saved continuation was not pending");
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
    const info = ui.getByRole("button", { name: "Channel info" });
    host.style.width = "1180px";
    const headerMembers = await ui.findByRole("button", {
      name: "Members · 7",
    });
    click(headerMembers);
    const directMembers = await findPane("Members");
    await directMembers.findByText("@channel.guest");
    if (directMembers.queryByRole("button", { name: "Back to channel info" }))
      throw Error("Direct member navigation opened a nested panel");
    await back("header-members");
    await waitFor(() => {
      if (document.activeElement !== headerMembers)
        throw Error("Member count did not regain focus");
    });
    click(headerMembers);
    await findPane("Members");
    host.style.width = "740px";
    await waitFor(() => {
      if (headerMembers.isConnected)
        throw Error("Member count remains visible at compact width");
    });
    await back("resized-header-members");
    await waitFor(() => {
      if (document.activeElement !== info)
        throw Error("Hidden opener retained focus");
    });
    host.style.width = "1180px";
    click(info);
    const overview = await ui.findByRole("complementary", {
      name: "About this channel",
    });
    let about = within(overview);
    await about.findByText("7", { selector: "[role=status]" });
    checkOverviewRowGap(overview);
    await checkOverviewActions(overview, false);
    checkOverviewRows(overview, false);
    host.style.width = "390px";
    await checkOverviewActions(overview, true);
    checkOverviewRows(overview, true);
    host.style.removeProperty("width");
    click(about.getByRole("button", { name: /^Members/ }));
    const roster = await findPane("Members");
    await roster.findByText("@channel.guest");
    roster.getByText("Guest");
    fireEvent.change(roster.getByRole("searchbox"), {
      target: { value: "absent" },
    });
    await roster.findByRole("heading", { name: /^No members match / });
    await back("info-members");
    about = await findPane("About this channel");
    await waitFor(() => {
      if (
        document.activeElement !==
        about.getByRole("button", { name: /^Members/ })
      )
        throw Error("Member directory did not return to the opening row");
    });
    click(about.getByRole("button", { name: "Channel bookmarks" }));
    const bookmarks = await findPane("Channel bookmarks");
    const bookmark = await bookmarks.findByRole("button", {
      name: /Release checklist/,
    });
    if (!bookmark.textContent?.includes("text/markdown"))
      throw Error("Missing bookmark media type");
    click(bookmark);
    const bookmarkMenu = await within(document.body).findByRole("dialog", {
      name: "Release checklist",
    });
    await back("bookmark-menu");
    await waitFor(() => {
      if (bookmarkMenu.isConnected || document.activeElement !== bookmark)
        throw Error("Back did not return to the bookmark");
    });
    click(bookmark);
    click(
      within(
        await within(document.body).findByRole("dialog", {
          name: "Release checklist",
        }),
      ).getByRole("button", { name: "Open file" }),
    );
    const bookmarkFile = within(
      await within(document.body).findByRole("dialog", {
        name: "checklist.md",
      }),
    );
    await bookmarkFile.findByText("MD");
    if (bookmarkFile.queryByRole("button", { name: "Show message" }))
      throw Error("Bookmark-only file offered a parent message");
    await back("bookmark-file");
    await waitFor(() => {
      if (document.activeElement !== bookmark)
        throw Error("File preview lost the bookmark row");
    });
    const dialogs = within(document.body);
    async function addBookmark(name: string) {
      click(await bookmarks.findByRole("button", { name: "Add link" }));
      const editor = within(
        await dialogs.findByRole("dialog", { name: "Add link" }),
      );
      fireEvent.input(editor.getByRole("textbox", { name: "Name" }), {
        target: { value: name },
      });
      fireEvent.input(editor.getByRole("textbox", { name: "Link address" }), {
        target: { value: "https://example.org/guide" },
      });
      click(editor.getByRole("button", { name: "Save" }));
      return editor;
    }
    async function bookmarkAction(
      row: HTMLElement,
      name: string,
      action: string,
    ) {
      click(row);
      const menu = within(await dialogs.findByRole("dialog", { name }));
      click(menu.getByRole("button", { name: action }));
    }
    await addBookmark("Release guide");
    const createdGuide = await bookmarks.findByRole("button", {
      name: "Release guide",
    });
    await waitFor(() => {
      if (document.activeElement !== createdGuide)
        throw Error("Adding a bookmark did not focus its new row");
    });
    const runbook = await bookmarks.findByRole("button", {
      name: "Team runbook",
    });
    await bookmarkAction(runbook, "Team runbook", "Edit");
    const editor = within(
      await dialogs.findByRole("dialog", { name: "Edit bookmark" }),
    );
    fireEvent.input(editor.getByRole("textbox", { name: "Name" }), {
      target: { value: "Updated runbook" },
    });
    click(editor.getByRole("button", { name: "Save" }));
    const updated = await bookmarks.findByRole("button", {
      name: "Updated runbook",
    });
    await waitFor(() => {
      if (document.activeElement !== updated || runbook.isConnected)
        throw Error("Lost the replaced bookmark");
    });
    await bookmarkAction(updated, "Updated runbook", "Delete");
    await dialogs.findByRole("dialog", { name: "Delete bookmark?" });
    await back("bookmark-confirm");
    const restoredBookmarkMenu = within(
      await dialogs.findByRole("dialog", { name: "Updated runbook" }),
    );
    await waitFor(() => {
      if (
        document.activeElement !==
        restoredBookmarkMenu.getByRole("button", { name: "Delete" })
      )
        throw Error("Back lost the Delete action in the bookmark menu");
    });
    await back("bookmark-restored-menu");
    await waitFor(() => {
      if (document.activeElement !== updated)
        throw Error("Back lost the bookmark that opened confirmation");
    });
    await bookmarkAction(updated, "Updated runbook", "Delete");
    click(
      within(
        await dialogs.findByRole("dialog", { name: "Delete bookmark?" }),
      ).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => {
      if (updated.isConnected || document.activeElement !== createdGuide)
        throw Error("Deletion did not focus the next bookmark");
    });
    const uncertainEditor = await addBookmark("Unconfirmed guide");
    await uncertainEditor.findByRole("alert");
    if (
      !uncertainEditor.getByRole<HTMLButtonElement>("button", { name: "Save" })
        .disabled ||
      uncertainEditor.getByRole<HTMLInputElement>("textbox", { name: "Name" })
        .value !== "Unconfirmed guide" ||
      bookmarks.queryByRole("button", { name: "Unconfirmed guide" })
    )
      throw Error(
        "An uncertain bookmark response discarded the draft or allowed another write",
      );
    click(uncertainEditor.getByRole("button", { name: "Close" }));
    await bookmarks.findByRole("button", { name: "Unconfirmed guide" });
    about = await checkBookmarksBack(host);
    click(about.getByRole("button", { name: "Channel bookmarks" }));
    await findPane("Channel bookmarks");
    await back("bookmarks");
    about = await findPane("About this channel");
    await waitFor(() => {
      if (
        document.activeElement !==
        about.getByRole("button", { name: "Channel bookmarks" })
      )
        throw Error("Bookmark list lost its entry in channel info");
    });
    click(about.getByRole("button", { name: "Channel files" }));
    const files = await findPane("Channel files");
    const file = await files.findByRole("button", {
      name: "Open attachment thread-note.txt, 0 B",
    });
    click(file);
    const fileDialog = within(document.body);
    const fileDetails = within(
      await fileDialog.findByRole("dialog", { name: "thread-note.txt" }),
    );
    fileDetails.getByText("0 B, empty file");
    await back("file-details");
    await waitFor(
      () => {
        if (fileDialog.queryByRole("dialog") || document.activeElement !== file)
          throw Error(
            `Closing file details: open=${Boolean(fileDialog.queryByRole("dialog"))} focus=${document.activeElement?.tagName}/${document.activeElement?.className} visible=${Boolean(file.getClientRects().length)}`,
          );
      },
      { timeout: 10000 },
    );
    click(file);
    const openedFile = within(
      await fileDialog.findByRole("dialog", { name: "thread-note.txt" }),
    );
    click(openedFile.getByRole("button", { name: "Go to message" }));
    const fileThread = await findPane("Thread");
    await fileThread.findByText(
      "Reply visible only inside Town’s thread for @reader",
    );
    await ui.findByRole("button", { name: "Back to channel files" });
    await back("file-message");
    await waitFor(
      () => {
        if (
          !file.getClientRects().length ||
          document.activeElement !== file ||
          draft.value !== originalText
        )
          throw Error("Message return lost the channel file or draft");
      },
      { timeout: 10000 },
    );
    await back("files");
    about = await findPane("About this channel");
    await waitFor(
      () => {
        if (
          document.activeElement !==
          about.getByRole("button", { name: "Channel files" })
        )
          throw Error("Closing channel files did not restore its info row");
      },
      { timeout: 10000 },
    );
    const pinsHeading = (pane: typeof ui) =>
      pane.getByRole("heading", {
        name: "Pinned messages",
        description: "# Town Square · visible to all members",
      });
    click(about.getByRole("button", { name: "Pinned messages" }));
    let infoPins = await findPane("Pinned messages");
    if (document.activeElement !== pinsHeading(infoPins))
      throw Error("The first Pins opening did not focus its heading");
    const infoPin = await infoPins.findByRole("button", {
      name: /Town fixture message/,
    });
    if (document.activeElement !== pinsHeading(infoPins))
      throw Error("The first Pins response moved focus from its heading");
    click(infoPin);
    await ui.findByRole("button", { name: "Back to pinned messages" });
    await back("info-row");
    infoPins = await findPane("Pinned messages");
    await waitFor(() => {
      if (
        document.activeElement !==
        infoPins.getByRole("button", { name: /Town fixture message/ })
      )
        throw Error("Pinned message did not regain focus");
    });
    await back("info-pins");
    about = await findPane("About this channel");
    await waitFor(() => {
      if (
        document.activeElement !==
        about.getByRole("button", { name: "Pinned messages" })
      )
        throw Error("The pinned messages action did not regain focus");
    });
    await back("info-overview");
    await waitFor(() => {
      if (document.activeElement !== info)
        throw Error("The channel information button did not regain focus");
    });
    const menu = ui.getByRole("button", { name: "Channel menu, Town Square" });
    click(menu);
    click(ui.getByRole("menuitem", { name: "Pinned messages" }));
    let pins = await findPane("Pinned messages");
    pinsHeading(pins);
    // Both entry points share the confirmed list and its reading place.
    const pin = pins.getByRole("button", {
      name: /Town fixture message/,
    });
    if (document.activeElement !== pin)
      throw Error("Reopening Pins did not focus the remembered pinned row");
    // An open Pins view rereads the same list when connectivity returns.
    const previousOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    try {
      flushSync(() => window.dispatchEvent(new Event("offline")));
      await pins.findByText("You’re offline.");
      if ((await fixtureStatus("pins-refresh")) !== 204)
        throw Error("Could not arm the Pins refresh response");
    } finally {
      if (previousOnline)
        Object.defineProperty(navigator, "onLine", previousOnline);
      else Reflect.deleteProperty(navigator, "onLine");
      flushSync(() => window.dispatchEvent(new Event("online")));
    }
    await pins.findByText(
      "Pinned messages couldn’t update. Showing the previous response",
      {},
      { timeout: 10000 },
    );
    if (!pin.isConnected || pins.queryByText(/no connection/i))
      throw Error("A failed update lost the confirmed pin or reported offline");
    if (document.activeElement !== pin)
      throw Error("A failed Pins update moved focus from the remembered row");
    click(pins.getByRole("button", { name: "Retry update: Pinned messages" }));
    await pins.findByText("Pinned messages updated");
    if (document.activeElement !== pin)
      throw Error("Retry did not focus the confirmed pinned row");
    if (!pins.queryByText("Saved by you"))
      throw Error("Confirmed personal marker missing in pins");
    click(pin);
    await ui.findByRole("button", { name: "Back to pinned messages" });
    await back("pinned-root");
    pins = await findPane("Pinned messages");
    pinsHeading(pins);
    await waitFor(() => {
      if (
        document.activeElement !==
        pins.getByRole("button", { name: /Town fixture message/ })
      )
        throw Error("Lost pinned row focus");
    });
    click(pins.getByRole("button", { name: "Unpin for everyone" }));
    await pins.findByText("No pinned messages in this channel.");
    pinsHeading(pins);
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
      name: /^Message actions(?: · .+)?$/,
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
