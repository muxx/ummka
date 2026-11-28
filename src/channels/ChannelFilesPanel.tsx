import { useEffectEvent, useId, useLayoutEffect, useRef } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { ChannelListPosition } from "./ChannelListPosition.tsx";
import { ContextPanelHeader } from "./ContextPanelHeader.tsx";
import { readChannelFilesPage } from "./channel-files-page.ts";
import type { ChannelFile, PageReading } from "./channel-list-reading.ts";
import { channelPanelBack } from "./context-panel-copy.ts";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { ChannelFileCard } from "./PublishedAttachments.tsx";
import { searchCopy } from "./search-copy.ts";
import { useChannelListControls } from "./use-channel-list-controls.tsx";
import { useChannelListPages } from "./use-channel-list-pages.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

export const filePanelCopy = {
  en: {
    title: "Channel files",
    close: "Close channel files",
    empty: "No files yet",
    hint: "Attachments from the channel and its threads will appear here.",
    loading: "Loading files…",
    denied: "No access to channel files",
    more: "Show more files",
  },
  ru: {
    title: "Файлы канала",
    close: "Закрыть файлы канала",
    empty: "Файлов пока нет",
    hint: "Вложения из канала и его тредов появятся здесь.",
    loading: "Загружаем файлы…",
    denied: "Нет доступа к файлам",
    more: "Показать ещё файлы",
  },
};
export function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5" />
    </svg>
  );
}
type Props = {
  account: Pick<
    WorkspaceConnection,
    "readChannelIdentity" | "readFileSearchPage" | "readChannelFile"
  >;
  teamId: string;
  channelId: string;
  history?: Map<string, PageReading<ChannelFile>>;
  name: string;
  language: EntryLanguage;
  online: boolean;
  hidden: boolean;
  restoreButton?: HTMLButtonElement;
  back: () => void;
  direct?: boolean;
  close: () => void;
  channelDenied: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
  showMessage: (postId: string, button: HTMLButtonElement) => void;
};
const fileId = (row: ChannelFile) => row.id;

export function ChannelFilesPanel(props: Props) {
  const {
    account,
    teamId,
    channelId,
    history,
    online,
    hidden,
    language,
    sessionIssue,
    channelDenied,
    showMessage,
  } = props;
  const t = filePanelCopy[language];
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const id = useId();
  const reading = useChannelListPages({
    history,
    channelId,
    online,
    id: fileId,
    async load(page, signal) {
      const result = await readChannelFilesPage(
        account,
        teamId,
        channelId,
        page,
        signal,
        channelDenied,
      );
      return {
        page,
        rows: result.items.filter((file) => file.name?.trim()),
        next: result.isEnd ? null : page + 1,
        inaccessible: result.firstInaccessibleFileTime,
      };
    },
    sessionIssue,
  });
  const controls = useChannelListControls({
    reading,
    scroll: body,
    heading,
    hidden,
    online,
    language,
    copy: t,
    empty: { title: t.empty, message: t.hint },
  });
  const visible = reading.rows;
  const returnFocus = useEffectEvent(() => {
    const button = props.restoreButton;
    (button?.isConnected ? button : heading.current)?.focus({
      preventScroll: true,
    });
  });
  useLayoutEffect(() => {
    if (!hidden) returnFocus();
  }, [hidden]);
  return (
    <aside
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
      className="channels-thread channel-information channel-context-pane channel-files-panel"
      aria-labelledby={id}
    >
      <ContextPanelHeader
        id={id}
        heading={heading}
        icon={<FileIcon />}
        title={t.title}
        subtitle={props.name}
        status={controls.headerStatus}
        back={{
          label:
            channelPanelBack[props.language][
              props.direct ? "conversation" : "info"
            ],
          run: props.back,
          compactOnly: props.direct,
        }}
        close={{ label: t.close, run: props.close }}
        actions={<PaneSizeToggle />}
      />
      <ChannelListPosition
        scroll={body}
        heading={heading}
        rows={reading.rows}
        hidden={hidden}
        start={reading.start}
        remember={reading.remember}
      >
        <div
          className="channel-files-body"
          ref={body}
          data-channel-files=""
          aria-busy={controls.loading || undefined}
        >
          {reading.state.pages.some((page) => (page.inaccessible ?? 0) > 0) && (
            <p className="channel-file-retention">
              {searchCopy[language].retention}
            </p>
          )}
          {controls.top}
          {visible.length > 0 && (
            <ul className="post-files channel-files-list">
              {visible.map((file, i) => (
                <li key={file.id} data-channel-list-row={file.id}>
                  <ChannelFileCard
                    file={file}
                    index={i}
                    language={language}
                    read={(signal) =>
                      account.readChannelFile(channelId, file.id, signal)
                    }
                    showMessage={showMessage}
                  />
                </li>
              ))}
            </ul>
          )}
          {controls.bottom}
        </div>
      </ChannelListPosition>
    </aside>
  );
}
