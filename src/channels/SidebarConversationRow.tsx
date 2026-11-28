import type { EntryLanguage } from "../entry/language.ts";
import type { conversationRow } from "../mattermost/sidebar-rows.ts";
import { channelKindIconPaths } from "./channel-kind-icon-paths.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import "./sidebar-conversation-row.css";

const icons = {
  ...channelKindIconPaths,
  muted:
    "M9.346 5.353c.21-.129.428-.246.654-.353a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3m-1 3H4a4 4 0 0 0 2-3v-3a6.996 6.996 0 0 1 1.273-3.707 M9 17v1a3 3 0 0 0 6 0v-1 M3 3l18 18",
};

function RowIcon({
  name,
  title,
}: {
  name: keyof typeof icons;
  title?: string;
}) {
  return (
    <svg
      className="sidebar-conversation-row__icon"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {title && <title>{title}</title>}
      <path d={icons[name]} />
    </svg>
  );
}

export function SidebarConversationRow({
  row,
  language,
  choose,
}: {
  row: ReturnType<typeof conversationRow>;
  language: EntryLanguage;
  choose: (id: string) => void;
}) {
  const text = workspaceCopy[language];
  const hasMentions = row.mentions > 0;
  const activity = hasMentions
    ? text.formatMentions(row.mentions)
    : row.unread
      ? text.unread
      : "";
  const name = [
    row.title,
    row.archived && text.archived,
    row.muted && text.muted,
    activity,
  ]
    .filter(Boolean)
    .join(" ");
  const [initial = ""] = row.displayName.trim();

  return (
    <button
      className="sidebar-conversation-row"
      type="button"
      aria-label={name}
      aria-description={row.kind === "P" ? text.privateChannel : undefined}
      aria-current={row.current ? "page" : undefined}
      data-surface={row.current ? "selected-navigation" : undefined}
      data-unread={row.unread || undefined}
      onClick={() => choose(row.id)}
    >
      {row.archived ? (
        <RowIcon name="archive" title={text.archived} />
      ) : row.kind === "D" ? (
        <span className="sidebar-conversation-row__initial" aria-hidden="true">
          {initial.toLocaleUpperCase(language)}
        </span>
      ) : (
        <RowIcon
          name={row.kind === "P" ? "lock" : row.kind === "G" ? "group" : "hash"}
        />
      )}
      <span className="sidebar-conversation-row__label" title={row.title}>
        {row.title}
      </span>
      {row.muted && <RowIcon name="muted" title={text.muted} />}
      {hasMentions ? (
        <span className="sidebar-conversation-row__count" aria-hidden="true">
          {row.mentions}
        </span>
      ) : (
        row.unread && (
          <span className="sidebar-conversation-row__dot" aria-hidden="true" />
        )
      )}
    </button>
  );
}
