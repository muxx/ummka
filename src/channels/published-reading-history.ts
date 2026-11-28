import type { SavedCollectionOrigin } from "../entry/use-message-navigation.tsx";
import type { LocalPost } from "../mattermost/local-history.ts";
import { PostObservationSuperseded } from "../mattermost/message-anchors.ts";
import { inspectPostTarget } from "./inspect-post-target.ts";
import type { ThreadInboxPlace } from "./thread-inbox.ts";
import { measureTimeline, type TimelinePlace } from "./timeline-viewport.ts";
import type { RowOrigin } from "./use-workspace-collections.ts";
import { workspaceFailure } from "./workspace-data.ts";

export type PublishedReadingOrigin = {
  teamId: string;
  channelId: string;
  rootId: string | null;
  postId: string;
  link: {
    href: string;
    occurrence: number;
    expanded?: true;
    card?: { index: string; part: string; label: string };
  };
  reading: TimelinePlace;
  label?: string;
  inbox?: {
    channelId: string | null;
    reading: TimelinePlace | null;
    list: ThreadInboxPlace;
  };
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
  "teamId" | "collection" | "inbox"
> & {
  channelId?: string;
  threadRootId: string | null;
  threadChannelId?: string;
  label?: string;
  threadLabel?: string;
};

function publishedLinkMatches(
  row: HTMLElement,
  address: Pick<PublishedReadingOrigin["link"], "href" | "card">,
) {
  const { href, card } = address;
  const section = card
    ? row
        .querySelector(`[data-published-card="${CSS.escape(card.index)}"]`)
        ?.querySelector(`[data-published-card-part="${CSS.escape(card.part)}"]`)
    : row;
  if (!section) return [];
  return Array.from(
    section.querySelectorAll<HTMLAnchorElement>("a[data-published-link]"),
  ).filter(
    (link) =>
      link.href === href &&
      (card
        ? link.textContent?.trim() === card.label
        : !link.closest("[data-published-card]")),
  );
}

export function publishedOriginLink(
  row: HTMLElement,
  address: PublishedReadingOrigin["link"],
) {
  return publishedLinkMatches(row, address)[address.occurrence];
}

export function capturePublishedReadingOrigin(
  anchor: HTMLAnchorElement,
  scope: ReadingScope,
): PublishedReadingOrigin | null {
  const row = anchor.closest<HTMLElement>("[data-post-id]");
  const pane = row?.closest<HTMLElement>(".timeline-scroll");
  if (!row?.dataset.postId || !pane || anchor.closest("[hidden], [inert]"))
    return null;
  const inThread = pane.matches(".thread-feed");
  const rootId = inThread ? scope.threadRootId : null;
  const channelId = inThread ? scope.threadChannelId : scope.channelId;
  if (!channelId || (inThread && rootId === null)) return null;
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
  const cardIndex = anchor.closest<HTMLElement>("[data-published-card]")
    ?.dataset.publishedCard;
  const cardPart = anchor.closest<HTMLElement>("[data-published-card-part]")
    ?.dataset.publishedCardPart;
  const card =
    cardIndex !== undefined && cardPart
      ? {
          index: cardIndex,
          part: cardPart,
          label: anchor.textContent?.trim() ?? "",
        }
      : undefined;
  const occurrence = publishedLinkMatches(row, { href, card }).indexOf(anchor);
  if (occurrence < 0) return null;
  const label = inThread ? scope.threadLabel : scope.label;
  const description =
    label &&
    [
      label,
      [
        row.querySelector("header strong")?.textContent,
        row.querySelector("time")?.textContent,
      ]
        .filter(Boolean)
        .join(", "),
    ]
      .filter(Boolean)
      .join(" · ");
  return {
    teamId: scope.teamId,
    channelId,
    rootId,
    postId: row.dataset.postId,
    link: {
      href,
      occurrence,
      ...(card && { card }),
      ...(anchor
        .closest("[data-published-disclosure]")
        ?.querySelector(
          "[data-published-disclosure-action][aria-expanded=true]",
        ) && {
        expanded: true,
      }),
    },
    reading,
    ...(description && { label: description }),
    collection: scope.collection,
    ...(inThread && scope.inbox && { inbox: scope.inbox }),
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

export function savedReadingSource(origin: PublishedReadingOrigin) {
  const { collection } = origin;
  if (collection?.kind === "saved-team") return collection;
  if (collection?.kind !== "workspace" || collection.source.kind !== "all")
    return;
  const { row } = collection;
  return {
    postId: row.id,
    source: {
      teamId: origin.teamId,
      channelId: row.channelId,
      index: row.ids.indexOf(row.id),
      scroll: row.scroll,
      offset: row.offset,
      reading: row.reading,
    },
  };
}

export function createPublishedReadingHistory(account: Account) {
  const entries: { origin: PublishedReadingOrigin }[] = [];
  const listeners = new Set<() => void>();
  let active = new AbortController();
  let closed = false;
  function interrupt() {
    const previous = active;
    if (!closed) active = new AbortController();
    previous.abort();
  }
  function publish() {
    for (const listener of listeners) listener();
  }
  function clear() {
    interrupt();
    entries.length = 0;
    publish();
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => entries.at(-1)?.origin,
    savedSource: () =>
      entries.map(({ origin }) => savedReadingSource(origin)).find(Boolean),
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
          publish();
        },
      };
    },
    interrupt,
    clear,
    hasPrevious: () => entries.length > 0,
    close() {
      closed = true;
      clear();
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
        publish();
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
        let threadRoot: LocalPost | undefined;
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
          threadRoot = root.post;
        } else if (origin.rootId) {
          threadRoot = target.post;
        }
        return {
          kind: "ready",
          origin,
          post: target.post,
          threadRoot,
          signal,
          commit() {
            if (!current()) return false;
            entries.pop();
            publish();
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
