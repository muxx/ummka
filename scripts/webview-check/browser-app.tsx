import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import {
  getCurrentAccountId,
  openAccountRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { openChannelNavigation } from "./account-team-window.tsx";
import { checkPendingCommandActions } from "./pending-command-actions.ts";

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

export async function checkBrowserApp(server: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
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
    flushSync(() => fireEvent.click(provider));
    if (
      !ui.getByRole("heading", { name: "Continue in your browser" }) ||
      !ui.queryByText(server)
    )
      throw Error("browser wait lost the chosen installation");
    await ui.findByText("Town fixture message", {}, { timeout: 20_000 });
    await waitForAppForeground();
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
    flushSync(() =>
      fireEvent.click(ui.getByRole("button", { name: "Account" })),
    );
    ui.getByRole("button", { name: "Sign out" }).click();
    const stay = await ui.findByRole(
      "button",
      { name: "Stay signed in" },
      { timeout: 10_000 },
    );
    if ((await getCurrentAccountId(server)) !== "f".repeat(26))
      throw Error("unconfirmed sign-out removed the account");
    flushSync(() => fireEvent.click(stay));
    if (document.activeElement !== ui.getByRole("button", { name: "Sign out" }))
      throw Error("cancelled sign-out lost focus");
    ui.getByRole("button", { name: "Sign out" }).click();
    const local = await ui.findByRole(
      "button",
      { name: "Sign out only on this device" },
      { timeout: 10_000 },
    );
    local.click();
    await ui.findByRole("button", { name: "GitLab" }, { timeout: 15_000 });
  } finally {
    root.unmount();
    host.remove();
  }
}
