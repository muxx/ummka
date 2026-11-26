import { openPostCollection } from "../../src/channels/post-collection.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

export async function checkCollectionRemoval(
  account: Awaited<ReturnType<typeof openAccountRestConnection>>,
  channelId: string,
) {
  const pins = openPostCollection(account, { kind: "pins", channelId });
  const saved = openPostCollection(account, { kind: "channel", channelId });
  const id = "k".repeat(26);
  for (const view of [saved, pins]) {
    await view.refresh();
    if (view.getSnapshot().value?.items[0]?.id !== id)
      throw Error("Missing original collection row");
  }
  const change = saved.remove(id);
  if (
    saved.getSnapshot().removing[0] !== id ||
    change !== saved.remove(id) ||
    (await change) !== "removed" ||
    saved.getSnapshot().value?.items.length !== 0
  )
    throw Error("Personal collection change was not confirmed");
  if (saved.getSnapshot().continuation !== "available")
    throw Error("Short visible page incorrectly ended a saved scan");
  await saved.loadMore();
  if (
    saved.getSnapshot().value?.items[0]?.id !== "z".repeat(26) ||
    saved.getSnapshot().continuation !== "none"
  )
    throw Error("Saved continuation lost the older post after removal");
  await pins.refresh();
  if (
    pins.getSnapshot().value?.items[0]?.id !== id ||
    (await pins.remove(id)) !== "removed"
  )
    throw Error("Shared pin did not survive the personal change");
  for (const view of [saved, pins]) {
    await view.refresh();
    if (view.getSnapshot().value?.items.length !== 0)
      throw Error("Removed collection entry still present");
    view.close();
  }
}
