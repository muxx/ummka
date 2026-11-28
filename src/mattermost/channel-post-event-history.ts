import { type PostsApi, ResponseError } from "../../vendor/mattermost/index.js";
import type { ChannelPostChange } from "./account-channel-events.ts";
import type { ChannelRefreshResult } from "./channel-history-refresh.ts";
import { channelPostChange } from "./channel-post-records.ts";
import { isMattermostId } from "./model-fields.ts";

type PostChange = ReturnType<typeof channelPostChange>;
type Writer = {
  begin(channelId: string): Promise<number>;
  store(load: number, changes: PostChange[]): Promise<ChannelRefreshResult>;
  cancel(load: number): Promise<void>;
};

export async function applyPostEventHistory(
  api: Pick<PostsApi, "getPost">,
  writer: Writer,
  channelId: string,
  addresses: readonly ChannelPostChange[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (
    !isMattermostId(channelId) ||
    addresses.length > 32 ||
    addresses.some(
      (row) =>
        row.channelId !== channelId ||
        !isMattermostId(row.postId) ||
        (row.rootId !== null &&
          (!isMattermostId(row.rootId) || row.rootId === row.postId)) ||
        (row.kind !== "edited" && row.kind !== "deleted"),
    )
  )
    throw new TypeError("Invalid changed channel post address.");
  const load = await writer.begin(channelId);
  const changes: PostChange[] = [];
  const refused: string[] = [];
  try {
    for (const row of addresses) {
      signal.throwIfAborted();
      if (row.kind === "deleted") {
        changes.push({ kind: "remove", id: row.postId, channelId });
        continue;
      }
      try {
        const post = await api.getPost({ postId: row.postId }, { signal });
        if ((post.rootId || null) !== row.rootId)
          throw new TypeError("Unexpected edited channel thread.");
        changes.push(channelPostChange(channelId, row.postId, post));
      } catch (error) {
        // An edit can already have been overtaken by a deletion. Only the
        // addressed delete notice authorizes eviction from other cached pages.
        if (
          !(error instanceof ResponseError) ||
          ![403, 404].includes(error.response.status)
        )
          throw error;
        if (error.response.status === 403) refused.push(row.postId);
        await error.response.body?.cancel().catch(() => {});
      }
    }
    signal.throwIfAborted();
  } catch (error) {
    await writer.cancel(load);
    throw error;
  }
  const result = await writer.store(load, changes);
  return { result, changes, ...(refused.length && { refused }) };
}
