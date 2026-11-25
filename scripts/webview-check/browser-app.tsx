import { fireEvent, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";

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
    await ui.findByRole(
      "heading",
      { name: "Browser team" },
      { timeout: 20_000 },
    );
    const switchTeam = await ui.findByRole("button", { name: "Switch team" });
    if (ui.queryByRole("textbox"))
      throw Error("verified account stayed on an entry form");
    flushSync(() => fireEvent.click(switchTeam));
    const current = await ui.findByRole("button", {
      name: "Browser team",
      current: true,
    });
    if (document.activeElement !== current)
      throw Error("first browser sign-in lost the current team focus");
    flushSync(() => fireEvent.click(current));
    const heading = await ui.findByRole("heading", { name: "Browser team" });
    if (document.activeElement !== heading)
      throw Error("the selected workspace lost keyboard focus");
  } finally {
    root.unmount();
    host.remove();
  }
}
