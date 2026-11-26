import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";

export function findThreadDraft(host: HTMLElement) {
  const ui = within(host);
  // History and the native draft store finish independently. Wait for the
  // loaded reply and its editor in the same currently mounted thread.
  return waitFor(
    () => {
      const pane = ui.getByRole("complementary", { name: "Thread" });
      const thread = within(pane);
      thread.getByText("Reply visible only inside Town’s thread");
      const field = thread.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply in thread…",
      });
      return { pane, thread, field };
    },
    { timeout: 10_000 },
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
  const control = await openNativeRestConnection(`https://127.0.0.1:${port}`);
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
    const { field: reply } = await findThreadDraft(host);
    flushSync(() => fireEvent.input(reply, { target: { value: threadText } }));
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
    let form = within(await ui.findByRole("dialog"));
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
    await results.findByText("Search found this fixture post");
    flushSync(() =>
      fireEvent.click(
        results.getByRole("button", { name: /Edit.*window fixture/i }),
      ),
    );
    form = within(await ui.findByRole("dialog"));
    flushSync(() =>
      fireEvent.input(form.getByRole("searchbox"), {
        target: { value: "not submitted" },
      }),
    );
    // Keep the soft keyboard out of this panel-navigation check on Android.
    if (!mac)
      form
        .getByRole<HTMLButtonElement>("button", { name: "Close search" })
        .focus();
    await press("dialog");
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
    flushSync(() => fireEvent.click(opener));
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
  } finally {
    window.removeEventListener("keydown", observed, true);
    await control.close();
  }
}

export async function checkDesktopBack(port: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<App language="en" />));
    const ui = within(host);
    const town = (
      await ui.findByText("Town fixture message", {}, { timeout: 10000 })
    ).closest("article");
    if (!town)
      throw Error("The desktop channel did not render the fixture message");
    const channel = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    flushSync(() =>
      fireEvent.input(channel, {
        target: { value: "Unsent desktop channel draft" },
      }),
    );
    const opener = within(town).getByRole("button", { name: /Open thread/ });
    flushSync(() => fireEvent.click(opener));
    await verifyWorkspaceBack(host, port, opener, channel);
  } finally {
    root.unmount();
    host.remove();
  }
}
