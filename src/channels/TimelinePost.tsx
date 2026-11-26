import type { ReactNode } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";

const copy = {
  en: {
    unknown: "Unknown user",
    edited: "edited",
    pinned: "Pinned",
    open: "Open thread",
    replies: { one: "reply", few: "replies", other: "replies" },
    last: "Last reply",
  },
  ru: {
    unknown: "Неизвестный пользователь",
    edited: "изменено",
    pinned: "Закреплено",
    open: "Открыть тред",
    replies: { one: "ответ", few: "ответа", other: "ответов" },
    last: "Последний ответ",
  },
} as const;
const plurals = {
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};

export type TimelineAuthor = (
  id: string,
) => { name: string; avatar?: ReactNode } | undefined;

function initials(name: string) {
  const words = name.trim().split(/\s+/u);
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toLocaleUpperCase();
}

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
  author,
  ownName,
  focusable,
  highlighted,
  collapsedThreads,
  onOpenThread,
  expanded = false,
  children,
}: {
  post: TimelineMessage;
  locale: EntryLanguage;
  time: Intl.DateTimeFormat;
  author: TimelineAuthor;
  ownName?: string;
  focusable?: boolean;
  highlighted?: boolean;
  collapsedThreads?: boolean;
  onOpenThread?: (post: LocalPost) => void;
  expanded?: boolean;
  children?: ReactNode;
}) {
  const text = copy[locale];
  const person = author(post.userId);
  const name = person?.name || (post.outgoing && ownName) || text.unknown;
  const when = new Date(post.createAt);
  const open =
    !post.outgoing && onOpenThread ? () => onOpenThread(post) : undefined;
  const summary =
    !post.outgoing && !post.rootId && collapsedThreads
      ? post.threadSummary
      : undefined;
  const showCount = Boolean(summary && summary.replyCount > 0);
  return (
    <article
      className="timeline-post"
      data-post-id={post.id}
      data-navigation-target={highlighted || undefined}
      data-local-id={post.localId}
      data-outgoing={post.outgoing ? "" : undefined}
      tabIndex={focusable || post.outgoing ? -1 : undefined}
    >
      <div className="timeline-avatar" aria-hidden="true">
        {person?.avatar ??
          (person?.name || (post.outgoing && ownName) ? initials(name) : "•")}
      </div>
      <div className="timeline-post-body">
        <header>
          <strong>{name}</strong>
          {Number.isFinite(when.getTime()) && (
            <time dateTime={when.toISOString()}>{time.format(when)}</time>
          )}
          {post.isPinned && <span className="timeline-pin">{text.pinned}</span>}
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
        </header>
        <p>
          {post.message}
          {post.editAt > 0 && (
            <small className="timeline-edited"> ({text.edited})</small>
          )}
        </p>
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
