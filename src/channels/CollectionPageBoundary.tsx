import { type RefObject, useLayoutEffect, useRef } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type CollectionReadingPlace,
  collectionReadingPlace,
  restoreCollectionReadingPlace,
} from "./CollectionScroll.tsx";
import { collectionCopy } from "./collection-copy.ts";

export function CollectionPageBoundary({
  kind,
  direction,
  status,
  usable,
  language,
  list,
  heading,
  load,
}: {
  kind: "all" | "mentions";
  direction: "newer" | "older";
  status?: "available" | "loading" | "network" | "storage" | "none";
  usable: boolean;
  language: EntryLanguage;
  list: RefObject<HTMLElement | null>;
  heading: RefObject<HTMLHeadingElement | null>;
  load: () => void;
}) {
  const block = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const before = useRef<CollectionReadingPlace | null>(null);
  const pending = status === "loading";
  const failed = status === "network" || status === "storage";
  const t = collectionCopy[language];
  const name =
    direction === "newer"
      ? kind === "all"
        ? t.newerSaved
        : t.newerMentions
      : kind === "all"
        ? t.olderSaved
        : t.olderMentions;
  const actionName = name.toLocaleLowerCase(language);
  useLayoutEffect(() => {
    const place = before.current;
    if (!place || pending) return;
    before.current = null;
    if (
      document.activeElement !== block.current &&
      document.activeElement !== document.body
    )
      return;
    const pane = list.current;
    const first = pane?.querySelector<HTMLElement>("[data-collection-post]");
    if (failed || (!first && button.current))
      button.current?.focus({ preventScroll: true });
    else if (!restoreCollectionReadingPlace(pane, place))
      (
        first ??
        pane?.querySelector<HTMLElement>(
          ".panel-state--error h3, .panel-state--empty h3, [data-collection-page]:enabled",
        ) ??
        heading.current
      )?.focus({ preventScroll: true });
  });
  if (!status || status === "none") return null;
  return (
    <div
      className="collection-edge collection-edge--action"
      ref={block}
      tabIndex={-1}
    >
      <span role={failed ? "alert" : "status"}>
        {pending
          ? kind === "all"
            ? t.loadingSaved
            : t.loadingMentions
          : failed
            ? t.pageFailed(
                name,
                status === "storage" ? t.readStorage : t.readNetwork,
              )
            : t.pageUnloaded(name)}
      </span>
      <button
        data-collection-page={direction}
        ref={button}
        type="button"
        className="collection-page-action collection-edge__action"
        aria-label={failed ? t.retryPage(actionName) : t.loadPage(actionName)}
        disabled={!usable || pending}
        data-waiting={pending || undefined}
        onClick={() => {
          if (!list.current) return;
          before.current = collectionReadingPlace(list.current);
          block.current?.focus({ preventScroll: true });
          load();
        }}
      >
        {failed ? t.retry : t.load}
      </button>
    </div>
  );
}
