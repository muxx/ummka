import { invoke } from "@tauri-apps/api/core";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChannelTimeline } from "../../src/channels/ChannelTimeline.tsx";
import { conversationRows } from "../../src/channels/conversation-rows.ts";
import { measureTimeline } from "../../src/channels/timeline-viewport.ts";
import { useChannelTimeline } from "../../src/channels/use-channel-timeline.ts";
import type { PendingPost } from "../../src/mattermost/account-delivery.ts";
import type { LocalPost } from "../../src/mattermost/local-history.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
type Change =
  | (LocalPost & { kind: "save" })
  | { kind: "remove"; channelId: string; id: string };

async function until(test: () => boolean, reason: string) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > 4000)
      throw Error(`timeline commit: ${reason}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export async function checkOpenTimelineCommits(account: Account) {
  for (const width of [320, 820]) await checkWidth(account, width);
}

function Screen({
  account,
  channelId,
  address,
  pending,
}: {
  account: Account;
  channelId: string;
  address?: { requestId: number; anchorId: string };
  pending?: PendingPost;
}) {
  const timeline = useChannelTimeline(
    account,
    "t".repeat(26),
    channelId,
    false,
    false,
    () => {
      throw Error("Unexpected session change");
    },
  );
  if (timeline.status === "positionLost")
    return (
      <button onClick={timeline.showLatest} type="button">
        Go to latest messages
      </button>
    );
  return (
    <ChannelTimeline
      address={address}
      channelId={channelId}
      page={timeline.page}
      messages={
        pending
          ? conversationRows(
              timeline.page?.posts ?? [],
              [pending],
              channelId,
              null,
              "a".repeat(26),
              "timeline",
            ).messages
          : undefined
      }
      viewport={timeline.viewport}
      locale="en"
      author={() => ({ name: "Test user" })}
      offline={false}
      onReadEdge={timeline.loadEdge}
    />
  );
}

async function checkWidth(account: Account, width: number) {
  const prefix = width === 320 ? "v330n" : "v330w";
  const channelId = prefix.padEnd(26, "c");
  const id = (n: number) => prefix + n.toString(36).padStart(21, "0");
  function saved(n: number): Change {
    return {
      kind: "save",
      id: id(n),
      channelId,
      userId: "a".repeat(26),
      rootId: null,
      createAt: n,
      updateAt: n,
      editAt: 0,
      type: "",
      hashtags: "",
      isPinned: false,
      message: `Reading position ${n} / ${"abcd ".repeat(28)}`,
      messageSource: null,
    };
  }

  async function commit(
    source: { kind: "latest" } | { kind: "since"; since: number },
    changes: Change[],
  ) {
    const { rid } = account;
    const load = await invoke<number>("begin_channel_history_load", {
      rid,
      channelId,
    });
    const result = await invoke<{ kind: string }>(
      "store_channel_history_page",
      {
        rid,
        load,
        page: {
          channelId,
          collapsedThreads: false,
          source,
          order: changes.map((post) => post.id),
          changes,
          prevPostId: "",
          nextPostId: "",
          firstInaccessiblePostTime: 0,
        },
      },
    );
    if (result.kind !== "applied")
      throw Error("Timeline fixture commit was not applied");
    account.notifyChannelHistoryChanged(channelId);
  }
  const initial = Array.from({ length: 100 }, (_, i) => saved(100 - i));
  await commit({ kind: "latest" }, initial);

  const host = document.createElement("div");
  host.style.cssText = `width:${width}px;height:370px`;
  document.body.append(host);
  const root = createRoot(host);
  const article = (key: string) =>
    host.querySelector<HTMLElement>(`[data-post-id="${key}"]`);
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((el) => el.textContent === label);
  try {
    flushSync(() =>
      root.render(<Screen account={account} channelId={channelId} />),
    );
    await until(() => !!article(id(100)), "initial SQLite page");
    const currentScroller = () => {
      const scroller = host.querySelector<HTMLElement>(".timeline-scroll");
      if (!scroller) throw Error("Missing timeline scroller");
      return scroller;
    };
    let pane = currentScroller();
    const offset = (key: string) => {
      const row = article(key);
      if (!row) throw Error(`Missing anchor ${key}`);
      return row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    };
    const atBottom = () =>
      Math.abs(pane.scrollHeight - pane.clientHeight - pane.scrollTop) <= 2;
    if (!atBottom()) throw Error("Initial timeline did not follow the end");
    await commit({ kind: "latest" }, [saved(101), ...initial]);
    await until(() => !!article(id(101)), "appended newest row");
    if (!atBottom()) throw Error("Timeline did not stay at end after commit");

    // A post opened from search receives focus once. Later commits preserve the reader's own position.
    flushSync(() =>
      root.render(
        <Screen
          account={account}
          channelId={channelId}
          address={{ requestId: 1, anchorId: id(63) }}
        />,
      ),
    );
    await until(
      () => document.activeElement === article(id(63)),
      "addressed result receives focus",
    );
    pane.focus();
    pane.scrollTop += offset(id(63)) - 18;
    const before = offset(id(63));
    const edited = initial.map((post) =>
      post.kind === "save" && post.id === id(63)
        ? {
            ...post,
            message: post.message.replace("Reading", "Revised"),
            updateAt: 400,
            editAt: 400,
          }
        : post,
    );
    await commit({ kind: "latest" }, [saved(102), saved(101), ...edited]);
    await until(
      () => Boolean(article(id(63))?.textContent?.includes("Revised")),
      "anchored refresh",
    );
    if (
      Math.abs(offset(id(63)) - before) > 1 ||
      atBottom() ||
      document.activeElement !== pane
    )
      throw Error("Timeline commit moved the reader or keyboard focus");
    const preceding = saved(61);
    const precedingRow = article(preceding.id);
    if (
      preceding.kind !== "save" ||
      !precedingRow ||
      precedingRow.getBoundingClientRect().bottom >
        pane.getBoundingClientRect().top
    )
      throw Error(
        "Expected a published row entirely above the reading position",
      );
    const oldHeight = precedingRow.getBoundingClientRect().height;
    const extraLines = Array.from(
      { length: 8 },
      (_, n) => `Expanded paragraph ${n + 1}`,
    ).join("\n");
    await commit({ kind: "since", since: 1 }, [
      {
        ...preceding,
        message: extraLines,
        editAt: 450,
        updateAt: 450,
      },
    ]);
    await until(
      () =>
        article(preceding.id)?.textContent?.includes("Expanded paragraph 8") ===
        true,
      "preceding text edit",
    );
    const newHeight =
      article(preceding.id)?.getBoundingClientRect().height ?? 0;
    if (
      newHeight - oldHeight <= 20 ||
      Math.abs(offset(id(63)) - before) > 1 ||
      atBottom()
    )
      throw Error(
        "Editing the height of an earlier row displaced the visible post",
      );
    host.style.display = "none";
    const hidden = saved(63);
    if (hidden.kind !== "save") throw Error("Missing fixture post");
    await commit({ kind: "since", since: 1 }, [
      {
        ...hidden,
        updateAt: 500,
        editAt: 500,
        message: hidden.message.replace("Reading", "Visible again"),
      },
    ]);
    if (article(id(63))?.textContent?.includes("Visible again"))
      throw Error("Hidden reader replaced the parked window");
    host.style.display = "";
    await until(
      () => Boolean(article(id(63))?.textContent?.includes("Visible again")),
      "hidden window resumed on its visible anchor",
    );
    if (Math.abs(offset(id(63)) - before) > 1 || atBottom())
      throw Error("Restoring a changed hidden channel displaced the reader");
    // At the geometric bottom of a historical window, the known newer edge still wins.
    pane.scrollTop = pane.scrollHeight;
    const anchors = measureTimeline(pane).anchors;
    if (!button("Show later messages") || anchors.length < 2)
      throw Error("Missing old window with visible neighbors");
    const [first, neighbor] = anchors;
    const previousOffset = offset(neighbor.id);
    const remove = (keys: string[]): Change[] =>
      keys.map((key) => ({ kind: "remove", channelId, id: key }));
    await commit({ kind: "since", since: 1 }, remove([first.id]));
    await until(() => !article(first.id), "removed first visible anchor");
    if (
      !article(neighbor.id) ||
      Math.abs(offset(neighbor.id) - previousOffset) > 1 ||
      atBottom()
    )
      throw Error(
        "Removing the first visible anchor displaced the historical window",
      );
    const remaining = measureTimeline(pane).anchors.map((anchor) => anchor.id);
    if (!remaining.length) throw Error("No remaining anchors to remove");
    await commit({ kind: "since", since: 1 }, remove(remaining));
    await until(
      () => !!button("Go to latest messages"),
      "all visible anchors deleted",
    );
    if (article(id(102)))
      throw Error("Removing anchors unexpectedly jumped to latest");
    button("Go to latest messages")?.click();
    await until(() => !!article(id(102)), "explicit return to latest");

    pane = currentScroller();

    // A tall local attempt can fill the viewport or sit above its only published neighbor.
    const pending: PendingPost = {
      pendingId: "local-attempt",
      channelId,
      rootId: null,
      sequence: 1,
      createdAt: 100,
      previousLogin: false,
      confirmedPostId: null,
      refusal: null,
      attempt: 1,
      message: Array.from(
        { length: 36 },
        (_, line) => `Pending line ${line}`,
      ).join("\n"),
    };
    flushSync(() =>
      root.render(
        <Screen account={account} channelId={channelId} pending={pending} />,
      ),
    );
    if (!article(pending.pendingId)?.hasAttribute("data-outgoing"))
      throw Error("The displayed local attempt lacks its outgoing marker");
    const publishedNeighbor = saved(101);
    if (publishedNeighbor.kind !== "save")
      throw Error("Missing published fixture post");
    for (const mixed of [false, true]) {
      if (mixed)
        pane.scrollTop +=
          offset(publishedNeighbor.id) - (pane.clientHeight - 24);
      else pane.scrollTop += offset(pending.pendingId) + 10;
      const visible = measureTimeline(pane);
      const published = visible.anchors.filter((anchor) => anchor.published);
      if (
        visible.atBottom ||
        visible.anchors[0]?.id !== pending.pendingId ||
        published.length !== Number(mixed) ||
        (mixed && published[0]?.id !== publishedNeighbor.id)
      )
        throw Error(
          "The outgoing fixture did not occupy its expected viewport",
        );
      const expectedOffset = offset(pending.pendingId);
      const message = mixed
        ? "Refreshed with published neighbor"
        : "Refreshed behind local attempt";
      await commit({ kind: "since", since: 1 }, [
        { ...publishedNeighbor, message, updateAt: mixed ? 212 : 211 },
      ]);
      await until(
        () =>
          article(publishedNeighbor.id)?.textContent?.includes(message) ===
          true,
        message,
      );
      if (
        Math.abs(offset(pending.pendingId) - expectedOffset) > 1 ||
        atBottom()
      )
        throw Error(
          "A local attempt moved while its published history was refreshed",
        );
    }
  } finally {
    root.unmount();
    host.remove();
  }
}
