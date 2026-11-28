import { useId, useLayoutEffect, useRef } from "react";
import type { ChannelNotifyProps } from "../../vendor/mattermost/index.js";
import type { EntryLanguage } from "../entry/language.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { BookmarkIcon, bookmarkCopy } from "./ChannelBookmarksPanel.tsx";
import { FileIcon, filePanelCopy } from "./ChannelFilesPanel.tsx";
import { collectionCopy } from "./collection-copy.ts";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { CollectionMark } from "./PostCollectionPane.tsx";
import { PublishedPostBody } from "./PublishedPostBody.tsx";
import { type SectionValue, useInfoRead } from "./use-info-read.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import "./channel-information.css";

const labels = {
  ru: {
    open: "Сведения о канале",
    title: "О канале",
    close: "Закрыть сведения о канале",
    name: "Название",
    header: "Заголовок",
    purpose: "Описание",
    members: "Участники",
    notifications: "Уведомления",
    loading: "Загрузка…",
    offline: "Нет связи",
    failed: "Не удалось загрузить",
    retry: "Повторить",
    muted: "Канал приглушён",
    mutedGroup: "Беседа приглушена",
    custom: "Своя настройка канала",
    customGroup: "Своя настройка беседы",
    defaults: "Как в настройках аккаунта",
  },
  en: {
    open: "Channel info",
    title: "About this channel",
    close: "Close channel info",
    name: "Name",
    header: "Header",
    purpose: "Description",
    members: "Members",
    notifications: "Notifications",
    loading: "Loading…",
    offline: "Offline",
    failed: "Couldn’t load",
    retry: "Try again",
    muted: "Channel muted",
    mutedGroup: "Conversation muted",
    custom: "Custom channel setting",
    customGroup: "Custom conversation setting",
    defaults: "Follows your account settings",
  },
};
type Room = TeamSidebar["data"]["channels"][number];
type Props = {
  account: Pick<WorkspaceConnection, "readChannelNotifications">;
  count: ReturnType<typeof useInfoRead<number>>;
  channel: Room;
  name: string;
  language: EntryLanguage;
  online: boolean;
  openPins: () => void;
  openFiles?: () => void;
  openBookmarks: () => void;
  focusRow: "pins" | "members" | "files" | "bookmarks" | undefined;
  openMembers: () => void;
  notifications: ((opener: HTMLButtonElement) => void) | undefined;
  notificationRevision: number;
  denied: () => void;
  close: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
};
function summary(
  p: ChannelNotifyProps,
  group: boolean,
  language: EntryLanguage,
) {
  const t = labels[language];
  if (p.markUnread === "mention") return group ? t.mutedGroup : t.muted;
  const fields = [
    "desktop",
    "push",
    "desktopThreads",
    "pushThreads",
    "ignoreChannelMentions",
    "desktopSound",
    "desktopNotificationSound",
  ] as const;
  const custom =
    p.channelAutoFollowThreads === "on" ||
    fields.some((key) => p[key] !== undefined && p[key] !== "default");
  return custom ? (group ? t.customGroup : t.custom) : t.defaults;
}
export function MembersIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="9" cy="8" r="3.25" />
      <path d="M2 20v-1.5a7 7 0 0 1 14 0V20M16 5a3.25 3.25 0 0 1 0 6M18 14a6 6 0 0 1 4 5.5" />
    </svg>
  );
}

export function HeaderMembersButton({
  language,
  expanded,
  control,
  count,
  onClick,
}: {
  language: EntryLanguage;
  expanded: boolean;
  control: React.RefObject<HTMLButtonElement | null>;
  count: number | null;
  onClick: () => void;
}) {
  const label = labels[language].members;
  return (
    <button
      ref={control}
      type="button"
      className="channels-icon-action channel-member-count"
      aria-expanded={expanded}
      aria-label={count === null ? label : `${label} · ${count}`}
      title={label}
      onClick={onClick}
    >
      <MembersIcon />
      {count !== null && <span>{count}</span>}
    </button>
  );
}
function InformationIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 10.5v6M12 7.5v.25" strokeLinecap="round" />
    </svg>
  );
}
export function ChannelInformationButton({
  language,
  expanded,
  onClick,
  control,
}: {
  language: EntryLanguage;
  expanded: boolean;
  onClick: () => void;
  control: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={control}
      type="button"
      className="channels-icon-action channel-information-trigger"
      title={labels[language].open}
      aria-label={labels[language].open}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <InformationIcon />
    </button>
  );
}
export function ChannelInformationPanel({
  account,
  count,
  channel,
  name,
  language,
  online,
  openPins,
  openFiles,
  openBookmarks,
  focusRow,
  openMembers,
  notifications,
  notificationRevision,
  close,
  sessionIssue,
  denied,
}: Props) {
  const t = labels[language],
    id = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    pins = useRef<HTMLButtonElement>(null),
    bookmarks = useRef<HTMLButtonElement>(null),
    files = useRef<HTMLButtonElement>(null),
    members = useRef<HTMLButtonElement>(null);
  const rule = useInfoRead(
    notifications ? channel.id : null,
    online,
    (s) => account.readChannelNotifications(channel.id, s),
    sessionIssue,
    denied,
    notificationRevision,
  );
  useLayoutEffect(() => {
    const control = focusRow
      ? { members, pins, files, bookmarks }[focusRow]
      : heading;
    (control.current ?? heading.current)?.focus({ preventScroll: true });
  }, [focusRow]);
  function status(v: SectionValue<unknown>) {
    return v.status === "failed" || v.status === "denied"
      ? t.failed
      : v.status === "offline"
        ? t.offline
        : t.loading;
  }
  return (
    <aside
      className="channels-thread channel-information channel-context-pane"
      aria-labelledby={id}
    >
      <header className="channels-pane-head">
        <div className="channels-pane-titles">
          <h2 id={id} ref={heading} tabIndex={-1}>
            <InformationIcon />
            {t.title}
          </h2>
          <p>{name}</p>
        </div>
        <PaneSizeToggle />
        <button
          type="button"
          className="channels-icon-action"
          aria-label={t.close}
          onClick={close}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path className="channel-info-close" d="m6 6 12 12m0-12L6 18" />
            <path className="channel-info-back" d="m11 5-7 7 7 7M4 12h16" />
          </svg>
        </button>
      </header>
      <div className="channel-information-body">
        {[
          [t.name, name],
          [t.header, channel.header],
          [t.purpose, channel.purpose],
        ].map(
          ([title, value]) =>
            value && (
              <section key={title}>
                <h3>{title}</h3>
                {title === t.name ? (
                  <p>{value}</p>
                ) : (
                  <PublishedPostBody
                    message={value}
                    locale={language}
                    authorName={name}
                  />
                )}
              </section>
            ),
        )}
        <button
          type="button"
          className="channel-info-notify"
          ref={members}
          onClick={openMembers}
        >
          <MembersIcon />
          <span>
            <strong>{t.members}</strong>
            <small role="status">
              {count.value.status === "ready"
                ? count.value.value
                : status(count.value)}
            </small>
          </span>
        </button>
        {count.value.status === "failed" && (
          <button type="button" onClick={count.retry}>
            {t.retry}
          </button>
        )}
        <button
          ref={pins}
          type="button"
          className="channel-info-notify"
          onClick={openPins}
        >
          <CollectionMark kind="pins" />
          <strong>{collectionCopy[language].pins}</strong>
        </button>
        {openFiles && (
          <button
            ref={files}
            type="button"
            className="channel-info-notify"
            onClick={openFiles}
          >
            <FileIcon />
            <strong>{filePanelCopy[language].title}</strong>
          </button>
        )}
        <button
          ref={bookmarks}
          type="button"
          className="channel-info-notify"
          onClick={openBookmarks}
        >
          <BookmarkIcon />
          <strong>{bookmarkCopy[language].title}</strong>
        </button>
        {notifications && (
          <>
            <button
              type="button"
              className="channel-info-notify"
              onClick={(event) => notifications(event.currentTarget)}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 9a6 6 0 0 0-12 0c0 7-2.5 7.5-2.5 9h17c0-1.5-2.5-2-2.5-9ZM10 21a2.5 2.5 0 0 0 4 0" />
              </svg>
              <span>
                <strong>{t.notifications}</strong>
                <small>
                  {rule.value.status === "ready"
                    ? summary(
                        rule.value.value.channel,
                        channel.kind === "G",
                        language,
                      )
                    : status(rule.value)}
                </small>
              </span>
            </button>
            {rule.value.status === "failed" && (
              <button type="button" onClick={rule.retry}>
                {t.retry}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
