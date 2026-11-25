import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ConversationTimeline } from "../../src/channels/ConversationTimeline.tsx";
import type { PendingPost } from "../../src/mattermost/account-delivery.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

export async function retryFromTimeline(
  connection: Awaited<ReturnType<typeof openAccountRestConnection>>,
  userId: string,
  post: PendingPost,
) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <ConversationTimeline
          channelId={post.channelId}
          connection={connection}
          userId={userId}
          latest
          offline={false}
          locale="en"
          page={null}
          author={() => undefined}
          sessionIssue={() => {
            throw Error("Unexpected session failure in timeline retry");
          }}
        />,
      ),
    );
    const row = (await within(host).findByText(post.message)).closest(
      "article",
    );
    if (!row) throw Error("Missing unconfirmed outgoing row");
    const ui = within(row);
    const repeat = () => ui.getByRole("button", { name: "Send again" });
    const confirm = () => ui.getByRole("button", { name: "Send anyway" });
    flushSync(() => fireEvent.click(repeat()));
    const description = confirm().getAttribute("aria-describedby");
    if (
      document.activeElement !== confirm() ||
      !description ||
      !document.getElementById(description)?.textContent?.includes("duplicate")
    )
      throw Error("The retry lost its duplication warning or keyboard focus");
    flushSync(() => fireEvent.keyDown(confirm(), { key: "Escape" }));
    if (document.activeElement !== repeat())
      throw Error("Cancelling did not restore retry focus");
    flushSync(() => fireEvent.click(repeat()));
    flushSync(() => fireEvent.click(confirm()));
    await waitFor(
      () => {
        if (
          !row.textContent?.includes(
            "The server declined the retry. The first message may have arrived.",
          )
        )
          throw Error(
            "The retry did not preserve the uncertainty of the first attempt",
          );
      },
      { timeout: 7000 },
    );
    if (document.activeElement !== row)
      throw Error("Retry moved focus off the outgoing row");
    const saved = (
      await connection.readPendingPosts({
        channelId: post.channelId,
        limit: 20,
      })
    ).find((p) => p.pendingId === post.pendingId);
    if (
      saved?.attempt !== post.attempt + 1 ||
      saved.refusal !== null ||
      saved.retryRefusal?.status !== 403
    )
      throw Error("The visible retry did not persist its own refusal");
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
