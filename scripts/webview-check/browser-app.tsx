import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { isAndroid } from "../../src/build-platform.ts";
import {
  forgetInstallation,
  rememberInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  getCurrentAccountId,
  openAccountRestConnection,
  openNativeRestConnection,
} from "../../src/mattermost/native-rest.ts";
import {
  checkFirstTeamChoice,
  openChannelNavigation,
} from "./account-team-window.tsx";
import { checkAvailableDirectoryWindow } from "./available-directory-window.ts";
import { fixtureStep } from "./fixture-step.ts";
import { systemReply, systemRoot } from "./link-examples.ts";
import { checkModalScroll } from "./modal-scroll.ts";
import { checkPendingCommandActions } from "./pending-command-actions.ts";
import { verifySearchAttachment } from "./published-attachments.ts";
import {
  checkRowPermalink,
  openThreadFromMessageMenu,
} from "./published-post-actions.ts";
import {
  findThreadDraft,
  inspectChannelTable,
  inspectReplyTable,
  verifyWorkspaceBack,
} from "./workspace-back.tsx";

export async function waitForAppForeground() {
  await waitFor(
    () => {
      if (document.visibilityState !== "visible" || !document.hasFocus())
        throw Error(
          "The application WebView did not regain visibility and focus",
        );
    },
    { timeout: 5000 },
  );
}

async function workspaceFixtureStep(
  controlPort: string,
  step:
    | "search-result-back"
    | "allow-design-posts"
    | "table-back"
    | "copy-true"
    | "copy-false"
    | "copy-unset",
) {
  const control = await openNativeRestConnection(
    `https://127.0.0.1:${controlPort}`,
  );
  try {
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${step}`,
    );
    if (response.status !== 204)
      throw Error("The workspace fixture did not accept " + step);
  } finally {
    await control.close();
  }
}

async function checkTableReturn(
  host: HTMLElement,
  row: HTMLElement,
  inspect: (table: ReturnType<typeof within>) => void,
  origin: string,
  nativeBack?: () => Promise<void>,
) {
  const opener = within(row).getByRole("button", { name: /^Open table:/ });
  const feed = row.closest<HTMLElement>(".timeline-scroll");
  if (!feed) throw Error("The table has no origin feed");
  opener.scrollIntoView({ block: "nearest" });
  const offset = feed.scrollTop;
  flushSync(() => fireEvent.click(opener));
  const dialog = within(host).getByRole("dialog", { name: "Table" });
  const modal = within(dialog);
  modal.getByText(origin);
  const button = modal.getByRole("button", { name: "Back" });
  const region = modal.getByRole("region", { name: "Table" });
  const grid = modal.getByRole("table");
  if (document.activeElement !== region)
    throw Error("The full table did not focus its scrolling area");
  if (region.clientWidth > grid.getBoundingClientRect().width + 1)
    throw Error("The full table is narrower than its scrolling area");
  inspect(within(grid));
  if (nativeBack) await nativeBack();
  else flushSync(() => fireEvent.click(button));
  await waitFor(() => {
    if (
      dialog.isConnected ||
      document.activeElement !== opener ||
      !feed.isConnected ||
      Math.abs(feed.scrollTop - offset) > 1
    )
      throw Error(
        "Closing the full table lost the origin post or its position",
      );
  });
}

async function checkThreadReply(
  host: HTMLElement,
  opener: HTMLElement,
  townDraft: HTMLTextAreaElement,
) {
  const ui = within(host);
  flushSync(() => fireEvent.click(opener));
  const { pane, thread, field } = await findThreadDraft(host);
  if (document.activeElement === field || field.value)
    throw Error("Opening the compact thread focused or populated its editor");
  const message = "Posted from the thread window";
  field.focus();
  flushSync(() => fireEvent.input(field, { target: { value: message } }));
  flushSync(() =>
    fireEvent.click(thread.getByRole("button", { name: "Send message" })),
  );
  await waitFor(
    () => {
      const row = thread.getByText(message).closest("article");
      const rect = row?.getBoundingClientRect();
      const feed = row?.closest(".thread-feed")?.getBoundingClientRect();
      if (
        !rect?.height ||
        !feed ||
        rect.bottom <= feed.top ||
        rect.top >= feed.bottom ||
        row?.querySelector(".timeline-delivery") ||
        field.value ||
        townDraft.value !== "Draft from the channel window"
      )
        throw Error(
          "The phone did not show one confirmed reply and preserve the channel draft",
        );
    },
    { timeout: 10_000 },
  );
  flushSync(() =>
    fireEvent.click(thread.getByRole("button", { name: "Close thread" })),
  );
  await waitFor(() => {
    if (
      pane.isConnected ||
      ui.queryByText(message) ||
      ui.getByRole("textbox", { name: "Message #Town Square…" }) !==
        townDraft ||
      townDraft.value !== "Draft from the channel window"
    )
      throw Error(
        "Closing the thread showed the reply in the collapsed channel or changed its draft",
      );
  });
}

export async function checkBrowserApp(server: string, controlPort: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const otherServer = `${server}/other`;
  try {
    flushSync(() => root.render(<App language="en" />));
    const ui = within(host);
    const address = await ui.findByRole<HTMLInputElement>("textbox", {
      name: "Server address",
    });
    flushSync(() => fireEvent.input(address, { target: { value: server } }));
    ui.getByRole("button", { name: "Continue" }).click();
    const provider = await ui.findByRole(
      "button",
      { name: "GitLab" },
      { timeout: 15_000 },
    );
    ui.getByRole("button", { name: "Google" });
    await rememberInstallation(otherServer);
    await firstTeamControl(controlPort, "first-team-empty");
    flushSync(() => fireEvent.click(provider));
    if (
      !ui.getByRole("heading", { name: "Continue in your browser" }) ||
      !ui.queryByTitle(server)
    )
      throw Error("browser wait lost the chosen installation");
    await waitForAppForeground();
    await fixtureStep("first-team-picker-back", async () => {
      const other = await ui.findByRole("button", { name: "Another server" });
      flushSync(() => fireEvent.click(other));
      ui.getByRole("heading", { name: "Servers on this device" });
      ui.getByTitle(otherServer);
      await firstTeamControl(controlPort, "first-team-back");
      await waitFor(() => {
        const restored = ui.getByRole("button", { name: "Another server" });
        if (document.activeElement !== restored || ui.queryByRole("textbox"))
          throw Error(
            "Native Back did not restore the signed empty form and its focus",
          );
      });
      await firstTeamControl(controlPort, "first-team-invite");
      flushSync(() =>
        fireEvent.click(ui.getByRole("button", { name: "Check again" })),
      );
    });
    await checkFirstTeamChoice(host, server, "Browser fixture");
    await ui.findByText("fixture-author");
    const fixture = await openAccountRestConnection(server, "f".repeat(26));
    const localMessage = "Earlier Design attempt";
    try {
      const place = { channelId: "d".repeat(26) };
      const saved = await fixture.saveDraft({
        ...place,
        expectedRevision: null,
        message: localMessage,
      });
      if (saved.kind !== "saved" || !saved.draft.revision)
        throw Error("Could not save the Design fixture");
      const staged = await fixture.stagePost({
        ...place,
        revision: saved.draft.revision,
      });
      if (staged.kind !== "created")
        throw Error("Could not stage the Design fixture");
      if (
        (await fixture.recordPostRefusal(staged.post, {
          status: 403,
          code: "api.context.permissions.app_error",
          message: "Permission denied",
        })) !== "delivery"
      )
        throw Error("Could not save the confirmed refusal");
    } finally {
      await fixture.close();
    }
    if (ui.queryByText(localMessage))
      throw Error("Town exposed another room’s outgoing text");
    const townDraft = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    const sentText = "Posted from the channel window";
    flushSync(() =>
      fireEvent.input(townDraft, { target: { value: sentText } }),
    );
    const sendButton = ui.getByRole<HTMLButtonElement>("button", {
      name: "Send message",
    });
    if (sendButton.disabled)
      throw Error("The online composer did not enable sending");
    flushSync(() => fireEvent.click(sendButton));
    await ui.findByText(sentText, {}, { timeout: 10_000 });
    const delivery = await openAccountRestConnection(server, "f".repeat(26));
    try {
      await waitFor(
        async () => {
          const rows = await delivery.readPendingPosts({
            channelId: "c".repeat(26),
            limit: 10,
          });
          if (
            townDraft.value ||
            !rows.some(
              (row) =>
                row.message === sentText &&
                row.confirmedPostId === "windowpost".padEnd(26, "0"),
            )
          )
            throw Error(
              "The window did not hand off the exact draft and receive server confirmation",
            );
        },
        { timeout: 10_000 },
      );
      await checkPendingCommandActions(host, townDraft, delivery);
    } finally {
      await delivery.close();
    }
    flushSync(() =>
      fireEvent.input(townDraft, {
        target: { value: "Draft from the channel window" },
      }),
    );
    const town = ui.getByText("Town fixture message").closest("article");
    if (!town) throw Error("Town post is outside its timeline row");
    inspectChannelTable(within(within(town).getByRole("table")));
    if (isAndroid)
      await checkTableReturn(
        host,
        town,
        (full) => {
          full.getByRole("cell", { name: "Aurora" });
        },
        "fixture-author · # Town Square",
      );
    const townActions = await within(town).findByRole("button", {
      name: "Message actions",
    });
    flushSync(() => fireEvent.click(townActions));
    const actions = within(
      within(document.body).getByRole("dialog", { name: "Message actions" }),
    );
    const copy = actions.getByRole("button", { name: "Copy link" });
    copy.focus();
    await workspaceFixtureStep(controlPort, "copy-true");
    await waitFor(() => {
      if (
        actions.queryByRole("button", { name: "Copy link" }) ||
        document.activeElement !==
          actions.getByRole("button", { name: "Reply in thread" }) ||
        !townActions.isConnected ||
        townDraft.value !== "Draft from the channel window"
      )
        throw Error("Android device policy changed the thread action or draft");
    });
    await workspaceFixtureStep(controlPort, "copy-false");
    await actions.findByRole("button", { name: "Copy link" });
    flushSync(() =>
      fireEvent.click(actions.getByRole("button", { name: "Close" })),
    );
    await checkRowPermalink(town, `${server}/browser/pl/${systemRoot}`);
    const direct = within(town).getByRole("button", { name: "Open thread" });
    openThreadFromMessageMenu(townActions);
    const thread = await ui.findByRole("complementary", { name: "Thread" });
    const reply = await within(thread).findByText(
      "Reply visible only inside Town’s thread",
      {},
      { timeout: 10_000 },
    );
    const replyRow = reply.closest("article");
    if (!replyRow) throw Error("Missing published reply");
    if (isAndroid)
      await checkTableReturn(
        host,
        replyRow,
        inspectReplyTable,
        "fixture-author · thread in # Town Square",
        () => workspaceFixtureStep(controlPort, "table-back"),
      );
    else inspectReplyTable(within(within(replyRow).getByRole("table")));
    await checkRowPermalink(
      replyRow,
      `${server}/browser/pl/${systemReply}`,
      true,
    );
    await workspaceFixtureStep(controlPort, "copy-unset");
    if (town.getClientRects().length || document.activeElement === townDraft)
      throw Error("The compact thread did not take over the conversation");
    await verifyWorkspaceBack(host, controlPort, townActions, townDraft);
    await checkThreadReply(host, direct, townDraft);
    const searchTrigger = ui.getByRole("button", { name: "Search" });
    searchTrigger.focus();
    flushSync(() => fireEvent.click(searchTrigger));
    const dialog = within(await ui.findByRole("dialog"));
    const terms = dialog.getByRole<HTMLInputElement>("searchbox");
    if (document.activeElement !== terms)
      throw Error("The online search dialog did not focus the query");
    checkModalScroll(terms);
    flushSync(() =>
      fireEvent.input(terms, { target: { value: "window fixture" } }),
    );
    flushSync(() =>
      fireEvent.click(dialog.getByRole("button", { name: "Search" })),
    );
    let results = within(
      await ui.findByRole(
        "complementary",
        { name: "Search results" },
        { timeout: 10_000 },
      ),
    );
    await results.findByRole("button", {
      name: "Search found this fixture post",
    });
    results = await verifySearchAttachment(host, controlPort, townDraft);
    flushSync(() =>
      fireEvent.click(results.getByRole("button", { name: /Messages/ })),
    );
    const replyAction = { name: "Search found this reply" };
    const foundReply = await results.findByRole("button", replyAction);
    flushSync(() => fireEvent.click(foundReply));
    const addressedThread = await ui.findByRole(
      "complementary",
      { name: "Thread" },
      { timeout: 10_000 },
    );
    await waitFor(
      () => {
        if (addressedThread.querySelector("[data-thread-edge]"))
          throw Error(
            "Both sides of the addressed reply have not finished loading",
          );
        within(addressedThread).getByText("Town fixture message");
        const row = within(addressedThread)
          .getByText("Reply visible only inside Town’s thread")
          .closest("article");
        const bounds = row?.getBoundingClientRect();
        const feed = row?.closest(".thread-feed")?.getBoundingClientRect();
        if (
          !row ||
          row.dataset.postId !== "w".repeat(26) ||
          !bounds?.height ||
          !feed ||
          bounds.bottom <= feed.top ||
          bounds.top >= feed.bottom ||
          document.activeElement !== row
        )
          throw Error(
            "The search result did not focus the visible addressed reply",
          );
      },
      { timeout: 10_000 },
    );
    await workspaceFixtureStep(controlPort, "search-result-back");
    results = within(
      await ui.findByRole(
        "complementary",
        { name: "Search results" },
        { timeout: 10_000 },
      ),
    );
    await waitFor(
      () => {
        if (
          document.activeElement !== results.getByRole("button", replyAction) ||
          townDraft.value !== "Draft from the channel window"
        )
          throw Error(
            "Returning from the reply lost the selected result or the channel draft",
          );
      },
      { timeout: 10_000 },
    );
    flushSync(() =>
      fireEvent.click(results.getByRole("button", { name: "Close search" })),
    );
    if (
      document.activeElement !== searchTrigger ||
      townDraft.value !== "Draft from the channel window"
    )
      throw Error("Leaving native search lost the header or draft");
    flushSync(() =>
      fireEvent.input(townDraft, {
        target: { value: "/SeArCh window fixture" },
      }),
    );
    flushSync(() =>
      fireEvent.click(ui.getByRole("button", { name: "Run command" })),
    );
    const commandResults = within(
      await ui.findByRole(
        "complementary",
        { name: "Search results" },
        { timeout: 10_000 },
      ),
    );
    await commandResults.findByRole("button", {
      name: "Search found this fixture post",
    });
    await waitFor(
      () => {
        if (townDraft.value !== "")
          throw Error("The local search command is still in the channel draft");
      },
      { container: host, timeout: 10_000 },
    );
    flushSync(() =>
      fireEvent.click(
        commandResults.getByRole("button", { name: "Close search" }),
      ),
    );
    flushSync(() =>
      fireEvent.input(townDraft, { target: { value: "/search" } }),
    );
    flushSync(() =>
      fireEvent.click(ui.getByRole("button", { name: "Run command" })),
    );
    const emptySearch = within(await ui.findByRole("dialog"));
    const emptyQuery = emptySearch.getByRole<HTMLInputElement>("searchbox");
    if (emptyQuery.value || document.activeElement !== emptyQuery)
      throw Error(
        "A search command without arguments did not open the empty input",
      );
    await waitFor(
      () => {
        if (townDraft.value !== "")
          throw Error("The bare command was not cleared");
      },
      { container: host, timeout: 10_000 },
    );
    flushSync(() =>
      fireEvent.click(
        emptySearch.getByRole("button", { name: "Close search" }),
      ),
    );
    flushSync(() =>
      fireEvent.input(townDraft, {
        target: { value: "Draft from the channel window" },
      }),
    );
    openChannelNavigation(host, "Channels");
    const design = ui.getByRole("button", { name: "Design" });
    flushSync(() => fireEvent.click(design));
    await ui.findByText("Design fixture message", {}, { timeout: 10_000 });
    const refused = (await ui.findByText(localMessage)).closest("article");
    if (
      !refused?.textContent?.includes("Not sent") ||
      !refused.textContent.includes("permission")
    )
      throw Error(
        "Design did not restore its own refusal in the normal timeline",
      );
    await ui.findByText("This channel is read-only.", {}, { timeout: 10_000 });
    if (ui.queryByRole("textbox"))
      throw Error("read-only room exposed a different channel’s draft");
    if (ui.queryByText("Town fixture message"))
      throw Error("room switch retained a different timeline");
    await workspaceFixtureStep(controlPort, "allow-design-posts");
    openChannelNavigation(host, "Channels");
    const switchTeam = ui.getByRole("button", {
      name: "Switch team, Browser team",
    });
    flushSync(() => fireEvent.click(switchTeam));
    const current = await ui.findByRole("button", {
      name: "Browser team",
      current: true,
    });
    if (document.activeElement !== current)
      throw Error("first browser sign-in lost the current team focus");
    flushSync(() => fireEvent.click(current));
    if (document.activeElement !== switchTeam)
      throw Error("Closing the unchanged team lost the team button focus");
    flushSync(() =>
      fireEvent.click(
        ui.getByRole("button", { name: "Design", current: "page" }),
      ),
    );
    // Reload permissions through the regular reconnect path. Dismissing the
    // team list no longer remounts or refreshes the focused workspace.
    const previousOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    try {
      flushSync(() => window.dispatchEvent(new Event("offline")));
    } finally {
      if (previousOnline)
        Object.defineProperty(navigator, "onLine", previousOnline);
      else Reflect.deleteProperty(navigator, "onLine");
      flushSync(() => window.dispatchEvent(new Event("online")));
    }
    await ui.findByText("Design fixture message", {}, { timeout: 10_000 });
    await ui.findByRole("heading", { name: "Design" });
    const designDraft = await ui.findByRole<HTMLTextAreaElement>(
      "textbox",
      { name: "Message #Design…" },
      { timeout: 10_000 },
    );
    if (designDraft.value !== "")
      throw Error("channel switch exposed the Town draft");
    const neighbor = await openAccountRestConnection(server, "f".repeat(26));
    try {
      await waitFor(async () => {
        const town = await neighbor.readDraft({ channelId: "c".repeat(26) });
        if (town.message !== "Draft from the channel window")
          throw Error("changing channel lost the draft");
      });
    } finally {
      await neighbor.close();
    }
    const savedDesignPost = (
      await ui.findByText("Design fixture message")
    ).closest("article");
    if (!savedDesignPost)
      throw Error("The saved Design post is outside its timeline row");
    await within(savedDesignPost).findByText("fixture-author");
    if ((await getCurrentAccountId(server)) !== "f".repeat(26))
      throw Error("entry did not retain the signed-in account");
    await checkAvailableDirectoryWindow(host, controlPort);
    const avatar = ui.getByRole("button", { name: "Account" });
    function openSignOut() {
      flushSync(() => fireEvent.click(avatar));
      flushSync(() =>
        fireEvent.click(ui.getByRole("button", { name: "Sign out" })),
      );
      const confirmation = within(
        ui.getByRole("dialog", { name: "Sign out of this account?" }),
      );
      const cancel = confirmation.getByRole("button", { name: "Cancel" });
      if (document.activeElement !== cancel)
        throw Error("Sign-out confirmation did not focus Cancel");
      return confirmation;
    }
    function checkDismissed() {
      if (ui.queryByRole("dialog") || document.activeElement !== avatar)
        throw Error("Dismissed sign-out did not return focus to the avatar");
    }
    const approval = openSignOut();
    flushSync(() =>
      fireEvent.click(approval.getByRole("button", { name: "Cancel" })),
    );
    checkDismissed();
    const keyboard = openSignOut();
    flushSync(() =>
      fireEvent.keyDown(keyboard.getByRole("button", { name: "Cancel" }), {
        key: "Escape",
      }),
    );
    checkDismissed();
    openSignOut().getByRole("button", { name: "Sign out" }).click();
    const stay = await ui.findByRole(
      "button",
      { name: "Stay signed in" },
      { timeout: 10_000 },
    );
    if ((await getCurrentAccountId(server)) !== "f".repeat(26))
      throw Error("unconfirmed sign-out removed the account");
    if (document.activeElement !== stay)
      throw Error("An unconfirmed sign-out did not focus Stay signed in");
    flushSync(() => fireEvent.click(stay));
    checkDismissed();
    openSignOut().getByRole("button", { name: "Sign out" }).click();
    const local = await ui.findByRole(
      "button",
      { name: "Sign out only on this device" },
      { timeout: 10_000 },
    );
    local.click();
    await ui.findByRole(
      "heading",
      { name: "Sign in again" },
      { timeout: 15_000 },
    );
  } finally {
    root.unmount();
    host.remove();
    await forgetInstallation(otherServer);
  }
}

async function firstTeamControl(
  port: string,
  step: "first-team-empty" | "first-team-back" | "first-team-invite",
) {
  const control = await openNativeRestConnection(`https://127.0.0.1:${port}`);
  try {
    const result = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${step}`,
    );
    if (result.status !== 204)
      throw Error(`First team fixture did not complete ${step}`);
  } finally {
    await control.close();
  }
}
