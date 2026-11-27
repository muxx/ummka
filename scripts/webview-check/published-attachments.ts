import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";

import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";

export async function verifyAttachmentReturn(
  row: HTMLElement,
  name: string,
  size: string,
  press: () => Promise<void>,
) {
  const file = await within(row).findByRole<HTMLButtonElement>("button", {
    name: `Open attachment ${name}, ${size}`,
  });
  const pane = row.closest<HTMLElement>(".timeline-scroll");
  if (!pane) throw Error("The published file has no conversation pane");
  file.scrollIntoView({ block: "nearest", behavior: "instant" });
  file.focus({ preventScroll: true });
  const initialScroll = pane.scrollTop;
  flushSync(() => fireEvent.click(file));
  const dialog = await within(document.body).findByRole("dialog", { name });
  const close = within(dialog).getByRole("button", { name: "Close" });
  if (
    !dialog.matches(":modal") ||
    document.activeElement !== close ||
    !within(dialog).getByText(size === "0 B" ? "0 B, empty file" : size)
  )
    throw Error(`The file ${name} did not open its published details`);
  await press();
  await waitFor(() => {
    const box = file.getBoundingClientRect(),
      view = pane.getBoundingClientRect();
    if (
      dialog.isConnected ||
      !file.isConnected ||
      !box.height ||
      box.bottom <= view.top ||
      box.top >= view.bottom ||
      document.activeElement !== file ||
      Math.abs(pane.scrollTop - initialScroll) > 1
    )
      throw Error(
        `Closing ${name} did not restore the visible file in its original pane`,
      );
  });
}

export async function verifySearchAttachment(
  host: HTMLElement,
  controlPort: string,
  channel: HTMLTextAreaElement,
) {
  const ui = within(host);
  const draft = channel.value;
  let results = within(
    await ui.findByRole("complementary", { name: "Search results" }),
  );
  flushSync(() =>
    fireEvent.click(results.getByRole("button", { name: "Files" })),
  );
  const fileAction = { name: "Show message with file window-fixture.pdf" };
  const openFile = await results.findByRole("button", fileAction);
  flushSync(() => fireEvent.click(openFile));
  const matchedPost = await waitFor(
    () => {
      const row = host.querySelector<HTMLElement>(
        "article[data-navigation-target]",
      );
      const box = row?.getBoundingClientRect();
      const feed = row?.closest(".timeline-scroll")?.getBoundingClientRect();
      if (
        !box?.height ||
        !feed ||
        box.bottom <= feed.top ||
        box.top >= feed.bottom ||
        row?.dataset.postId !== "v".repeat(26) ||
        document.activeElement !== row
      ) {
        throw Error("The file did not focus its visible, canonical message");
      }
      return row;
    },
    { timeout: 10_000 },
  );
  const backDriver = await openNativeRestConnection(
    `https://127.0.0.1:${controlPort}`,
  );
  try {
    await verifyAttachmentReturn(
      matchedPost,
      "window-fixture.pdf",
      "1 KB",
      async () => {
        const response = await backDriver.fetchApi(
          `${backDriver.basePath}/api/v4/system/ping?step=back-attachment-search`,
        );
        if (response.status !== 204)
          throw Error("Native Back was not dispatched to file details");
      },
    );
  } finally {
    await backDriver.close();
  }
  flushSync(() =>
    fireEvent.click(ui.getByRole("button", { name: "Back to results" })),
  );
  results = within(
    await ui.findByRole("complementary", { name: "Search results" }),
  );
  await waitFor(() => {
    if (
      document.activeElement !== results.getByRole("button", fileAction) ||
      channel.value !== draft
    )
      throw Error(
        "Returning did not restore the original file and channel draft",
      );
  });
  return results;
}
