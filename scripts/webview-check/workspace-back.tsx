import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import { checkFirstTeamChoice } from "./account-team-window.tsx";
import { checkAvailableDirectoryWindow } from "./available-directory-window.ts";
import { checkChannelNotificationsWindow } from "./channel-notifications-window.ts";
import { fixtureStep } from "./fixture-step.ts";
import { systemReply, systemRoot } from "./link-examples.ts";
import {
  verifyAttachmentReturn,
  verifySearchAttachment,
} from "./published-attachments.ts";
import {
  checkRowPermalink,
  openThreadFromMessageMenu,
} from "./published-post-actions.ts";

export function inspectChannelTable(table: ReturnType<typeof within>) {
  const score = table.getByRole("columnheader", { name: "Score" });
  if (
    score.getAttribute("scope") !== "col" ||
    getComputedStyle(score).textAlign !== "right"
  )
    throw Error(
      "Timeline table lost its accessible column header or alignment",
    );
}

export function inspectReplyTable(table: ReturnType<typeof within>) {
  const extraCell = table.getByRole("cell", { name: "Exact overflow cell" });
  if (!extraCell.querySelector("strong"))
    throw Error("Thread table lost the formatting of an extra cell");
  table.getByRole("columnheader", { name: "Reply col" });
}

function desktopTable(row: HTMLElement) {
  const content = within(row);
  if (content.queryByRole("button", { name: /^Open table:/ }))
    throw Error("Desktop replaced its inline table with a mobile preview");
  return within(content.getByRole("table"));
}

export function findThreadDraft(host: HTMLElement) {
  // Observe the workspace, not unrelated mutations elsewhere in the test
  // document. Check DOM identity before traversing the accessibility tree.
  return waitFor(
    () => {
      const pane = host.querySelector<HTMLElement>("aside.channels-thread");
      const reply = pane?.querySelector<HTMLElement>(
        `article[data-post-id="${systemReply}"]`,
      );
      const field = pane?.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Reply in thread…"]',
      );
      const visible = field && field.getClientRects().length > 0;
      if (!pane || !reply || !visible) {
        const notice = pane?.querySelector(".workspace-notice")?.textContent;
        const editor = field ? (visible ? "visible" : "hidden") : "absent";
        throw Error(
          `Thread draft pending (pane=${Boolean(pane)}, reply=${Boolean(reply)}, editor=${editor}, document=${document.visibilityState}${notice ? `, notice=${notice}` : ""})`,
        );
      }
      within(reply).getByText("Reply visible only inside Town’s thread");
      return { pane, thread: within(pane), field };
    },
    { container: host, timeout: 10_000, onTimeout: (error) => error },
  );
}

export async function verifyWorkspaceBack(
  host: HTMLElement,
  port: string,
  opener: HTMLElement,
  channel: HTMLTextAreaElement,
) {
  const ui = within(host);
  const threadText = "Unsent reply kept while searching";
  const channelText = channel.value;
  const control = await fixtureStep("connect-workspace-back-driver", () =>
    openNativeRestConnection(`https://127.0.0.1:${port}`),
  );
  let trusted = 0;
  const mac = !navigator.userAgent.includes("Android");
  function observed(e: KeyboardEvent) {
    if (e.key === "Escape" && e.isTrusted) trusted++;
  }
  window.addEventListener("keydown", observed, true);
  async function press(step: string) {
    const previous = trusted;
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=back-${step}`,
    );
    if (response.status !== 204)
      throw Error("The native input driver did not accept " + step);
    if (mac)
      await waitFor(
        () => {
          if (trusted !== previous + 1)
            throw Error("Missing trusted Cocoa Escape for " + step);
        },
        { timeout: 4000 },
      );
  }
  try {
    const {
      field: reply,
      pane,
      thread,
    } = await fixtureStep("wait-for-thread-draft", () => findThreadDraft(host));
    flushSync(() => fireEvent.input(reply, { target: { value: threadText } }));
    const replyRow = thread
      .getByText("Reply visible only inside Town’s thread")
      .closest("article");
    if (!replyRow) throw Error("Missing thread attachment row");
    await fixtureStep("return-from-reply-message-actions", async () => {
      const trigger = within(replyRow).getByRole("button", {
        name: "Message actions",
      });
      flushSync(() => fireEvent.click(trigger));
      const menu = within(document.body).getByRole("dialog", {
        name: "Message actions",
      });
      if (within(menu).queryByRole("button", { name: /thread/i }))
        throw Error("Replies inside a thread offered another thread action");
      await press("post-actions");
      await waitFor(() => {
        if (
          menu.isConnected ||
          document.activeElement !== trigger ||
          !pane.isConnected ||
          reply.value !== threadText ||
          channel.value !== channelText
        )
          throw Error("Returning from message actions lost focus or a draft");
      });
    });
    await fixtureStep("return-from-reply-attachment", () =>
      verifyAttachmentReturn(replyRow, "reply-photo.png", "0 B", () =>
        press("attachment-reply"),
      ),
    );
    if (
      !reply.isConnected ||
      reply.value !== threadText ||
      !channel.isConnected ||
      channel.value !== channelText
    )
      throw Error("Returning from the reply attachment lost a composer draft");
    const palette = ui.getByRole("button", { name: "Appearance" });
    flushSync(() => fireEvent.click(palette));
    const appearance = within(
      await ui.findByRole("dialog", { name: "Appearance" }),
    );
    const dark = appearance.getByRole("button", { name: "Dark" });
    const light = appearance.getByRole("button", { name: "Light" });
    const initialMode = appearance.getByRole("button", { pressed: true });
    const next =
      document.documentElement.dataset.appearance === "dark" ? light : dark;
    flushSync(() => fireEvent.click(next));
    await waitFor(() => {
      if (
        next.getAttribute("aria-pressed") !== "true" ||
        document.documentElement.dataset.appearance !==
          (next === dark ? "dark" : "light")
      )
        throw Error("The active workspace did not adopt the chosen appearance");
    });
    flushSync(() => fireEvent.click(initialMode));
    await press("appearance");
    await waitFor(() => {
      if (
        ui.queryByRole("dialog") ||
        document.activeElement !== palette ||
        !reply.isConnected ||
        reply.value !== threadText ||
        !channel.isConnected ||
        channel.value !== channelText
      )
        throw Error(
          "Appearance lost the active thread, composer drafts or toolbar focus",
        );
    });
    const search = ui.getByRole("button", { name: "Search" });
    flushSync(() => fireEvent.click(search));
    const form = within(
      await ui.findByRole("dialog", { name: "What are you looking for?" }),
    );
    flushSync(() =>
      fireEvent.input(form.getByRole("searchbox"), {
        target: { value: "window fixture" },
      }),
    );
    flushSync(() =>
      fireEvent.click(form.getByRole("button", { name: "Search" })),
    );
    const resultsNode = await ui.findByRole(
      "complementary",
      { name: "Search results" },
      { timeout: 10000 },
    );
    const results = within(resultsNode);
    await results.findByRole("button", {
      name: "Search found this fixture post",
    });
    flushSync(() =>
      fireEvent.click(
        results.getByRole("button", { name: /Edit.*window fixture/i }),
      ),
    );
    const editedDialog = await ui.findByRole<HTMLDialogElement>("dialog", {
      name: "What are you looking for?",
    });
    const editedQuery =
      within(editedDialog).getByRole<HTMLInputElement>("searchbox");
    const unsent = "not submitted";
    flushSync(() =>
      fireEvent.input(editedQuery, {
        target: { value: unsent },
      }),
    );
    if (!mac)
      await fixtureStep("back-search-keyboard", async () => {
        const { left, top, width, height } =
          editedQuery.getBoundingClientRect();
        const x = Math.round((left + width / 2) * devicePixelRatio);
        const y = Math.round((top + height / 2) * devicePixelRatio);
        const response = await control.fetchApi(
          `${control.basePath}/api/v4/system/ping?step=search-ime-back&case=${x},${y}`,
        );
        if (response.status !== 204)
          throw Error(
            "The native input driver could not dismiss the search IME",
          );
        if (
          !editedDialog.open ||
          !editedDialog.isConnected ||
          editedQuery.value !== unsent ||
          !resultsNode.isConnected
        )
          throw Error(
            "Keyboard Back closed the search editor or lost its query",
          );
      });
    await fixtureStep("back-search-dialog", () => press("dialog"));
    await waitFor(() => {
      if (
        ui.queryByRole("dialog") ||
        !resultsNode.getClientRects().length ||
        document.activeElement !== search ||
        !results.getByText("window fixture")
      )
        throw Error(
          `Canceling search: dialog=${Boolean(ui.queryByRole("dialog"))} results=${Boolean(resultsNode.getClientRects().length)} focus=${document.activeElement?.className} query=${Boolean(results.queryByText("window fixture"))}`,
        );
    });
    await press("results");
    const { pane: restored, field: restoredField } =
      await findThreadDraft(host);
    await waitFor(() => {
      if (
        resultsNode.isConnected ||
        !restored.getClientRects().length ||
        document.activeElement !== search ||
        restoredField.value !== threadText
      )
        throw Error(
          `Leaving search: resultsConnected=${resultsNode.isConnected} threadVisible=${Boolean(restored.getClientRects().length)} focus=${document.activeElement?.className} draft=${restoredField.value === threadText}`,
        );
    });
    await press("thread");
    await waitFor(() => {
      if (
        restored.isConnected ||
        !channel.getClientRects().length ||
        channel.value !== channelText ||
        document.activeElement !== opener
      )
        throw Error(
          "Leaving the thread lost the invoking post or channel draft",
        );
    });
    openThreadFromMessageMenu(opener);
    const { pane: reopened, field: reopenedField } =
      await findThreadDraft(host);
    await waitFor(() => {
      if (reopenedField.value !== threadText)
        throw Error("The saved thread draft did not reopen");
    });
    flushSync(() => fireEvent.input(reopenedField, { target: { value: "" } }));
    await press("reopened");
    await waitFor(() => {
      if (reopened.isConnected || document.activeElement !== opener)
        throw Error("The reopened thread did not return to the same post");
    });
    await checkChannelNotificationsWindow(host, press);
    const mobileNav = ui.queryByRole("button", { name: "Channels" });
    if (mobileNav) flushSync(() => fireEvent.click(mobileNav));
    const directory = ui.getByRole("button", { name: "Directory" });
    const navigation = directory.parentElement;
    if (!navigation) throw Error("The Directory row has no navigation pane");
    const itemBounds = directory.getBoundingClientRect();
    const navigationBounds = navigation.getBoundingClientRect();
    if (
      Math.abs(itemBounds.left - navigationBounds.left - 9) > 1 ||
      Math.abs(itemBounds.width + 18 - navigation.clientWidth) > 1 ||
      itemBounds.height !== (mobileNav ? 44 : 31)
    )
      throw Error("Directory row does not fit its navigation insets");
    flushSync(() => fireEvent.click(directory));
    const catalog = within(await ui.findByRole("main", { name: "Directory" }));
    const title = catalog.getByRole("heading", { level: 1, name: "Directory" });
    if (
      document.activeElement !== title ||
      channel.getClientRects().length ||
      directory.getAttribute("aria-current") !== "page"
    )
      throw Error("The catalog did not take focus from the channel");
    await press("directory");
    await waitFor(() => {
      if (
        document.activeElement !== directory ||
        directory.getClientRects().length === 0
      )
        throw Error(
          "Directory Back did not restore focus to its visible sidebar entry",
        );
    });
    flushSync(() => fireEvent.click(directory));
    const joined = within(await ui.findByRole("list", { name: "My channels" }));
    flushSync(() =>
      fireEvent.click(
        joined.getByRole("button", { name: "Town Square, Public channel" }),
      ),
    );
    await waitFor(() => {
      if (!channel.getClientRects().length || channel.value !== channelText)
        throw Error("Reopening the channel from the directory lost its draft");
    });
    await fixtureStep("team-choice-native-back", async () => {
      const nav = ui.queryByRole("button", { name: "Channels" });
      if (nav) flushSync(() => fireEvent.click(nav));
      const trigger = ui.getByRole("button", { name: /^Switch team,/ });
      flushSync(() => fireEvent.click(trigger));
      const direct = ui.getByRole("dialog", { name: "Teams and servers" });
      await press("team-choice-direct");
      await waitFor(() => {
        if (
          direct.isConnected ||
          document.activeElement !== trigger ||
          !channel.isConnected ||
          channel.value !== channelText
        )
          throw Error(
            "Team choice Back lost the team button or the channel draft",
          );
      });
      const avatar = ui.getByRole("button", { name: "Account" });
      flushSync(() => fireEvent.click(avatar));
      const original = ui.getByRole("dialog");
      const choice = within(original).getByRole("button", {
        name: "Teams and servers",
      });
      flushSync(() => fireEvent.click(choice));
      const nested = ui.getByRole("dialog", { name: "Teams and servers" });
      await press("team-choice-nested");
      const resumed = await waitFor(() => {
        const menu = ui.queryByRole("dialog");
        if (
          nested.isConnected ||
          original.isConnected ||
          !menu ||
          document.activeElement !==
            within(menu).getByRole("button", { name: "Teams and servers" })
        )
          throw Error(
            "Team choice Back did not return to its account menu action",
          );
        return menu;
      });
      await press("team-choice-account");
      await waitFor(() => {
        if (
          resumed.isConnected ||
          document.activeElement !== avatar ||
          !channel.isConnected ||
          channel.value !== channelText
        )
          throw Error(
            "Returning from the account menu lost the avatar or the channel draft",
          );
      });
      if (nav) {
        flushSync(() =>
          fireEvent.click(
            ui.getByRole("button", { name: /Town Square/, current: "page" }),
          ),
        );
      }
    });
  } finally {
    window.removeEventListener("keydown", observed, true);
  }
  await fixtureStep("close-workspace-back-driver", control.close);
}

export async function checkDesktopBack(port: string, server: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await fixtureStep("mount-desktop-workspace", () =>
    flushSync(() => root.render(<App language="en" />)),
  );
  const ui = within(host);
  await checkFirstTeamChoice(host, server);
  const town = (
    await fixtureStep("wait-for-town-message", () =>
      ui.findByText("Town fixture message", {}, { timeout: 10000 }),
    )
  ).closest("article");
  if (!town)
    throw Error("The desktop channel did not render the fixture message");
  await fixtureStep("copy-desktop-channel-permalink", () => {
    inspectChannelTable(desktopTable(town));
    return checkRowPermalink(town, `${server}/browser/pl/${systemRoot}`);
  });
  const channel = await fixtureStep("wait-for-town-draft", () =>
    ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    }),
  );
  const opener = within(town).getByRole("button", { name: "Message actions" });
  await fixtureStep("open-desktop-thread", () => {
    flushSync(() =>
      fireEvent.input(channel, {
        target: { value: "Unsent desktop channel draft" },
      }),
    );
    openThreadFromMessageMenu(opener);
  });
  await fixtureStep("copy-desktop-reply-permalink", async () => {
    const { thread } = await findThreadDraft(host);
    const reply = thread
      .getByText("Reply visible only inside Town’s thread")
      .closest("article");
    if (!reply) throw Error("The desktop reply is outside its published row");
    inspectReplyTable(desktopTable(reply));
    await checkRowPermalink(reply, `${server}/browser/pl/${systemReply}`, true);
  });
  await verifyWorkspaceBack(host, port, opener, channel);
  flushSync(() => fireEvent.click(ui.getByRole("button", { name: "Search" })));
  const query = within(
    await ui.findByRole("dialog", { name: "What are you looking for?" }),
  );
  flushSync(() =>
    fireEvent.input(query.getByRole("searchbox"), {
      target: { value: "window fixture" },
    }),
  );
  flushSync(() =>
    fireEvent.click(query.getByRole("button", { name: "Search" })),
  );
  const results = await verifySearchAttachment(host, port, channel);
  flushSync(() =>
    fireEvent.click(results.getByRole("button", { name: "Close search" })),
  );
  await checkAvailableDirectoryWindow(host, port);
  root.unmount();
  host.remove();
}
