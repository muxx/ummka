import { type ReactNode, useMemo } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import { PostBodyDisclosure } from "./PostBodyDisclosure.tsx";
import { PublishedAttachments } from "./PublishedAttachments.tsx";
import { PublishedPostActions } from "./PublishedPostActions.tsx";
import { PublishedPostBody, PublishedPostCards } from "./PublishedPostBody.tsx";
import { initials } from "./profile-initials.ts";
import { useTimelinePostTouchLayout } from "./timeline-post-touch.ts";
import "./grouped-posts.css";

const copy = {
  en: {
    unknown: "Unknown user",
    today: "today",
    edited: "edited",
    pinned: "Pinned",
    important: "Important",
    urgent: "Urgent",
    bot: "Bot",
    open: "Open thread",
    replies: { one: "reply", few: "replies", other: "replies" },
    last: "Last reply",
  },
  ru: {
    unknown: "Неизвестный пользователь",
    today: "сегодня",
    edited: "изменено",
    pinned: "Закреплено",
    important: "Важно",
    urgent: "Срочно",
    bot: "Бот",
    open: "Открыть тред",
    replies: { one: "ответ", few: "ответа", other: "ответов" },
    last: "Последний ответ",
  },
} as const;
const plurals = {
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};
export function useTimelinePostFormat(
  locale: EntryLanguage,
  timeZone?: string,
) {
  const touch = useTimelinePostTouchLayout();
  const format = useMemo(
    () => ({
      clock: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }),
      date: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        timeZone,
      }),
      dayKey: new Intl.DateTimeFormat("sv-SE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone,
      }),
    }),
    [locale, timeZone],
  );
  return { ...format, today: touch ? format.dayKey.format(Date.now()) : null };
}

export type TimelineAuthor = (
  id: string,
) => { name: string; avatar?: ReactNode; isBot?: boolean } | undefined;

type ThreadSummary = NonNullable<LocalPost["threadSummary"]>;

export function formatReplyCount(count: number, locale: EntryLanguage) {
  const form = plurals[locale].select(count);
  return `${count} ${copy[locale].replies[form === "one" || form === "few" ? form : "other"]}`;
}

function ReplyCount({
  summary,
  locale,
  time,
  author,
  open,
  expanded,
}: {
  summary: ThreadSummary;
  locale: EntryLanguage;
  time: Intl.DateTimeFormat;
  author: TimelineAuthor;
  open: () => void;
  expanded: boolean;
}) {
  const text = copy[locale];
  const count = formatReplyCount(summary.replyCount, locale);
  const when = new Date(summary.lastReplyAt);
  const last =
    summary.lastReplyAt > 0 && Number.isFinite(when.getTime())
      ? time.format(when)
      : null;
  const participants = Array.from(
    new Set(summary.participantIds?.slice(0, 3)),
  ).flatMap((id) => {
    const person = author(id);
    return person
      ? [
          <span className="timeline-avatar" key={id}>
            {person.avatar ?? initials(person.name)}
          </span>,
        ]
      : [];
  });
  return (
    <button
      type="button"
      className="timeline-thread-count"
      aria-label={[`${text.open}, ${count}`, last && `${text.last}: ${last}`]
        .filter(Boolean)
        .join(", ")}
      aria-expanded={expanded}
      onClick={open}
    >
      {participants.length > 0 && (
        <span className="timeline-participants" aria-hidden="true">
          {participants}
        </span>
      )}
      {count}
      {last && <time dateTime={when.toISOString()}>{last}</time>}
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m6 4 4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function TimelinePost({
  post,
  locale,
  time,
  menuDate,
  author,
  ownName,
  focusable,
  addressed,
  continuation = false,
  inThread,
  collapsedThreads,
  onOpenThread,
  expanded = false,
  children,
}: {
  post: TimelineMessage;
  locale: EntryLanguage;
  time: Intl.DateTimeFormat;
  menuDate?: Pick<
    ReturnType<typeof useTimelinePostFormat>,
    "date" | "dayKey" | "today"
  >;
  author: TimelineAuthor;
  ownName?: string;
  focusable?: boolean;
  addressed?: boolean;
  continuation?: boolean;
  inThread?: boolean;
  collapsedThreads?: boolean;
  onOpenThread?: (post: LocalPost) => void;
  expanded?: boolean;
  children?: ReactNode;
}) {
  const text = copy[locale];
  const person = author(post.userId);
  const name = person?.name || (post.outgoing && ownName) || text.unknown;
  const avatar =
    person?.avatar ??
    (person?.name || (post.outgoing && ownName) ? initials(name) : "•");
  const when = new Date(post.createAt);
  const stamp = Number.isFinite(when.getTime()) && {
    dateTime: when.toISOString(),
    label: time.format(when),
  };
  const priority = post.outgoing ? undefined : post.displayPriority;
  const open =
    !post.outgoing && onOpenThread ? () => onOpenThread(post) : undefined;
  const summary =
    !post.outgoing && !post.rootId && collapsedThreads
      ? post.threadSummary
      : undefined;
  const showCount = Boolean(summary && summary.replyCount > 0);
  const attachments = !post.outgoing && post.attachments;
  const hasAttachments =
    attachments &&
    (attachments.fileIds?.length ||
      attachments.files?.length ||
      attachments.redactedFileCount);
  return (
    <article
      className="timeline-post"
      data-post-id={post.id}
      data-post-version={
        !post.outgoing && post.cards?.length ? post.updateAt : undefined
      }
      data-navigation-target={addressed || undefined}
      data-continuation={continuation || undefined}
      data-local-id={post.localId}
      data-outgoing={post.outgoing ? "" : undefined}
      tabIndex={focusable || post.outgoing || hasAttachments ? -1 : undefined}
    >
      {continuation ? (
        stamp && (
          <time
            className="timeline-continuation-time"
            dateTime={stamp.dateTime}
          >
            {stamp.label}
          </time>
        )
      ) : (
        <div className="timeline-avatar" aria-hidden="true">
          {avatar}
        </div>
      )}
      <div className="timeline-post-body">
        <header>
          <strong
            className={
              continuation ? "timeline-continuation-author" : undefined
            }
          >
            {name}
          </strong>
          {person?.isBot && !continuation && (
            <span className="timeline-bot">{text.bot}</span>
          )}
          {!continuation && stamp && (
            <time dateTime={stamp.dateTime}>{stamp.label}</time>
          )}
          {post.editAt > 0 && (
            <small className="timeline-edited">{text.edited}</small>
          )}
          {!continuation && post.isPinned && (
            <span className="timeline-pin">{text.pinned}</span>
          )}
          {!post.outgoing && (
            <div className="timeline-post-tools">
              {open && !showCount && (
                <button
                  type="button"
                  className="timeline-open-thread"
                  aria-label={text.open}
                  title={text.open}
                  aria-expanded={expanded}
                  onClick={open}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H10l-6 2 1.6-5.3A8.5 8.5 0 1 1 21 11.5Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              <PublishedPostActions
                post={post}
                author={name}
                avatar={avatar}
                language={locale}
                openThread={inThread ? undefined : open}
                editedLabel={post.editAt > 0 ? text.edited : undefined}
                postTime={
                  stamp && menuDate?.today
                    ? {
                        ...stamp,
                        dayLabel:
                          menuDate.dayKey.format(when) === menuDate.today
                            ? text.today
                            : menuDate.date.format(when),
                      }
                    : undefined
                }
              />
            </div>
          )}
        </header>
        {continuation && post.isPinned && (
          <span className="timeline-pin">{text.pinned}</span>
        )}
        {(priority === "important" || priority === "urgent") && (
          <div className="timeline-priority">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {priority === "urgent" ? (
                <path d="M13 3v7h6l-8 11v-7H5l8-11Z" />
              ) : (
                <>
                  <path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0" />
                  <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-5.5 8.28" />
                </>
              )}
            </svg>
            {text[priority]}
          </div>
        )}
        {post.outgoing ? (
          <p className="timeline-attempt-text">{post.message}</p>
        ) : (
          <PostBodyDisclosure locale={locale}>
            <PublishedPostBody
              message={post.message}
              locale={locale}
              authorName={name}
              inThread={inThread}
            />
          </PostBodyDisclosure>
        )}
        {!post.outgoing && Boolean(post.cards?.length) && post.cards && (
          <PublishedPostCards
            cards={post.cards}
            locale={locale}
            authorName={name}
            inThread={inThread}
          />
        )}
        {Boolean(hasAttachments) && !post.outgoing && (
          <PublishedAttachments
            post={post}
            authorName={name}
            language={locale}
          />
        )}
        {open && summary && showCount && (
          <ReplyCount
            summary={summary}
            locale={locale}
            time={time}
            author={author}
            open={open}
            expanded={expanded}
          />
        )}
        {children}
      </div>
    </article>
  );
}
