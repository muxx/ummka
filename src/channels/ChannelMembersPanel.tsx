import { useId, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type NameFormat,
  teammateName,
} from "../mattermost/channel-profiles.ts";
import { MembersIcon } from "./ChannelInformationPanel.tsx";
import { ChannelListPosition } from "./ChannelListPosition.tsx";
import { ChannelSectionHeader } from "./ChannelSectionHeader.tsx";
import type { Member, PageReading } from "./channel-list-reading.ts";
import { initials } from "./profile-initials.ts";
import { useChannelListControls } from "./use-channel-list-controls.tsx";
import { useChannelListPages } from "./use-channel-list-pages.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

const copy = {
  en: {
    title: "Members",
    back: "Back to channel info",
    backToChannel: "Back to conversation",
    close: "Close members",
    search: "Find a member",
    guest: "Guest",
    loading: "Loading members…",
    empty: "No members",
    noMatches: (term: string) => `No members match “${term}”`,
    hint: "Check the spelling or clear the field",
    denied: "No access to channel members",
    more: "Show more members",
  },
  ru: {
    title: "Участники",
    back: "Вернуться к сведениям о канале",
    backToChannel: "Вернуться в беседу",
    close: "Закрыть участников",
    search: "Найти участника",
    guest: "Гость",
    loading: "Загружаем участников…",
    empty: "Участников нет",
    noMatches: (term: string) => `Никого по запросу «${term}»`,
    hint: "Проверьте написание или очистите поле",
    denied: "Нет доступа к участникам",
    more: "Показать ещё участников",
  },
};
type Props = {
  account: Pick<WorkspaceConnection, "readChannelMemberDirectory">;
  channelId: string;
  history?: Map<string, PageReading<Member>>;
  name: string;
  language: EntryLanguage;
  nameFormat: NameFormat;
  online: boolean;
  back?: () => void;
  direct?: boolean;
  close: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
};
const memberId = (row: Member) => row.profile.id;

export function ChannelMembersPanel({
  account,
  channelId,
  history,
  language,
  nameFormat,
  sessionIssue,
  online,
  back,
  close,
  name,
  direct,
}: Props) {
  const [query, setQuery] = useState(
    () => history?.get(channelId)?.query ?? "",
  );
  const term = query.trim();
  const t = copy[language];
  const title = useId();
  const stateId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const reading = useChannelListPages({
    history,
    channelId,
    query: term,
    online,
    id: memberId,
    async load(page, signal) {
      const result = await account.readChannelMemberDirectory(
        channelId,
        term ? { kind: "search", term } : { kind: "page", page },
        signal,
      );
      return { page, rows: result.members, next: result.nextPage };
    },
    sessionIssue,
  });
  const { state, rows } = reading;
  const denied = state.status === "denied";
  if (denied && query) setQuery("");
  const [canFilter, setCanFilter] = useState(Boolean(term || rows.length));
  if ((!online || denied) && canFilter) setCanFilter(false);
  else if (
    online &&
    !denied &&
    !canFilter &&
    (rows.length || (term && state.pages.length))
  )
    setCanFilter(true);
  const fieldLocked = !online || !canFilter;
  const controls = useChannelListControls({
    reading,
    scroll,
    heading,
    search,
    online,
    language,
    copy: t,
    stateId,
    empty: {
      title: term ? t.noMatches(term) : t.empty,
      message: term ? t.hint : undefined,
    },
  });
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside
      className="channels-thread channel-information channel-context-pane channel-members-panel"
      aria-labelledby={title}
    >
      <ChannelSectionHeader
        id={title}
        heading={heading}
        icon={<MembersIcon />}
        title={t.title}
        name={name}
        detailStatus={controls.detailStatus}
        detailAction={controls.detailAction}
        desktopBack={Boolean(back) && !direct}
        backLabel={direct || !back ? t.backToChannel : t.back}
        closeLabel={t.close}
        back={back ?? close}
        close={close}
      />
      <div
        className="channel-member-body"
        aria-busy={controls.loading || undefined}
      >
        {(!controls.empty || term) && (
          <label className="channel-member-search">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6.5" />
              <path d="m15 15 6 6" />
            </svg>
            <input
              type="search"
              className="panel-text--body"
              ref={search}
              value={denied ? "" : query}
              readOnly={fieldLocked}
              aria-disabled={fieldLocked || undefined}
              aria-describedby={
                fieldLocked && controls.notice ? stateId : undefined
              }
              aria-label={t.search}
              placeholder={t.search}
              onChange={(e) => {
                if (fieldLocked) return;
                const value = e.currentTarget.value;
                setQuery(value);
                if (value.trim() !== term) history?.delete(channelId);
              }}
            />
          </label>
        )}
        <ChannelListPosition
          scroll={scroll}
          heading={heading}
          rows={rows}
          query={term}
          remember={reading.remember}
          start={reading.start}
        >
          <div className="channel-member-results" ref={scroll}>
            {controls.top}
            {online && rows.length > 0 && (
              <ul className="channel-member-list">
                {rows.map((row) => {
                  const memberName = teammateName(row.profile, nameFormat);
                  return (
                    <li
                      key={row.profile.id}
                      data-channel-list-row={row.profile.id}
                      tabIndex={-1}
                    >
                      <span aria-hidden="true" className="timeline-avatar">
                        {initials(memberName)}
                      </span>
                      <div>
                        <strong>{memberName}</strong>
                        {(row.schemeGuest || row.profile.isGuest) && (
                          <small className="channel-member-guest">
                            {t.guest}
                          </small>
                        )}
                        <span className="channel-member-handle">
                          @{row.profile.username}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {controls.bottom}
          </div>
        </ChannelListPosition>
      </div>
    </aside>
  );
}
