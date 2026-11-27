import { type ReactNode, useMemo } from "react";
import { isAndroid } from "../build-platform.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import type { TimelineAuthor } from "./TimelinePost.tsx";

type Props = {
  messages: readonly TimelineMessage[];
  locale: string;
  timeZone?: string;
  author: TimelineAuthor;
  boundary?: { index: number; node: ReactNode };
  unknownDate: string;
  children: (post: TimelineMessage, continuation: boolean) => ReactNode;
};

function separatesGroup(post: LocalPost) {
  return (
    post.fromWebhook !== false ||
    post.type.startsWith("system_") ||
    post.type === "burn_on_read"
  );
}

function continues(
  previous: TimelineMessage | undefined,
  post: TimelineMessage,
  author: TimelineAuthor,
) {
  if (
    !previous ||
    previous.outgoing ||
    post.outgoing ||
    previous.channelId !== post.channelId ||
    previous.rootId !== post.rootId ||
    previous.userId !== post.userId ||
    post.createAt < previous.createAt ||
    post.createAt - previous.createAt >= 300_000 ||
    post.editAt > 0 ||
    post.displayPriority !== "standard" ||
    previous.displayPriority === undefined ||
    separatesGroup(previous) ||
    separatesGroup(post)
  )
    return false;
  const before = previous.aiAttribution;
  const current = post.aiAttribution;
  if (
    !before ||
    !current ||
    (isAndroid && author(post.userId)?.isBot !== false)
  )
    return false;
  return current.kind === "none"
    ? before.kind === "none"
    : !current.hasUsername &&
        before.kind === "source" &&
        before.userId === current.userId;
}

export function TimelineDays({
  messages,
  locale,
  timeZone,
  author,
  boundary,
  unknownDate,
  children,
}: Props) {
  const formats = useMemo(
    () => ({
      key: new Intl.DateTimeFormat("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone,
      }),
      full: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone }),
      label: new Intl.DateTimeFormat(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone,
      }),
    }),
    [locale, timeZone],
  );
  type Day = {
    key: string;
    calendar: string;
    full: string;
    label: string;
    iso?: string;
    rows: ReactNode[];
  };
  const days: Day[] = [];
  const occurrences = new Map<string, number>();
  let day: Day | undefined;
  let previous: TimelineMessage | undefined;
  for (const [index, post] of messages.entries()) {
    if (index === boundary?.index) {
      day?.rows.push(boundary.node);
      previous = undefined;
    }
    const date = new Date(post.createAt);
    const valid = Number.isFinite(date.getTime());
    const calendar = valid ? formats.key.format(date) : "unknown";
    if (day?.calendar !== calendar) {
      previous = undefined;
      const full = valid ? formats.full.format(date) : unknownDate;
      const occurrence = occurrences.get(calendar) ?? 0;
      occurrences.set(calendar, occurrence + 1);
      day = {
        key: `${calendar}-${occurrence}`,
        calendar,
        full,
        iso: valid ? date.toISOString() : undefined,
        label: valid ? formats.label.format(date) : unknownDate,
        rows: [],
      };
      days.push(day);
    }
    day.rows.push(children(post, continues(previous, post, author)));
    previous = valid ? post : undefined;
  }
  return (
    <>
      {boundary?.index === 0 && boundary.node}
      {days.map(({ key, full, label, iso, rows }) => (
        <div key={key} className="timeline-day-group">
          <div className="timeline-day">
            {iso ? (
              <time dateTime={iso} title={full}>
                {label}
              </time>
            ) : (
              <span>{label}</span>
            )}
          </div>
          {rows}
        </div>
      ))}
      {boundary &&
        boundary.index > 0 &&
        boundary.index === messages.length &&
        boundary.node}
    </>
  );
}
