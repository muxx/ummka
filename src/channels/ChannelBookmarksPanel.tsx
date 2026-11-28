import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type Bookmark,
  type BookmarkEdit,
  BookmarkEditor,
  type BookmarkWrites,
  editorCopy,
} from "./BookmarkEditor.tsx";
import { BookmarkIcon } from "./BookmarkIcon.tsx";
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
type Account = BookmarkWrites &
  Pick<WorkspaceConnection, "readChannelBookmarks" | "readChannelFile">;
type Props = {
  account: Account;
  can: (
    action: "add" | "edit" | "delete",
    kind?: Bookmark["destination"]["kind"],
  ) => boolean;
  channelId: string;
  name: string;
  serverUrl: string;
  online: boolean;
  language: EntryLanguage;
  direct?: boolean;
  back: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
};

function BookmarkActions({
  title,
  language,
  owner,
  preferred,
  actions,
  close,
}: {
  title: string;
  language: EntryLanguage;
  owner: HTMLButtonElement;
  preferred: "edit" | "delete" | null;
  actions: {
    label: string;
    icon: "file" | "open" | "edit" | "delete";
    run: () => void;
  }[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    primary = useRef<HTMLButtonElement>(null),
    lastFocused = useRef<EventTarget | null>(null),
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
  useLayoutEffect(() => {
    const node = dialog.current;
    if (
      lastFocused.current instanceof HTMLElement &&
      !lastFocused.current.isConnected &&
      !node?.contains(document.activeElement)
    )
      node
        ?.querySelector<HTMLButtonElement>(".bookmark-action")
        ?.focus({ preventScroll: true });
  });
  function returnToRow() {
    dialog.current?.close();
    owner.focus({ preventScroll: true });
  }
  function dismiss() {
    returnToRow();
    close();
  }
  const first = actions.some(({ icon }) => icon === preferred)
    ? preferred
    : actions[0]?.icon;
  return createPortal(
    <dialog
      ref={dialog}
      className="bookmark-actions modal-layout"
      data-bookmark-menu={owner.dataset.bookmarkId}
      aria-labelledby={id}
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
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
        {actions.map(({ label, icon, run }) => (
          <button
            key={icon}
            type="button"
            className={
              "bookmark-action" + (icon === "delete" ? " destructive" : "")
            }
            ref={icon === first ? primary : undefined}
            onClick={() => {
              returnToRow();
              run();
            }}
          >
            {icon === "file" ? <FileIcon /> : <BookmarkIcon kind={icon} />}
            <strong>{label}</strong>
          </button>
        ))}
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
  can,
  begin,
  focusHeading,
}: Pick<Props, "account" | "channelId" | "serverUrl" | "language" | "can"> & {
  item: Bookmark;
  begin: (edit: BookmarkEdit) => void;
  focusHeading: () => void;
}) {
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null),
    [preferred, setPreferred] = useState<"edit" | "delete" | null>(null);
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
  const actions: {
    icon: "open" | "file" | "edit" | "delete";
    label: string;
    run: () => void;
  }[] = [];
  if (!unavailable)
    actions.push({
      icon: d.kind === "file" ? "file" : "open",
      label:
        d.kind === "file"
          ? t.openFile
          : d.kind === "board"
            ? t.openBoard
            : t.openLink,
      run: open,
    });
  for (const action of ["edit", "delete"] as const)
    if (can(action, d.kind))
      actions.push({
        icon: action,
        label:
          action === "edit"
            ? editorCopy[language].edit
            : editorCopy[language].remove,
        run: () => {
          setOpener(null);
          begin({
            action,
            item,
            openMenu: () => {
              setPreferred(action);
              setOpener(opener);
            },
          });
        },
      });
  const menuAvailable = actions.length > 0;
  useLayoutEffect(() => {
    if (opener && !menuAvailable) {
      setOpener(null);
      focusHeading();
    }
  }, [opener, menuAvailable, focusHeading]);
  return (
    <li>
      <button
        type="button"
        className="channel-bookmark-row"
        data-bookmark-id={item.id}
        disabled={!menuAvailable}
        aria-labelledby={row + "-label"}
        aria-describedby={detail ? row + "-detail" : undefined}
        aria-haspopup="dialog"
        onClick={(e) => {
          setPreferred(null);
          setOpener(e.currentTarget);
        }}
      >
        {label}
      </button>
      {opener && menuAvailable && (
        <BookmarkActions
          title={item.name}
          language={language}
          owner={opener}
          preferred={preferred}
          close={() => setOpener(null)}
          actions={actions}
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

type BookmarkFocus = { id?: string; index?: number };

function EditableBookmarks({
  initial,
  reload,
  focusHeading,
  takeRefreshFocus,
  setEditorOpen,
  ...props
}: Props & {
  initial: Bookmark[];
  reload: (focus?: BookmarkFocus) => void;
  focusHeading: () => void;
  takeRefreshFocus: () => BookmarkFocus | undefined;
  setEditorOpen: (open: boolean) => void;
}) {
  const [items, setItems] = useState(initial),
    [edit, setEdit] = useState<BookmarkEdit | null>(null),
    [sendingInBackground, setSendingInBackground] = useState(false);
  const panel = useRef<HTMLDivElement>(null),
    add = useRef<HTMLButtonElement>(null);
  const target = useRef<BookmarkFocus | null>(null),
    t = bookmarkCopy[props.language],
    w = editorCopy[props.language];
  function begin(next: BookmarkEdit) {
    setEdit(next);
    setEditorOpen(true);
  }
  function restore(focus?: BookmarkFocus) {
    target.current = focus ?? null;
    setSendingInBackground(false);
    setEdit(null);
    setEditorOpen(false);
  }
  function focusedRow(): BookmarkFocus | undefined {
    const active = document.activeElement;
    const button = active?.closest<HTMLButtonElement>(
      "button[data-bookmark-id]",
    );
    const id =
      button && panel.current?.contains(button)
        ? button.dataset.bookmarkId
        : active?.closest<HTMLDialogElement>("dialog[data-bookmark-menu]")
            ?.dataset.bookmarkMenu;
    if (id === undefined) return;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) return { id, index };
  }
  useLayoutEffect(() => {
    if (edit) return;
    const focus = target.current ?? takeRefreshFocus();
    if (!focus) return;
    const rows = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-bookmark-id]",
      ) ?? [],
    );
    const { id, index } = focus;
    const row =
      rows.find((node) => node.dataset.bookmarkId === id && !node.disabled) ??
      (index === undefined
        ? undefined
        : (rows.slice(index).find((node) => !node.disabled) ??
          rows
            .slice(0, index)
            .reverse()
            .find((node) => !node.disabled)));
    target.current = null;
    const button = row ?? (add.current?.disabled ? null : add.current);
    if (button) button.focus({ preventScroll: true });
    else focusHeading();
  }, [edit, focusHeading, takeRefreshFocus]);
  const authorized =
    !edit ||
    !props.online ||
    (edit.action === "add"
      ? props.can("add")
      : props.can(edit.action, edit.item.destination.kind));
  function confirm(updated: Bookmark | null, dismissed: boolean) {
    if (!edit) return;
    if (edit.action === "add") {
      if (!updated) return;
      setItems([...items, updated]);
      restore(dismissed ? undefined : { id: updated.id });
    } else {
      const index = items.findIndex((item) => item.id === edit.item.id);
      if (index < 0) {
        reload(dismissed ? focusedRow() : undefined);
        restore();
        return;
      }
      const next = items.slice();
      next.splice(index, 1, ...(updated ? [updated] : []));
      setItems(next);
      const lostRow =
        updated?.id !== edit.item.id && focusedRow()?.id === edit.item.id;
      restore(!dismissed || lostRow ? { id: updated?.id, index } : undefined);
    }
  }
  return (
    <div ref={panel}>
      {props.can("add") && (
        <div className="bookmark-add-strip">
          <button
            type="button"
            className="bookmark-add"
            disabled={!props.online || sendingInBackground}
            ref={add}
            onClick={() => begin({ action: "add" })}
          >
            {w.add}
          </button>
        </div>
      )}
      {sendingInBackground && <p role="status">{w.saving}</p>}
      {items.length ? (
        <ul>
          {items.map((item) => (
            <BookmarkRow
              key={item.id}
              {...props}
              can={(action, kind) =>
                props.online && !sendingInBackground && props.can(action, kind)
              }
              item={item}
              begin={begin}
              focusHeading={focusHeading}
            />
          ))}
        </ul>
      ) : (
        <div className="channel-files-empty" role="status">
          <BookmarkIcon />
          <h3>{t.empty}</h3>
          <p>{props.can("add") ? w.empty : t.hint}</p>
        </div>
      )}
      {edit && (
        <BookmarkEditor
          edit={edit}
          account={props.account}
          channelId={props.channelId}
          online={props.online}
          authorized={authorized}
          language={props.language}
          sessionIssue={props.sessionIssue}
          confirm={confirm}
          leavePending={() => {
            setSendingInBackground(true);
            focusHeading();
          }}
          close={(refresh, dismissed = false) => {
            if (refresh) {
              if (!dismissed) focusHeading();
              reload(dismissed ? focusedRow() : undefined);
              restore();
            } else {
              restore(
                dismissed
                  ? undefined
                  : edit.action === "add"
                    ? {}
                    : { id: edit.item.id },
              );
            }
          }}
        />
      )}
    </div>
  );
}

export function ChannelBookmarksPanel(props: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    refreshFocus = useRef<BookmarkFocus | undefined>(undefined),
    id = useId();
  const { account, channelId, online, language } = props,
    t = bookmarkCopy[language];
  const { value, retry } = useInfoRead(
    channelId,
    online || editorOpen,
    (s, id) => account.readChannelBookmarks(id, s),
    props.sessionIssue,
  );
  const focusHeading = () => heading.current?.focus({ preventScroll: true });
  function reload(focus?: BookmarkFocus) {
    refreshFocus.current = focus;
    if (focus) {
      document.activeElement
        ?.closest<HTMLDialogElement>("dialog[data-bookmark-menu]")
        ?.close();
      focusHeading();
    }
    retry();
  }
  function takeRefreshFocus() {
    const focus = refreshFocus.current;
    refreshFocus.current = undefined;
    if (document.activeElement === heading.current) return focus;
  }
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
          ) : (
            <EditableBookmarks
              {...props}
              initial={value.value.bookmarks}
              reload={reload}
              setEditorOpen={setEditorOpen}
              focusHeading={focusHeading}
              takeRefreshFocus={takeRefreshFocus}
            />
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
          <button className="bookmark-add" type="button" onClick={retry}>
            {filePanelCopy[language].retry}
          </button>
        )}
      </div>
    </aside>
  );
}
