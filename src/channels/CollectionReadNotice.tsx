import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { collectionCopy } from "./collection-copy.ts";
import { PanelRetry, PanelState } from "./PanelState.tsx";

export function useCollectionRefreshVisibility(refreshing: boolean) {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    if (!refreshing) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 1000);
    return () => window.clearTimeout(timer);
  }, [refreshing]);
  return refreshing && visible;
}

export function CollectionReadNotice({
  kind,
  status,
  hasResponse,
  showRefresh,
  online,
  language,
  list,
  heading,
  refresh,
}: {
  kind: "all" | "pins" | "mentions";
  status: string;
  hasResponse: boolean;
  showRefresh: boolean;
  online: boolean;
  language: EntryLanguage;
  list: RefObject<HTMLElement | null>;
  heading: RefObject<HTMLHeadingElement | null>;
  refresh: () => void;
}) {
  const text = collectionCopy[language];
  const name =
    kind === "all"
      ? text.saved
      : kind === "pins"
        ? text.pinsName
        : text.mentions;
  const loading = status === "loading" || (status === "idle" && online);
  const refreshing = status === "refreshing";
  const failed =
    status === "network" ||
    status === "storage" ||
    status === "unknown" ||
    (status === "idle" && !online);
  const reason =
    status === "storage"
      ? text.readStorage
      : status === "unknown"
        ? ""
        : text.readNetwork;
  const coldFailure =
    kind !== "mentions" && !hasResponse && failed && status !== "storage";
  const pendingText = refreshing
    ? text.updatingList
    : {
        all: text.loadingSaved,
        pins: text.loading,
        mentions: text.loadingMentions,
      }[kind];
  const failureText = hasResponse
    ? text.updateFailed(reason)
    : kind === "pins" && status === "storage"
      ? text.storage
      : text.firstReadFailed(name, reason);
  const notice = useRef<HTMLDivElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const waitingFocus = useRef(false);
  const previous = useRef(status);
  const [announcement, setAnnouncement] = useState("");
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (before === "refreshing" && status === "ready")
      setAnnouncement(text.updated(name));
    else if (before === "refreshing" && hasResponse && failed)
      setAnnouncement(text.updateFailedAnnouncement(name, reason));
    else if (loading || refreshing || !hasResponse) setAnnouncement("");
  }, [name, status, text, hasResponse, failed, loading, reason, refreshing]);
  useLayoutEffect(() => {
    if (!waitingFocus.current || loading || refreshing) return;
    waitingFocus.current = false;
    const active = document.activeElement;
    if (active !== document.body && active !== notice.current) return;
    if (failed) retry.current?.focus({ preventScroll: true });
    else {
      const row = list.current?.querySelector<HTMLButtonElement>(
        "[data-collection-post]",
      );
      (row ?? heading.current)?.focus();
    }
  }, [failed, heading, list, loading, refreshing]);
  return (
    <>
      <span className="collection-announcement" role="status">
        {announcement}
      </span>
      {(loading || refreshing || failed) && (
        <PanelState
          variant={
            failed
              ? hasResponse
                ? "stale"
                : online
                  ? "error"
                  : "offline"
              : refreshing
                ? "refresh"
                : "pending"
          }
          ref={notice}
          quiet={refreshing && !showRefresh}
          role={
            coldFailure || (failed && hasResponse)
              ? undefined
              : failed
                ? "alert"
                : "status"
          }
          title={coldFailure ? text.firstReadAnnouncement(name, "") : undefined}
          message={
            coldFailure
              ? reason
                ? text.offlineCold
                : text.serverList
              : failed
                ? failureText
                : refreshing && !showRefresh
                  ? ""
                  : pendingText
          }
          action={
            failed && (
              <PanelRetry
                ref={retry}
                data-collection-retry=""
                aria-label={hasResponse ? text.retryUpdate(name) : text.retry}
                onClick={() => {
                  waitingFocus.current = hasResponse;
                  (hasResponse ? notice.current : heading.current)?.focus({
                    preventScroll: true,
                  });
                  refresh();
                }}
              >
                {text.retry}
              </PanelRetry>
            )
          }
        />
      )}
      {coldFailure && (
        <span className="collection-announcement" role="alert">
          {text.firstReadAnnouncement(name, reason)}
        </span>
      )}
    </>
  );
}
