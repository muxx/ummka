import type { SavedCollectionOrigin } from "../entry/use-message-navigation.tsx";
import type { IntegrationCard } from "../mattermost/integration-cards.ts";
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
    offsetInPost?: number;
    expanded?: true;
    card?: CardLinkOrigin;
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

type CardLinkOrigin = {
  identity: string;
  detail?: string;
  part: string;
  label: string;
  count: number;
  ambiguous: boolean;
};

const renderedCards = new WeakMap<HTMLElement, IntegrationCard>();

export function registerPublishedCard(
  node: HTMLElement,
  card: IntegrationCard,
) {
  renderedCards.set(node, card);
}

function cardIdentity(card: IntegrationCard) {
  return [card.title?.trim(), card.authorName?.trim(), card.pretext?.trim()];
}

function cardDetail(card: IntegrationCard) {
  return JSON.stringify([
    card.titleLink,
    card.authorLink,
    card.color,
    card.text,
    card.fields.map((field) => [field.title, field.value, field.short]),
    card.footer,
  ]);
}

function cardMatches(
  row: HTMLElement,
  { identity, detail }: Pick<CardLinkOrigin, "identity" | "detail">,
) {
  return Array.from(
    row.querySelectorAll<HTMLElement>("[data-published-card]"),
  ).filter((node) => {
    const card = renderedCards.get(node);
    return (
      card &&
      JSON.stringify(cardIdentity(card)) === identity &&
      (detail === undefined || cardDetail(card) === detail)
    );
  });
}

function cardLinkMatches(
  card: HTMLElement,
  address: Pick<CardLinkOrigin, "part" | "label">,
  href: string,
) {
  const section = card.querySelector(
    `[data-published-card-part="${CSS.escape(address.part)}"]`,
  );
  return section
    ? Array.from(
        section.querySelectorAll<HTMLAnchorElement>("a[data-published-link]"),
      ).filter(
        (link) =>
          link.href === href && link.textContent?.trim() === address.label,
      )
    : [];
}

function postLinkMatches(row: HTMLElement, href: string) {
  return Array.from(
    row.querySelectorAll<HTMLAnchorElement>("a[data-published-link]"),
  ).filter(
    (link) => link.href === href && !link.closest("[data-published-card]"),
  );
}

export type PublishedLinkLanding = "edited" | "unmatchedLink";

export function publishedOriginLink(
  row: HTMLElement,
  address: PublishedReadingOrigin["link"],
): { link: HTMLAnchorElement } | { notice: PublishedLinkLanding } {
  const { card, href, occurrence } = address;
  if (!card) {
    const link = postLinkMatches(row, href)[occurrence];
    return link ? { link } : { notice: "edited" };
  }
  function unconfirmed(): { notice: PublishedLinkLanding } {
    const sameLink = Array.from(
      row.querySelectorAll<HTMLAnchorElement>("a[data-published-link]"),
    ).some(
      (link) => link.href === href && link.textContent?.trim() === card?.label,
    );
    return { notice: sameLink ? "unmatchedLink" : "edited" };
  }
  const matches = cardMatches(row, card);
  if (card.ambiguous || matches.length !== 1) return unconfirmed();
  const links = cardLinkMatches(matches[0], card, href);
  if (links.length !== card.count) return unconfirmed();
  return { link: links[occurrence] };
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
  const cardNode = anchor.closest<HTMLElement>("[data-published-card]");
  const data = cardNode && renderedCards.get(cardNode);
  const part = anchor.closest<HTMLElement>("[data-published-card-part]")
    ?.dataset.publishedCardPart;
  let card: CardLinkOrigin | undefined;
  let occurrence: number;
  if (cardNode && data && part) {
    const heading = cardIdentity(data);
    const identity = JSON.stringify(heading);
    // Mattermost sends no stable card identifier. Prefer its authored heading
    // when it identifies one report, and fingerprint the text when necessary.
    const detail =
      !heading.some(Boolean) || cardMatches(row, { identity }).length > 1
        ? cardDetail(data)
        : undefined;
    const label = anchor.textContent?.trim() ?? "";
    const links = cardLinkMatches(cardNode, { part, label }, href);
    card = {
      identity,
      detail,
      part,
      label,
      count: links.length,
      ambiguous: cardMatches(row, { identity, detail }).length !== 1,
    };
    occurrence = links.indexOf(anchor);
  } else {
    occurrence = postLinkMatches(row, href).indexOf(anchor);
  }
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
      offsetInPost: link.top - row.getBoundingClientRect().top,
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
