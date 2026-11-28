import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChannelsWorkspace } from "../../src/channels/ChannelsWorkspace.tsx";
import { AccountTeamWindow } from "../../src/entry/AccountTeamWindow.tsx";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import { createThreadReadCoordination } from "../../src/mattermost/thread-read-coordination.ts";
import { openChannelNavigation } from "./account-team-window.tsx";

export async function checkRecipientWindow(port: string, controlPort: string) {
  const serverUrl = `https://127.0.0.1:${port}/recipient-window`;
  const userId = "f".repeat(26);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const control = await openNativeRestConnection(
    `https://127.0.0.1:${controlPort}`,
  );
  const click = (node: HTMLElement) => flushSync(() => fireEvent.click(node));
  const type = (node: HTMLElement, value: string) =>
    flushSync(() => fireEvent.input(node, { target: { value } }));
  const android = navigator.userAgent.includes("Android");
  async function press(step: string) {
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${step}`,
    );
    if (response.status !== 204)
      throw Error(`Recipient window control failed at ${step}`);
  }
  try {
    flushSync(() =>
      root.render(
        <AccountTeamWindow
          language="en"
          serverUrl={serverUrl}
          userId={userId}
          threadReads={createThreadReadCoordination()}
          onSessionEnded={() => {
            throw Error("Recipient-window account unexpectedly ended");
          }}
        >
          {(workspace) => (
            <ChannelsWorkspace
              key={`${workspace.connection.rid}:${workspace.team.id}`}
              workspace={workspace}
              language="en"
            />
          )}
        </AccountTeamWindow>,
      ),
    );
    const ui = within(host);
    const draft = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    const message = "Keep this draft while choosing recipients";
    type(draft, message);
    openChannelNavigation(host, "Channels");
    const trigger = ui.getByRole("button", { name: "Direct message actions" });
    async function pick() {
      click(trigger);
      click(ui.getByRole("menuitem", { name: "Write a message" }));
      const dialog = await ui.findByRole("dialog", {
        name: "New direct message",
      });
      const picker = within(dialog);
      const field = picker.getByRole("searchbox", { name: "Find people" });
      if (document.activeElement !== field)
        throw Error("Recipient search did not receive focus");
      return { dialog, picker, field };
    }
    const first = await pick();
    if (android) {
      const { left, top, width, height } = first.field.getBoundingClientRect();
      const x = Math.round((left + width / 2) * devicePixelRatio);
      const y = Math.round((top + height / 2) * devicePixelRatio);
      await press(`recipient-picker-ime-back&case=${x},${y}`);
      if (!first.dialog.hasAttribute("open"))
        throw Error("Back from the keyboard dismissed the recipient picker");
    }
    await press("recipient-picker-back");
    await waitFor(() => {
      if (first.dialog.isConnected || document.activeElement !== trigger)
        throw Error("Back did not restore the category trigger");
    });
    const readingHeight = window.visualViewport?.height;
    const { picker, field } = await pick();
    const local = await picker.findByRole<HTMLInputElement>("checkbox", {
      name: "north",
    });
    click(local);
    local.focus();
    picker.getByText("Checking people from other installations…");
    if (picker.queryByRole("checkbox", { name: "remote" }))
      throw Error("Remote recipient was shown before permission was confirmed");
    await press("recipient-picker-confirm");
    await picker.findByRole("checkbox", { name: "remote" });
    const order = picker
      .getAllByRole("checkbox")
      .map((entry) => entry.getAttribute("aria-label"));
    if (
      order.indexOf("remote") + 1 !== order.indexOf("north") ||
      !local.checked ||
      document.activeElement !== local
    )
      throw Error(
        "Remote confirmation lost the catalog order, local selection or focus",
      );
    type(field, "@south");
    click(await picker.findByRole("checkbox", { name: "south" }));
    click(picker.getByRole("button", { name: "Open conversation" }));
    await picker.findByText("Group conversations are restricted.");
    if (
      !picker.getByRole<HTMLInputElement>("checkbox", { name: "south" }).checked
    )
      throw Error("A refused group lost its recipient");
    click(picker.getByRole("checkbox", { name: "south" }));
    type(field, "");
    click(await picker.findByRole("checkbox", { name: "north" }));
    click(
      await picker.findByRole("checkbox", { name: "fixture-author (you)" }),
    );
    click(picker.getByRole("button", { name: "Open conversation" }));
    await picker.findByText(
      "Conversation created. Couldn’t refresh the sidebar to open it.",
    );
    if (!field.hasAttribute("readonly"))
      throw Error(
        "A confirmed conversation allowed another search before retrying",
      );
    click(picker.getByRole("button", { name: "Retry opening" }));
    await ui.findByText("Personal fixture message");
    await waitFor(() => {
      const focused = document.activeElement;
      const tag = innerWidth <= 740 ? "H1" : "TEXTAREA";
      if (focused?.tagName !== tag || !host.contains(focused))
        throw Error(`The destination should focus its ${tag.toLowerCase()}`);
      if (android && window.visualViewport?.height !== readingHeight)
        throw Error(
          "Opening the conversation changed the Android keyboard viewport",
        );
    });
    openChannelNavigation(host, "Channels");
    click(await ui.findByRole("button", { name: "Town Square" }));
    const restored = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #Town Square…",
    });
    await waitFor(() => {
      if (restored.value !== message)
        throw Error("Recipient window lost the original draft");
    });
    openChannelNavigation(host, "Channels");
    await ui.findByRole("button", { name: "fixture-author" });
    await press("recipient-picker-complete");
  } finally {
    root.unmount();
    host.remove();
    await control.close();
  }
}
