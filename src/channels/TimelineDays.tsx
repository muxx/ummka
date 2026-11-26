import { type ReactNode, useMemo } from "react";
import type { TimelineMessage } from "./conversation-rows.ts";

type Props = {
  messages: readonly TimelineMessage[];
  locale: string;
  timeZone?: string;
  boundary?: { index: number; node: ReactNode };
  unknownDate: string;
  children: (post: TimelineMessage) => ReactNode;
};

export function TimelineDays({
  messages,
  locale,
  timeZone,
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
  for (const [index, post] of messages.entries()) {
    if (day && index === boundary?.index) day.rows.push(boundary.node);
    const date = new Date(post.createAt);
    const valid = Number.isFinite(date.getTime());
    const calendar = valid ? formats.key.format(date) : "unknown";
    if (day?.calendar !== calendar) {
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
    day.rows.push(children(post));
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
