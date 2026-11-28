import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  ChannelListStatus,
  channelListCopy,
  channelListError,
  channelListOffline,
} from "./ChannelListState.tsx";
import { useCollectionRefreshVisibility } from "./CollectionReadNotice.tsx";
import type { useChannelListPages } from "./use-channel-list-pages.ts";
import { useNextPageButton } from "./use-next-page-button.ts";

export function useChannelListControls<Row>({
  reading,
  scroll,
  heading,
  search,
  hidden,
  online,
  language,
  copy,
  stateId,
  empty,
}: {
  reading: ReturnType<typeof useChannelListPages<Row>>;
  scroll: RefObject<HTMLElement | null>;
  heading: RefObject<HTMLHeadingElement | null>;
  search?: RefObject<HTMLInputElement | null>;
  hidden?: boolean;
  online: boolean;
  language: EntryLanguage;
  copy: { more: string; loading: string; denied: string };
  stateId?: string;
  empty: { title: string; message?: string };
}) {
  const { state, rows, before, next, acrossBefore, rechecking, readingMore } =
    reading;
  const { status } = state;
  const t = channelListCopy[language];
  const loading = online && status === "loading";
  const failed = status === "failed";
  const warm = online && rechecking && (loading || failed);
  const edge = online && readingMore && (loading || failed);
  const above = edge && acrossBefore;
  const enough = status === "ready" && online && !hidden;
  const [retrying, setRetrying] = useState(false);
  const keepFocus = useRef<number | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const headerRetry = useRef<HTMLButtonElement>(null);
  const noticeHeading = useRef<HTMLHeadingElement>(null);
  function more(page: number, button: HTMLButtonElement) {
    if (button === document.activeElement)
      keepFocus.current = page === before ? 0 : rows.length;
    reading.more(page);
  }
  const first = useNextPageButton(enough ? before : null, more, true);
  const last = useNextPageButton(enough ? next : null, more);
  useLayoutEffect(() => {
    if (loading || hidden) return;
    const index = keepFocus.current;
    keepFocus.current = null;
    const active = document.activeElement;
    if (retrying) setRetrying(false);
    if (status === "denied") {
      if (
        active === document.body ||
        active === heading.current ||
        active === search?.current
      )
        noticeHeading.current?.focus({ preventScroll: true });
      return;
    }
    if (
      index === null ||
      (active !== document.body &&
        active !== retryButton.current &&
        active !== headerRetry.current &&
        active !== first.current &&
        active !== last.current)
    )
      return;
    const cards = scroll.current?.querySelectorAll<HTMLElement>(
      "[data-channel-list-row]",
    );
    const preferred = state.request.kind === "first" ? search?.current : null;
    const target =
      status === "failed"
        ? warm
          ? headerRetry.current
          : retryButton.current
        : (preferred ??
          cards?.item(index) ??
          noticeHeading.current ??
          last.current ??
          cards?.item(cards.length - 1) ??
          heading.current);
    (target?.querySelector<HTMLElement>("button") ?? target)?.focus({
      preventScroll: true,
    });
  }, [
    first,
    heading,
    hidden,
    last,
    loading,
    retrying,
    scroll,
    search,
    state.request.kind,
    status,
    warm,
  ]);

  const showRefresh = useCollectionRefreshVisibility(warm && loading);
  function repeat(button: HTMLButtonElement | null) {
    if (!button || retrying) return;
    button.focus({ preventScroll: true });
    keepFocus.current = edge && !above ? rows.length : 0;
    setRetrying(true);
    reading.retry();
  }
  const exhausted = !rows.length && next === null && state.pages.length > 0;
  const notice = !online
    ? channelListOffline(language)
    : status === "denied"
      ? { variant: "error" as const, title: copy.denied }
      : !warm && (failed || retrying)
        ? channelListError(language, edge)
        : !warm && loading
          ? {
              variant: "pending" as const,
              message: edge ? t.loadingMore : copy.loading,
            }
          : exhausted
            ? { variant: "empty" as const, ...empty }
            : null;
  const waitingOnBoundary =
    edge && loading && !retrying && keepFocus.current !== null;
  const statusBlock = (
    <ChannelListStatus
      language={language}
      notice={waitingOnBoundary ? null : notice}
      heading={noticeHeading}
      edge={edge}
      stateId={stateId}
      announcement={warm && failed ? t.updateAnnouncement : undefined}
      retry={
        online && !warm && (failed || retrying)
          ? {
              running: retrying,
              button: retryButton,
              read: () => repeat(retryButton.current),
            }
          : undefined
      }
    />
  );
  function button(top: boolean) {
    const page = top ? before : next;
    const currentEdge = edge && top === above;
    const waiting = waitingOnBoundary && currentEdge;
    if ((page === null || currentEdge) && !waiting) return null;
    return (
      <button
        ref={top ? first : last}
        className="channel-list-more"
        type="button"
        aria-busy={waiting || undefined}
        aria-disabled={!enough || waiting || undefined}
        disabled={!enough && !waiting}
        onClick={(event) => {
          if (enough && page !== null) more(page, event.currentTarget);
        }}
      >
        {waiting ? t.loadingMore : copy.more}
      </button>
    );
  }

  const showRetry = warm && (failed || retrying);
  return {
    loading,
    empty: exhausted,
    notice,
    headerStatus: (showRetry || showRefresh) && (
      <>
        <span className="panel-text--secondary">
          {showRetry ? t.updateFailed : t.updating}
        </span>
        {showRetry && (
          <button
            ref={headerRetry}
            type="button"
            aria-busy={retrying || undefined}
            aria-disabled={retrying || undefined}
            onClick={() => repeat(headerRetry.current)}
          >
            {retrying ? t.retrying : t.retry}
          </button>
        )}
      </>
    ),
    top: (
      <>
        {above && statusBlock}
        {button(true)}
      </>
    ),
    bottom: (
      <>
        {!above && statusBlock}
        {button(false)}
      </>
    ),
  };
}
