import type { RefObject } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { PanelRetry, PanelState } from "./PanelState.tsx";
import "./channel-list-state.css";

export const channelListCopy = {
  en: {
    failed: "Couldn’t load the list",
    reason: "Reason: the server didn’t return the list",
    offline: "No connection",
    reconnect: "The list will load when the connection returns",
    loadingMore: "Loading more…",
    failedMore: "Couldn’t load the rest: the server didn’t return the list",
    retry: "Try again",
    retrying: "Trying again…",
    updating: "Updating the list…",
    updateFailed: "Update failed: no response",
    updateAnnouncement:
      "Couldn’t update the list. The server didn’t return the list.",
  },
  ru: {
    failed: "Не загрузилось",
    reason: "Причина: сервер не вернул список",
    offline: "Нет связи",
    reconnect: "Список загрузится, когда связь вернётся",
    loadingMore: "Загружаем ещё…",
    failedMore: "Не загрузили остальное: сервер не вернул список",
    retry: "Повторить",
    retrying: "Повторяем…",
    updating: "Обновляем список…",
    updateFailed: "Не обновились: нет ответа",
    updateAnnouncement: "Список не обновился. Сервер не вернул список.",
  },
};

type Notice = {
  variant: "pending" | "empty" | "error" | "offline" | "stale";
  title?: string;
  message?: string;
};

export function ChannelListStatus({
  notice,
  language,
  edge,
  stateId,
  heading,
  retry,
  announcement,
}: {
  notice: Notice | null;
  language: EntryLanguage;
  edge?: boolean;
  stateId?: string;
  heading: RefObject<HTMLHeadingElement | null>;
  announcement?: string;
  retry?: {
    running: boolean;
    button: RefObject<HTMLButtonElement | null>;
    read: () => void;
  };
}) {
  const t = channelListCopy[language];
  return (
    <>
      <span className="channel-list-announcement" role="status">
        {announcement ||
          (notice && notice.variant !== "pending" && !retry?.running
            ? `${[notice.title, notice.message].filter(Boolean).join(". ")}.`
            : "")}
      </span>
      {notice && (
        <div
          className="channel-list-state"
          data-edge={edge || undefined}
          id={stateId}
        >
          <PanelState
            {...notice}
            titleRef={notice.title ? heading : undefined}
            action={
              retry && (
                <PanelRetry
                  ref={retry.button}
                  aria-busy={retry.running || undefined}
                  aria-disabled={retry.running || undefined}
                  onClick={() => {
                    if (!retry.running) retry.read();
                  }}
                >
                  {retry.running ? t.retrying : t.retry}
                </PanelRetry>
              )
            }
          />
        </div>
      )}
    </>
  );
}

export function channelListError(
  language: EntryLanguage,
  edge: boolean,
): Notice {
  const t = channelListCopy[language];
  return edge
    ? { variant: "stale", message: t.failedMore }
    : { variant: "error", title: t.failed, message: t.reason };
}

export function channelListOffline(language: EntryLanguage): Notice {
  const t = channelListCopy[language];
  return { variant: "offline", title: t.offline, message: t.reconnect };
}
