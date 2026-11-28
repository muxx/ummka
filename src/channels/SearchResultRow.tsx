import { Fragment, useId, useMemo } from "react";
import type { FileInfo } from "../../vendor/mattermost/index.js";
import type { EntryLanguage } from "../entry/language.ts";
import type { ReceivedResultPost } from "../mattermost/received-result-post.ts";
import { initials } from "./profile-initials.ts";
import { searchCopy } from "./search-copy.ts";
import { markedText, searchPostFragment } from "./search-result-text.ts";

const shortDate = {
  en: new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }),
  ru: new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" }),
};

function resultDate(timestamp: number | undefined) {
  const date = new Date(timestamp ?? 0);
  return timestamp && Number.isFinite(date.getTime()) ? date : null;
}

function Highlight({ parts }: { parts: ReturnType<typeof markedText> }) {
  return parts.map((part) =>
    part.match ? (
      <mark key={part.start}>{part.text}</mark>
    ) : (
      <Fragment key={part.start}>{part.text}</Fragment>
    ),
  );
}

const glyphs = {
  member:
    "M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
  file: "M14 3v4a1 1 0 0 0 1 1h4 M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2 M9 9h1 M9 13h6 M9 17h6",
  image:
    "M15 8h.01 M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M3 16l5-5a3 5 0 0 1 4 0l5 5 M14 14l1-1a3 5 0 0 1 4 0l2 2",
  jump: "M7 17 17 7 M7 7h10v10",
};
function ResultIcon({ name }: { name: keyof typeof glyphs }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={glyphs[name]} />
    </svg>
  );
}

type ResultContext = {
  author?: string;
  channel?: string;
  language: EntryLanguage;
};
type Open = (button: HTMLButtonElement) => void;

export function SearchPostResult({
  row,
  author,
  channel,
  language,
  pattern,
  matches,
  online,
  restored,
  open,
}: ResultContext & {
  row: ReceivedResultPost & { id: string };
  pattern: (matches: readonly string[] | undefined) => RegExp | null;
  matches?: readonly string[];
  online: boolean;
  restored: boolean;
  open: Open;
}) {
  const id = useId();
  const text = searchCopy[language];
  const parts = useMemo(
    () => searchPostFragment(row, pattern(matches), language),
    [row, pattern, matches, language],
  );
  const visible = parts.map((part) => part.text).join("") || text.attachment;
  const date = resultDate(row.createAt);
  const where = [channel, row.rootId && text.threadReply]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="search-result-row">
      <button
        type="button"
        className="search-result-card search-open-result"
        data-search-result={row.id}
        aria-current={restored || undefined}
        aria-disabled={!online}
        aria-label={visible}
        aria-describedby={date ? `${id} ${id}-date` : id}
        onClick={(event) => {
          if (online) open(event.currentTarget);
        }}
      >
        <span
          className="search-result-avatar"
          data-known={author ? "" : undefined}
          aria-hidden="true"
        >
          {author ? initials(author) : <ResultIcon name="member" />}
        </span>
        <span className="search-result-main">
          <span id={id}>
            <strong>
              <bdi>{author || text.member}</bdi>
            </strong>
            {where && (
              <small>
                <bdi>{where}</bdi>
              </small>
            )}
          </span>
          <span className="search-result-excerpt" dir="auto">
            {parts.length ? <Highlight parts={parts} /> : visible}
          </span>
        </span>
        {date && (
          <time id={`${id}-date`} dateTime={date.toISOString()}>
            {shortDate[language].format(date)}
          </time>
        )}
      </button>
    </li>
  );
}

export function SearchFileResult({
  row,
  author,
  channel,
  language,
  pattern,
  online,
  restored,
  open,
}: ResultContext & {
  row: Omit<FileInfo, "postId"> & { id: string; postId: string | null };
  pattern: RegExp | null;
  online: boolean;
  restored: boolean;
  open: Open;
}) {
  const id = useId();
  const text = searchCopy[language];
  const name =
    typeof row.name === "string" && row.name.trim() ? row.name : text.unnamed;
  const where = [author, channel].filter(Boolean).join(" · ");
  const date = resultDate(row.createAt);
  return (
    <li
      className="search-result-row search-file-result"
      aria-current={restored || undefined}
    >
      <div className="search-result-card">
        <ResultIcon
          name={
            typeof row.mimeType === "string" &&
            row.mimeType.startsWith("image/")
              ? "image"
              : "file"
          }
        />
        <span className="search-result-main">
          <strong title={name}>
            <bdi>
              <Highlight parts={markedText(name, pattern)} />
            </bdi>
          </strong>
          {where && (
            <small id={id}>
              <bdi>{where}</bdi>
            </small>
          )}
        </span>
        {date && (
          <time id={`${id}-date`} dateTime={date.toISOString()}>
            {shortDate[language].format(date)}
          </time>
        )}
      </div>
      {row.postId && (
        <button
          type="button"
          className="search-file-jump"
          data-search-result={row.id}
          aria-label={text.filePost(name)}
          aria-describedby={
            [where && id, date && `${id}-date`].filter(Boolean).join(" ") ||
            undefined
          }
          title={text.filePost(name)}
          aria-disabled={!online}
          onClick={(event) => {
            if (online) open(event.currentTarget);
          }}
        >
          <ResultIcon name="jump" />
        </button>
      )}
    </li>
  );
}
