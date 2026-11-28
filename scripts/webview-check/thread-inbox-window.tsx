import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { isAndroid } from "../../src/build-platform.ts";
import {
  connectInstallation,
  forgetInstallation,
  readInstallationSelection,
  selectInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { openChannelNavigation } from "./account-team-window.tsx";

async function controlStep(
  url: string,
  name: "inbox-hidden" | "inbox-back" | "inbox-verify",
) {
  const control = await openNativeRestConnection(url);
  try {
    const result = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${name}`,
    );
    if (result.status !== 204)
      throw Error(`The native fixture did not confirm ${name}`);
  } finally {
    await control.close();
  }
}

export async function checkThreadInboxWindow(url: string) {
  const original = await readInstallationSelection();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    ui = within(host);
  const android = isAndroid;
  const present =
    import.meta.env.UMMKA_INBOX_FOCUS === true ? getCurrentWindow() : null;
  let shown = false;
  const click = (el: HTMLElement) => flushSync(() => fireEvent.click(el));
  try {
    await connectInstallation(url);
    flushSync(() => root.render(<App language="en" />));
    await ui.findByText("Town fixture message", {}, { timeout: 15000 });
    const channelDraft = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    flushSync(() =>
      fireEvent.input(channelDraft, {
        target: { value: "Town draft for later" },
      }),
    );
    openChannelNavigation(host, "Channels");
    click(await ui.findByRole("button", { name: /^Threads/ }));
    const followed = await ui.findByRole("tab", { name: "Followed threads" });
    await ui.findByRole("button", { name: /Release checklist/ });
    click(ui.getByRole("tab", { name: /Unread/ }));
    await ui.findByRole("button", { name: /Release checklist/ });
    click(followed);
    const opener = await ui.findByRole("button", { name: /Release checklist/ });
    opener.focus();
    click(opener);
    const pane = await ui.findByRole("complementary", { name: "Thread" }),
      thread = within(pane);
    const marker = await thread.findByRole(
      "separator",
      { name: "Unread replies" },
      { timeout: 10000 },
    );
    await thread.findByText("A new answer from a teammate");
    const field = await thread.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Reply in thread…",
    });
    flushSync(() =>
      fireEvent.input(field, { target: { value: "Design thread draft" } }),
    );
    if (!android) {
      if (document.hasFocus() || !opener.textContent?.includes("new reply"))
        throw Error("A hidden app window must leave this discussion unread");
      await controlStep(url, "inbox-hidden");
    }
    if (present) {
      await present.show();
      shown = true;
      await present.setFocus();
      await getCurrentWebview().setFocus();
    }
    if (android || present) {
      await waitFor(
        () => {
          if (document.visibilityState !== "visible" || !document.hasFocus())
            throw Error("The presented inbox window has no input focus");
          if (opener.textContent?.includes("new reply"))
            throw Error("Thread was not confirmed read");
        },
        { timeout: 5000 },
      );
    }
    if (
      !marker.isConnected ||
      !marker
        .closest(".thread-reply")
        ?.textContent?.includes("A new answer from a teammate")
    )
      throw Error("Read confirmation moved the original marker");
    const compact =
      (host.querySelector(".channels-frame")?.clientWidth ?? 0) <= 740;
    if (
      (opener.getClientRects().length === 0) !== compact ||
      (!compact && document.activeElement !== opener)
    )
      throw Error("Thread list focus or compact layout changed during opening");
    if (android) await controlStep(url, "inbox-back");
    else click(thread.getByRole("button", { name: "Close thread" }));
    await waitFor(() => {
      if (
        pane.isConnected ||
        document.activeElement !== opener ||
        !opener.getClientRects().length
      )
        throw Error("Back did not restore the followed thread row");
    });
    openChannelNavigation(host, "Channels");
    click(ui.getByRole("button", { name: "Town Square" }));
    const restored = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    if (restored !== channelDraft || restored.value !== "Town draft for later")
      throw Error("Opening another channel’s thread lost the original draft");
    const account = await openAccountRestConnection(url, "f".repeat(26));
    try {
      await waitFor(async () => {
        const draft = await account.readDraft({
          channelId: "d".repeat(26),
          rootId: "s".repeat(26),
        });
        if (draft.message !== "Design thread draft")
          throw Error("The reply draft did not survive closing the thread");
      });
    } finally {
      await account.close();
    }
    await controlStep(url, "inbox-verify");
  } finally {
    if (shown) await present?.hide();
    flushSync(() => root.unmount());
    host.remove();
    if (!original.installations.includes(url)) await forgetInstallation(url);
    if (original.selected && original.selected !== url)
      await selectInstallation(original.selected);
  }
}
