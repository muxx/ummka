import { type ReactNode, useEffect, useEffectEvent, useId } from "react";
import { isAndroid, usesMacOSOverlay } from "../build-platform.ts";
import type { EntryLanguage } from "../entry/language.ts";
import type { MessageNavigation } from "../entry/use-message-navigation.tsx";
import "./published-reading-return.css";

type Notice = NonNullable<MessageNavigation["readingReturn"]>["notice"];
const copy = {
  en: {
    back: "Back to link",
    source: (label: string) => `Back to link: ${label}`,
    busy: "Opening…",
    retry: "Try again",
    offline: "Couldn’t go back: you’re offline",
    failed: "Couldn’t go back to the link",
    unavailable: "Message unavailable",
    edited: "The link is gone because the message was edited",
  },
  ru: {
    back: "К ссылке",
    source: (label: string) => `Вернуться к ссылке: ${label}`,
    busy: "Открываем…",
    retry: "Повторить",
    offline: "Не вернулись: нет связи",
    failed: "Не удалось вернуться к ссылке",
    unavailable: "Сообщение недоступно",
    edited: "Ссылки здесь больше нет: сообщение изменили",
  },
};

export function PublishedReadingStatus({
  notice,
  language,
  id,
}: {
  notice: Notice;
  language: EntryLanguage;
  id?: string;
}) {
  if (!notice || notice === "busy") return null;
  return (
    <span
      id={id}
      role="status"
      tabIndex={-1}
      className="published-reading-status"
      data-retry={notice === "offline" || notice === "failed" || undefined}
    >
      {copy[language][notice]}
    </span>
  );
}

export function PublishedReadingReturn({
  previous,
  source,
  notice,
  language,
  blocked,
  back,
  children,
}: {
  previous: boolean;
  source?: string;
  notice: Notice;
  language: EntryLanguage;
  blocked: boolean;
  back: () => void;
  children?: ReactNode;
}) {
  const text = copy[language];
  const status = useId();
  const shortcut = usesMacOSOverlay ? "Meta+[" : "Alt+ArrowLeft";
  const retry = notice === "offline" || notice === "failed";
  const busy = notice === "busy";
  const run = () => {
    if (!blocked && !busy) back();
  };
  const key = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.shiftKey) return;
    const matches = usesMacOSOverlay
      ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.code === "BracketLeft"
      : event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key === "ArrowLeft";
    if (!matches) return;
    event.preventDefault();
    if (!document.querySelector("dialog[open]")) run();
  });
  useEffect(() => {
    if (!previous || isAndroid) return;
    const handle = (event: KeyboardEvent) => key(event);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [previous]);
  return (
    <div className="collection-result-steps published-reading-return">
      {previous && (
        <>
          <button
            type="button"
            className="collection-step-back published-reading-back"
            aria-label={
              !notice && source
                ? text.source(source.replace(" · ", ", "))
                : undefined
            }
            aria-busy={busy || undefined}
            aria-disabled={blocked || busy || undefined}
            aria-describedby={notice && !busy ? status : undefined}
            aria-keyshortcuts={isAndroid ? undefined : shortcut}
            onClick={run}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M5 12l6 6m-6-6 6-6" />
            </svg>
            {busy ? text.busy : retry ? text.retry : text.back}
          </button>
          {source && <span className="published-reading-source">{source}</span>}
        </>
      )}
      {children}
      <PublishedReadingStatus notice={notice} language={language} id={status} />
    </div>
  );
}
