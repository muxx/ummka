import type { Ref } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import type { HistoryPageFailure } from "./workspace-data.ts";
import "./history-page-edge.css";

const copy = {
  en: {
    offline: "no connection",
    server: "the server didn’t return the page",
    unknown: "",
  },
  ru: {
    offline: "нет связи",
    server: "сервер не вернул страницу",
    unknown: "",
  },
};

export function historyPageError(
  locale: EntryLanguage,
  description: string,
  reason: HistoryPageFailure,
) {
  const cause = copy[locale][reason];
  return cause ? `${description}: ${cause}` : `${description}.`;
}

export function HistoryPageEdge({
  marker,
  direction,
  locale,
  description,
  loading = false,
  failed = false,
  action,
}: {
  marker?: Ref<HTMLDivElement>;
  direction: "older" | "newer" | "up" | "down";
  locale: EntryLanguage;
  description?: string;
  loading?: boolean;
  failed?: boolean;
  action?: { label: string; run: () => void; disabled?: boolean };
}) {
  const channel = direction === "older" || direction === "newer";
  const retry = workspaceCopy[locale].retry;
  const label = failed ? retry : action?.label;
  return (
    <div
      ref={marker}
      className={`history-page-edge${channel ? " history-page-edge--channel" : ""}`}
      data-channel-edge={channel ? direction : undefined}
      data-thread-edge={channel ? undefined : direction}
      data-loading={loading || undefined}
      data-failed={failed || undefined}
      tabIndex={-1}
    >
      <span className="history-page-edge__caption" role="status">
        {description}
      </span>
      {action && !loading && (
        <button
          className="history-page-edge__action"
          type="button"
          aria-label={description ? `${description} ${label}` : undefined}
          disabled={action.disabled}
          onClick={(event) => {
            if (
              event.detail === 0 ||
              event.currentTarget === document.activeElement
            )
              event.currentTarget.parentElement?.focus({ preventScroll: true });
            action.run();
          }}
        >
          {label}
        </button>
      )}
    </div>
  );
}
