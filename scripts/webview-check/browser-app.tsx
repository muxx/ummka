import { fireEvent, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { getCurrentAccountId } from "../../src/mattermost/native-rest.ts";
import { openChannelNavigation } from "./account-team-window.tsx";

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
    await ui.findByText("fixture-author");
    openChannelNavigation(host, "Channels");
    const design = ui.getByRole("button", { name: "Design" });
    flushSync(() => fireEvent.click(design));
    await ui.findByText("Design fixture message", {}, { timeout: 10_000 });
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
    await ui.findByText("fixture-author");
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
