import {
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { FileIcon } from "./ChannelFilesPanel.tsx";
import {
  ChannelListStatus,
  channelListCopy,
  channelListError,
  channelListOffline,
} from "./ChannelListState.tsx";
import { useCollectionRefreshVisibility } from "./CollectionReadNotice.tsx";
import { ContextPanelHeader } from "./ContextPanelHeader.tsx";
import type { ChannelBookmarkWrites } from "./channel-bookmark-writes.ts";
import { channelPanelBack } from "./context-panel-copy.ts";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
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
    denied: "No access to channel bookmarks",
    unlicensed: "Bookmarks unavailable",
    noFeature: "This server doesn’t offer channel bookmarks",
    loading: "Loading bookmarks…",
    updating: "Updating bookmarks…",
    updateFailed: "Update failed: no response",
    updateAnnouncement:
      "Bookmarks couldn’t update. The server didn’t return the list",
    updated: "Bookmarks updated",
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
    denied: "Нет доступа к закладкам",
    unlicensed: "Закладки недоступны",
    noFeature: "На этом сервере их нет",
    loading: "Загружаем закладки…",
    updating: "Обновляем закладки…",
    updateFailed: "Не обновились: нет ответа",
    updateAnnouncement: "Закладки не обновились. Сервер не вернул список",
    updated: "Закладки обновлены",
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
  writes: ChannelBookmarkWrites;
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
  close: () => void;
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
  items,
  setItems,
  reading,
  pendingFromOtherView,
  panelId,
  reload,
  focusHeading,
  takeRefreshFocus,
  setEditorOpen,
  ...props
}: Props & {
  items: Bookmark[];
  setItems: (items: Bookmark[]) => void;
  reading: boolean;
  pendingFromOtherView: boolean;
  panelId: string;
  reload: (focus?: BookmarkFocus) => void;
  focusHeading: () => void;
  takeRefreshFocus: () => BookmarkFocus | undefined;
  setEditorOpen: (open: boolean) => void;
}) {
  const [edit, setEdit] = useState<BookmarkEdit | null>(null),
    [sendingInBackground, setSendingInBackground] = useState(false);
  const panel = useRef<HTMLDivElement>(null),
    add = useRef<HTMLButtonElement>(null);
  const target = useRef<BookmarkFocus | null>(null),
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
  const saving = pendingFromOtherView || sendingInBackground;
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
            disabled={!props.online || reading || saving}
            ref={add}
            onClick={() => begin({ action: "add" })}
          >
            {w.add}
          </button>
        </div>
      )}
      {saving && (
        <p className="bookmark-saving" role="status">
          {w.saving}
        </p>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <BookmarkRow
              key={item.id}
              {...props}
              can={(action, kind) =>
                props.online && !reading && !saving && props.can(action, kind)
              }
              item={item}
              begin={begin}
              focusHeading={focusHeading}
            />
          ))}
        </ul>
      )}
      {edit && (
        <BookmarkEditor
          edit={edit}
          account={props.account}
          channelId={props.channelId}
          online={props.online}
          authorized={authorized}
          language={props.language}
          runWrite={(view, write) =>
            props.writes.run(props.channelId, { panel: panelId, view }, write)
          }
          sessionIssue={props.sessionIssue}
          confirm={confirm}
          leavePending={() => {
            setSendingInBackground(true);
            setEditorOpen(false);
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
  const [retrying, setRetrying] = useState(false);
  const [items, setItems] = useState<{
    channelId: string;
    response: object;
    current: Bookmark[];
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const noticeHeading = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const refreshFocus = useRef<BookmarkFocus | undefined>(undefined);
  const retryFocus = useRef(false);
  const hadRefresh = useRef(false);
  const id = useId();
  const { account, writes, channelId, online, language } = props;
  const t = bookmarkCopy[language];
  const listText = channelListCopy[language];
  const pending = useSyncExternalStore(writes.subscribe, () =>
    writes.pending(channelId),
  );
  const pendingFromOtherView =
    pending && (pending.panel !== id || pending.view.aborted) ? pending : null;
  const [previousWrite, setPreviousWrite] = useState(pendingFromOtherView);
  const [writeRevision, setWriteRevision] = useState(0);
  if (previousWrite !== pendingFromOtherView) {
    setPreviousWrite(pendingFromOtherView);
    if (previousWrite && !pendingFromOtherView)
      setWriteRevision(writeRevision + 1);
  }
  const { value, retry } = useInfoRead(
    channelId,
    online || editorOpen,
    (s, id) => account.readChannelBookmarks(id, s),
    props.sessionIssue,
    undefined,
    writeRevision,
  );
  const unlicensed =
    value.status === "ready" && value.value.kind === "unlicensed";
  const confirmed =
    value.status === "ready" && value.value.kind === "available"
      ? value.value.bookmarks
      : null;
  if (confirmed && (items?.response !== value || items.channelId !== channelId))
    setItems({ channelId, response: value, current: confirmed });
  else if (
    items &&
    (items.channelId !== channelId ||
      value.status === "denied" ||
      value.status === "offline" ||
      unlicensed)
  )
    setItems(null);

  const visible = items?.channelId === channelId && !unlicensed ? items : null;
  const loading = value.status === "loading";
  const failed = value.status === "failed";
  const refreshing = Boolean(visible) && loading;
  const refreshFailed = Boolean(visible) && failed;
  const showRefresh = useCollectionRefreshVisibility(refreshing);
  const updateRetry = refreshFailed || (refreshing && retrying);
  const closed = value.status === "denied" || unlicensed;
  const focusHeading = () => heading.current?.focus({ preventScroll: true });
  function reload(focus?: BookmarkFocus) {
    refreshFocus.current = focus;
    if (focus) {
      const dialog = document.activeElement?.closest<HTMLDialogElement>(
        "dialog[data-bookmark-menu]",
      );
      if (dialog) {
        dialog.close();
        focusHeading();
      }
    }
    setAnnouncement("");
    retry();
  }
  function takeRefreshFocus() {
    if (value.status !== "ready") return;
    const focus = refreshFocus.current;
    refreshFocus.current = undefined;
    const active = document.activeElement;
    if (active === heading.current || active === document.body) return focus;
  }
  function repeat(button: HTMLButtonElement | null) {
    if (retrying) return;
    if (button) {
      button.focus({ preventScroll: true });
      retryFocus.current = true;
    }
    setRetrying(true);
    setAnnouncement("");
    retry();
  }
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (loading) {
      if (refreshing) hadRefresh.current = true;
      return;
    }
    if (retrying) setRetrying(false);
    if (refreshFailed) {
      setAnnouncement(t.updateAnnouncement);
      return;
    }
    if (hadRefresh.current) {
      hadRefresh.current = false;
      setAnnouncement(confirmed ? t.updated : "");
    } else if (!confirmed) setAnnouncement("");
    if (refreshFocus.current && failed) refreshFocus.current = undefined;
    const returnFocus = retryFocus.current;
    retryFocus.current = false;
    const active = document.activeElement;
    if (closed && (active === document.body || active === heading.current)) {
      noticeHeading.current?.focus({ preventScroll: true });
      return;
    }
    if (!returnFocus || active !== document.body) return;
    const row = body.current?.querySelector<HTMLButtonElement>(
      ".channel-bookmark-row:not(:disabled)",
    );
    (row ?? noticeHeading.current ?? heading.current)?.focus({
      preventScroll: true,
    });
  }, [
    loading,
    refreshing,
    refreshFailed,
    retrying,
    closed,
    confirmed,
    failed,
    t,
  ]);
  const notice = closed
    ? {
        variant: "error" as const,
        title: unlicensed ? t.unlicensed : t.denied,
        message: unlicensed ? t.noFeature : undefined,
      }
    : value.status === "offline"
      ? channelListOffline(language)
      : !visible && (failed || retrying)
        ? channelListError(language, false)
        : !visible && loading
          ? { variant: "pending" as const, message: t.loading }
          : visible?.current.length === 0
            ? {
                variant: "empty" as const,
                title: t.empty,
                message: props.can("add") ? editorCopy[language].empty : t.hint,
              }
            : null;
  return (
    <aside
      className="channels-thread channel-information channel-context-pane channel-bookmarks-panel"
      aria-labelledby={id}
    >
      <ContextPanelHeader
        id={id}
        heading={heading}
        icon={<BookmarkIcon />}
        title={t.title}
        subtitle={props.name}
        status={
          (updateRetry || showRefresh) && (
            <>
              <span className="panel-text--secondary">
                {updateRetry ? t.updateFailed : t.updating}
              </span>
              {updateRetry && (
                <button
                  type="button"
                  ref={refreshButton}
                  aria-disabled={retrying || undefined}
                  aria-busy={retrying || undefined}
                  onClick={() => repeat(refreshButton.current)}
                >
                  {retrying ? listText.retrying : listText.retry}
                </button>
              )}
            </>
          )
        }
        back={{
          label:
            channelPanelBack[language][props.direct ? "conversation" : "info"],
          run: props.back,
          compactOnly: props.direct,
        }}
        close={{ label: t.close, run: props.close }}
        actions={<PaneSizeToggle />}
      />
      <div
        className="channel-bookmark-body"
        ref={body}
        data-channel-files=""
        aria-busy={loading || undefined}
      >
        {visible && (
          <EditableBookmarks
            key={channelId}
            {...props}
            items={visible.current}
            setItems={(current) => setItems({ ...visible, current })}
            reading={refreshing || refreshFailed}
            pendingFromOtherView={Boolean(pendingFromOtherView)}
            panelId={id}
            reload={reload}
            setEditorOpen={setEditorOpen}
            focusHeading={focusHeading}
            takeRefreshFocus={takeRefreshFocus}
          />
        )}
        <ChannelListStatus
          language={language}
          notice={notice}
          heading={noticeHeading}
          announcement={announcement}
          retry={
            !visible && (failed || retrying)
              ? {
                  running: retrying,
                  button: retryButton,
                  read: () => repeat(retryButton.current),
                }
              : undefined
          }
        />
      </div>
    </aside>
  );
}
