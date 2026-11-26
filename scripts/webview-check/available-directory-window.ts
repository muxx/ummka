import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import { openChannelNavigation } from "./account-team-window.tsx";

export async function checkAvailableDirectoryWindow(
  host: HTMLElement,
  port: string,
) {
  const ui = within(host);
  const click = (el: HTMLElement) => flushSync(() => fireEvent.click(el));
  openChannelNavigation(host, "Channels");
  click(await ui.findByRole("button", { name: "Directory" }));
  const catalog = within(await ui.findByRole("main", { name: "Directory" }));
  click(await catalog.findByRole("tab", { name: "Available" }));
  const potential = await catalog.findByRole("button", {
    name: "Release Notes",
  });
  const filter = catalog.getByRole<HTMLInputElement>("searchbox", {
    name: "Find a channel",
  });
  flushSync(() => fireEvent.input(filter, { target: { value: "#release" } }));
  await catalog.findByText("Searching…");
  const result = await catalog.findByRole("button", {
    name: "Release Notes",
  });
  click(result);
  const details = within(
    await catalog.findByRole("dialog", { name: "Join channel?" }),
  );
  details.getByText("Upcoming releases", { exact: false });
  details.getByText("Release announcements", { exact: false });
  details.getByRole("button", { name: "Cancel" }).focus();
  const control = await openNativeRestConnection(`https://127.0.0.1:${port}`);
  try {
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=back-directory-dialog`,
    );
    if (response.status !== 204)
      throw Error("The native driver did not accept directory Back");
  } finally {
    await control.close();
  }
  await waitFor(() => {
    if (catalog.queryByRole("dialog") || document.activeElement !== result)
      throw Error("Missing directory row focus");
  });
  click(result);
  click(
    within(await catalog.findByRole("dialog")).getByRole("button", {
      name: "Join",
    }),
  );
  const joined = await ui.findByRole(
    "main",
    { name: "Release Notes" },
    { timeout: 10000 },
  );
  await within(joined).findByText(
    "Welcome to Release Notes",
    {},
    { timeout: 10000 },
  );
  if (potential.isConnected || ui.queryByRole("dialog"))
    throw Error("Joined channel is not open");
}
