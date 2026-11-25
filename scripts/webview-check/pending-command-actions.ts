import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

export async function checkPendingCommandActions(
  host: HTMLElement,
  field: HTMLTextAreaElement,
  account: Awaited<ReturnType<typeof openAccountRestConnection>>,
) {
  const location = { channelId: "c".repeat(26) };
  const original = await account.readDraft(location);
  const saved = await account.saveDraft({
    ...location,
    expectedRevision: original.revision,
    message: "/me repeat from the window",
  });
  if (saved.kind !== "saved" || !saved.draft.revision)
    throw Error("repeat draft not saved");
  const claim = await account.transitionDraftCommand(
    { ...location, revision: saved.draft.revision },
    "start",
  );
  if (claim.kind !== "saved" || !claim.draft.commandPending)
    throw Error("repeat attempt not marked");
  fireEvent(window, new Event("focus"));
  const ui = within(host);
  const repeat = await ui.findByRole("button", { name: "Run again" });
  if (!field.readOnly)
    throw Error("marked command must remain selectable and read-only");
  flushSync(() => fireEvent.click(repeat));
  const confirm = ui.getByRole("button", { name: "Run anyway" });
  if (document.activeElement !== confirm)
    throw Error("missing repeat confirmation focus");
  flushSync(() => fireEvent.keyDown(confirm, { key: "Escape" }));
  const again = ui.getByRole("button", { name: "Run again" });
  if (
    document.activeElement !== again ||
    (await account.readDraft(location)).revision !== claim.draft.revision
  )
    throw Error("cancelled repeat changed the draft or lost focus");
  flushSync(() => fireEvent.click(again));
  flushSync(() =>
    fireEvent.click(ui.getByRole("button", { name: "Run anyway" })),
  );
  await ui.findByText(
    "The fixture received the confirmed repeat.",
    {},
    { timeout: 10000 },
  );
  await waitFor(async () => {
    const stored = await account.readDraft(location);
    if (
      field.readOnly ||
      field.value !== "" ||
      stored.message !== "" ||
      !stored.clearedBySubmission ||
      stored.commandPending
    )
      throw Error("confirmed repeat did not settle the visible draft");
  });
}
