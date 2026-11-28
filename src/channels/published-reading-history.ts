import type { SavedCollectionOrigin } from "../entry/use-message-navigation.tsx";
import { PostObservationSuperseded } from "../mattermost/message-anchors.ts";
import { inspectPostTarget } from "./inspect-post-target.ts";
import { measureTimeline, type TimelinePlace } from "./timeline-viewport.ts";
import type { RowOrigin } from "./use-workspace-collections.ts";
import { workspaceFailure } from "./workspace-data.ts";

export type PublishedReadingOrigin = {
  teamId: string;
  channelId: string;
  rootId: string | null;
  postId: string;
  link: { href: string; occurrence: number };
  reading: TimelinePlace;
  collection?:
    | { kind: "saved-team"; source: SavedCollectionOrigin; postId: string }
    | {
        kind: "workspace";
        row: RowOrigin;
        source:
          | { kind: "all" }
          | { kind: "pins"; channelId: string }
          | {
              kind: "mentions";
              archivedChannels: boolean;
              standalone: boolean;
            };
      };
};
type ReadingScope = Pick<
  PublishedReadingOrigin,
  "channelId" | "teamId" | "collection"
> & {
  threadRootId: string | null;
};

export function capturePublishedReadingOrigin(
  anchor: HTMLAnchorElement,
  scope: ReadingScope,
): PublishedReadingOrigin | null {
  const row = anchor.closest<HTMLElement>("[data-post-id]");
  const pane = row?.closest<HTMLElement>(".timeline-scroll");
  if (!row?.dataset.postId || !pane || anchor.closest("[hidden], [inert]"))
    return null;
  const rootId = pane.matches(".thread-feed") ? scope.threadRootId : null;
  if (pane.matches(".thread-feed") && rootId === null) return null;
  const link = anchor.getBoundingClientRect();
  const bounds = pane.getBoundingClientRect();
  if (
    link.bottom <= bounds.top ||
    link.top >= bounds.bottom ||
    link.right <= bounds.left ||
    link.left >= bounds.right
  )
    return null;
  const reading = measureTimeline(pane, false, row);
  if (reading.anchors.length !== 1 || !reading.anchors[0].published)
    return null;
  const href = anchor.href;
  const links = Array.from(
    row.querySelectorAll<HTMLAnchorElement>("a[data-published-link]"),
  );
  const occurrence = links.filter((link) => link.href === href).indexOf(anchor);
  if (occurrence < 0) return null;
  return {
    teamId: scope.teamId,
    channelId: scope.channelId,
    rootId,
    postId: row.dataset.postId,
    link: { href, occurrence },
    reading,
    collection: scope.collection,
  };
}

type Account = Parameters<typeof inspectPostTarget>[0];
export type PublishedReadingProposal = {
  serverUrl: string;
  userId: string;
  sourceTeam: string;
  signal: AbortSignal;
  shown: () => void;
};

export function createPublishedReadingHistory(account: Account) {
  const entries: { origin: PublishedReadingOrigin }[] = [];
  let active = new AbortController();
  let closed = false;
  function interrupt() {
    const previous = active;
    if (!closed) active = new AbortController();
    previous.abort();
  }
  return {
    capture(
      origin: PublishedReadingOrigin,
      owner: Pick<PublishedReadingProposal, "serverUrl" | "userId">,
    ): PublishedReadingProposal {
      const { signal } = active;
      let committed = false;
      return {
        ...owner,
        sourceTeam: origin.teamId,
        signal,
        shown() {
          if (committed || signal.aborted) return;
          committed = true;
          entries.push({ origin });
        },
      };
    },
    interrupt,
    hasPrevious: () => entries.length > 0,
    close() {
      closed = true;
      interrupt();
      entries.length = 0;
    },
    async prepareReturn(caller: AbortSignal) {
      const entry = entries.at(-1);
      if (!entry) return { kind: "empty" } as const;
      const { origin } = entry;
      const signal = AbortSignal.any([caller, active.signal]);
      const current = () => !signal.aborted && entries.at(-1) === entry;
      const unavailable = () => {
        if (!current()) return { kind: "cancelled" } as const;
        entries.pop();
        return { kind: "unavailable" } as const;
      };
      try {
        const target = await inspectPostTarget(
          account,
          { kind: "post", id: origin.postId },
          origin.teamId,
          signal,
        );
        if (!current()) return { kind: "cancelled" } as const;
        if (
          target.kind !== "ready" ||
          target.post.id !== origin.postId ||
          target.teamId !== origin.teamId ||
          target.channelId !== origin.channelId ||
          (origin.rootId !== null &&
            (target.post.rootId ?? target.post.id) !== origin.rootId)
        )
          return unavailable();
        if (origin.rootId && origin.rootId !== origin.postId) {
          const root = await account.readPostAnchor(origin.rootId, signal);
          if (!current()) return { kind: "cancelled" } as const;
          if (
            !root.post ||
            root.post.id !== origin.rootId ||
            root.post.channelId !== origin.channelId ||
            root.post.rootId
          )
            return unavailable();
        }
        return {
          kind: "ready",
          origin,
          post: target.post,
          commit() {
            if (!current()) return false;
            entries.pop();
            return true;
          },
        } as const;
      } catch (error) {
        if (!current() || error instanceof PostObservationSuperseded)
          return { kind: "cancelled" } as const;
        const reason = workspaceFailure(error, "network");
        if (reason === "session") return { kind: "cancelled" } as const;
        return reason === "forbidden"
          ? unavailable()
          : ({ kind: "failed", reason } as const);
      }
    },
  };
}
