import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EntryLanguage } from "../entry/language.ts";
import { FileIcon, filePanelCopy } from "./ChannelFilesPanel.tsx";
import { ChannelSectionHeader } from "./ChannelSectionHeader.tsx";
import {
  AttachmentWindow,
  ChannelFileDetails,
} from "./PublishedAttachments.tsx";
import { PublishedLinkNavigation } from "./PublishedPostLink.tsx";
import "./channel-bookmarks.css";
import { useInfoRead } from "./use-info-read.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

export const bookmarkCopy = {
  en: {
    title: "Channel bookmarks",
    close: "Close channel bookmarks",
    dismiss: "Close",
    empty: "No bookmarks yet",
    hint: "Members with permission to manage bookmarks can add them.",
    denied: "You don’t have access to these bookmarks.",
    unlicensed: "Channel bookmarks aren’t available on this server.",
    loading: "Loading bookmarks…",
    failed: "Couldn’t load channel bookmarks.",
    offline: "Connect to see channel bookmarks.",
    openLink: "Open link",
    openFile: "Open file",
    openBoard: "Open board in browser",
    board: "Board",
    hiddenFile: "File unavailable",
  },
  ru: {
    title: "Закладки канала",
    close: "Закрыть закладки канала",
    dismiss: "Закрыть",
    empty: "Закладок пока нет",
    hint: "Закладки добавляют участники с правом управлять ими.",
    denied: "У вас нет доступа к закладкам этого канала.",
    unlicensed: "На этом сервере закладки каналов недоступны.",
    loading: "Загрузка закладок…",
    failed: "Не удалось загрузить закладки канала.",
    offline: "Подключитесь к сети, чтобы увидеть закладки канала.",
    openLink: "Открыть ссылку",
    openFile: "Открыть файл",
    openBoard: "Открыть доску в браузере",
    board: "Доска",
    hiddenFile: "Файл недоступен",
  },
};
type Account = Pick<
  WorkspaceConnection,
  "readChannelBookmarks" | "readChannelFile"
>;
type Bookmark = Extract<
  Awaited<ReturnType<Account["readChannelBookmarks"]>>,
  { kind: "available" }
>["bookmarks"][number];
type Props = {
  account: Account;
  channelId: string;
  name: string;
  serverUrl: string;
  online: boolean;
  language: EntryLanguage;
  direct?: boolean;
  back: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
};

export function BookmarkIcon({
  kind = "bookmark",
}: {
  kind?: "bookmark" | "link" | "open" | "close";
}) {
  const path = {
    bookmark: "M18 7v14l-6-4-6 4V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4",
    link: "M10 13a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1.8 1.8M14 11a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1.8-1.8",
    open: "M6 18 18 6M6 6h12v12",
    close: "m6 6 12 12m0-12L6 18",
  }[kind];
  return (
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
      <path d={path} />
    </svg>
  );
}

function BookmarkActions({
  title,
  language,
  owner,
  action,
  close,
  file,
}: {
  title: string;
  language: EntryLanguage;
  owner: HTMLButtonElement;
  file: boolean;
  action: { label: string; run: () => void };
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    primary = useRef<HTMLButtonElement>(null),
    id = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    primary.current?.focus({ preventScroll: true });
    function position() {
      if (!node) return;
      if (window.innerWidth <= 740) {
        node.style.removeProperty("left");
        node.style.removeProperty("top");
        return;
      }
      const rect = owner.getBoundingClientRect(),
        { width, height } = node.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const top =
        below >= height + 4 || below >= rect.top
          ? rect.bottom + 4
          : rect.top - height - 4;
      node.style.left =
        Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px";
      node.style.top =
        Math.max(8, Math.min(top, window.innerHeight - height - 8)) + "px";
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(node);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      node.close();
    };
  }, [owner]);
  function returnToRow() {
    dialog.current?.close();
    owner.focus({ preventScroll: true });
  }
  function dismiss() {
    returnToRow();
    close();
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="bookmark-actions modal-layout"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          dismiss();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="bookmark-dismiss"
          aria-label={bookmarkCopy[language].dismiss}
          onClick={dismiss}
        >
          <BookmarkIcon kind="close" />
        </button>
      </header>
      <div className="modal-scroll">
        <button
          type="button"
          className="bookmark-action"
          ref={primary}
          onClick={() => {
            returnToRow();
            action.run();
          }}
        >
          {file ? <FileIcon /> : <BookmarkIcon kind="open" />}
          <strong>{action.label}</strong>
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

function BookmarkRow({
  item,
  account,
  channelId,
  serverUrl,
  language,
}: Pick<Props, "account" | "channelId" | "serverUrl" | "language"> & {
  item: Bookmark;
}) {
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const attachments = useContext(AttachmentWindow),
    navigation = useContext(PublishedLinkNavigation),
    row = useId();
  const t = bookmarkCopy[language],
    d = item.destination;
  const detail =
    d.kind === "file"
      ? d.fileName === null
        ? t.hiddenFile
        : d.fileMimeType
      : d.kind === "link"
        ? d.href
        : t.board;
  const label = (
    <>
      {d.kind === "file" ? <FileIcon /> : <BookmarkIcon kind="link" />}
      <span>
        <strong id={row + "-label"}>{item.name}</strong>
        {detail && <small id={row + "-detail"}>{detail}</small>}
      </span>
    </>
  );
  function open() {
    if (!opener) return;
    if (d.kind === "file") {
      if (d.fileName === null || !attachments) return;
      attachments.open(row, d.fileId, opener);
    } else {
      if (!navigation?.openBookmark) return;
      navigation.openBookmark(
        d.kind === "board"
          ? { kind: "board", href: serverUrl.replace(/\/$/u, "") + d.path }
          : d,
        opener,
      );
    }
    setOpener(null);
  }
  const unavailable =
    d.kind === "file"
      ? d.fileName === null || !attachments
      : !navigation?.openBookmark;
  return (
    <li>
      <button
        type="button"
        className="channel-bookmark-row"
        disabled={unavailable}
        aria-labelledby={row + "-label"}
        aria-describedby={detail ? row + "-detail" : undefined}
        aria-haspopup="dialog"
        onClick={(e) => {
          setOpener(e.currentTarget);
        }}
      >
        {label}
      </button>
      {opener && (
        <BookmarkActions
          title={item.name}
          language={language}
          owner={opener}
          file={d.kind === "file"}
          close={() => setOpener(null)}
          action={{
            label:
              d.kind === "file"
                ? t.openFile
                : d.kind === "board"
                  ? t.openBoard
                  : t.openLink,
            run: open,
          }}
        />
      )}
      {d.kind === "file" && d.fileName !== null && (
        <ChannelFileDetails
          row={row}
          file={{ id: d.fileId, name: d.fileName }}
          language={language}
          read={(s) => account.readChannelFile(channelId, d.fileId, s)}
        />
      )}
    </li>
  );
}

export function ChannelBookmarksPanel(props: Props) {
  const heading = useRef<HTMLHeadingElement>(null),
    id = useId();
  const { account, channelId, online, language } = props,
    t = bookmarkCopy[language];
  const { value, retry } = useInfoRead(
    channelId,
    online,
    (s, id) => account.readChannelBookmarks(id, s),
    props.sessionIssue,
  );
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside
      className="channels-thread channel-information channel-context-pane channel-bookmarks-panel"
      aria-labelledby={id}
    >
      <ChannelSectionHeader
        id={id}
        heading={heading}
        icon={<BookmarkIcon />}
        title={t.title}
        name={props.name}
        backLabel={
          props.direct
            ? filePanelCopy[language].backToChannel
            : filePanelCopy[language].back
        }
        closeLabel={t.close}
        back={props.back}
        close={props.back}
      />
      <div className="channel-bookmark-body" data-channel-files="">
        {value.status === "ready" ? (
          value.value.kind === "unlicensed" ? (
            <p role="status">{t.unlicensed}</p>
          ) : value.value.bookmarks.length ? (
            <ul>
              {value.value.bookmarks.map((item) => (
                <BookmarkRow key={item.id} item={item} {...props} />
              ))}
            </ul>
          ) : (
            <div className="channel-files-empty" role="status">
              <BookmarkIcon />
              <h3>{t.empty}</h3>
              <p>{t.hint}</p>
            </div>
          )
        ) : (
          <p
            role={
              value.status === "failed" || value.status === "denied"
                ? "alert"
                : "status"
            }
          >
            {t[value.status]}
          </p>
        )}
        {value.status === "failed" && (
          <button
            className="channel-files-control"
            type="button"
            onClick={retry}
          >
            {filePanelCopy[language].retry}
          </button>
        )}
      </div>
    </aside>
  );
}
