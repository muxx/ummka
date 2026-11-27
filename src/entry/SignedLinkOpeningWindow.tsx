import { useLayoutEffect, useRef } from "react";
import { isMobile } from "../build-platform";
import { EntryWindow } from "./EntryWindow";
import {
  EntryActionIssue,
  EntryInstallationPlate,
  EntryRetryMark,
} from "./FirstTeamChoice";
import type { EntryLanguage } from "./language";
import type { SignedLinkOpening } from "./use-system-permalink";

const copy = {
  ru: {
    title: "Открываем сообщение",
    lead: "Вход выполнен. Сообщение откроется, как только сервер ответит, где оно.",
    waiting: "Ждём ответа сервера",
    failed: "Сообщение не открыто",
    offline: "Причина: нет связи. Вход сохранён, ссылка ждёт.",
    failure:
      "Не удалось получить ответ о сообщении. Вход сохранён, ссылка ждёт.",
    retry: "Повторить",
    dismiss: "Не открывать ссылку",
  },
  en: {
    title: "Opening the message",
    lead: "You’re signed in. The message will open when the server responds with its location.",
    waiting: "Waiting for the server",
    failed: "The message couldn’t open",
    offline: "You’re offline. Your sign-in is saved and the link is waiting.",
    failure:
      "Couldn’t get a response about the message. Your sign-in is saved and the link is waiting.",
    retry: "Retry",
    dismiss: "Don’t open this link",
  },
};

export function SignedLinkOpeningWindow({
  opening,
  language,
  siteName,
}: {
  opening: SignedLinkOpening;
  language: EntryLanguage;
  siteName?: string;
}) {
  const text = copy[language];
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const waiting = opening.status === "waiting";
  useLayoutEffect(() => {
    const useHeading = waiting || isMobile;
    (useHeading ? heading : retry).current?.focus({
      preventScroll: useHeading,
    });
  }, [waiting]);

  return (
    <EntryWindow>
      <EntryInstallationPlate
        serverUrl={opening.serverUrl}
        siteName={siteName}
      />
      <div className="entry-first-teams entry-signed-link-opening">
        {!waiting && (
          <EntryActionIssue
            title={text.failed}
            detail={[
              opening.membership,
              opening.status === "offline" ? text.offline : text.failure,
            ]
              .filter(Boolean)
              .join(" ")}
            retry={
              <button
                ref={retry}
                type="button"
                className="entry-secondary entry-team-error-retry"
                onClick={opening.retry}
              >
                <EntryRetryMark />
                {text.retry}
              </button>
            }
          />
        )}
        <h1 ref={heading} tabIndex={-1}>
          {text.title}
        </h1>
        <p className="entry-first-team-lead">{text.lead}</p>
        <p role="status" className="entry-team-wait">
          {waiting && text.waiting}
        </p>
        <div className="entry-empty-team-actions">
          <button
            type="button"
            className="entry-secondary entry-team-check"
            onClick={opening.dismiss}
          >
            {text.dismiss}
          </button>
        </div>
      </div>
    </EntryWindow>
  );
}
