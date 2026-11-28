import {
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { EntryLanguage } from "../entry/language.ts";
import { BookmarkIcon } from "./BookmarkIcon.tsx";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./channel-directory.css";

export type Bookmark = Extract<
  Awaited<ReturnType<WorkspaceConnection["readChannelBookmarks"]>>,
  { kind: "available" }
>["bookmarks"][number];
export type BookmarkEdit =
  | { action: "add" }
  | {
      action: "edit" | "delete";
      item: Bookmark;
      openMenu: () => void;
    };
export type BookmarkWrites = Pick<
  WorkspaceConnection,
  "createChannelBookmark" | "updateChannelBookmark" | "deleteChannelBookmark"
>;
export const editorCopy = {
  en: {
    add: "Add link",
    edit: "Edit",
    remove: "Delete",
    change: "Edit bookmark",
    confirm: "Delete bookmark?",
    name: "Name",
    url: "Link address",
    save: "Save",
    cancel: "Cancel",
    back: "Back",
    close: "Close",
    shortName: "Enter a name of up to 64 characters.",
    validUrl:
      "Enter an HTTP or HTTPS link without credentials, up to 1024 characters.",
    saving: "Saving bookmark…",
    offline: "Connect to change this bookmark.",
    failed:
      "Couldn’t confirm the change. Close this window to refresh the bookmarks before trying again.",
    denied: "You no longer have access to change this bookmark.",
    empty: "Save a link so your team can find it under the channel header.",
  },
  ru: {
    add: "Добавить ссылку",
    edit: "Изменить",
    remove: "Удалить",
    change: "Изменить закладку",
    confirm: "Удалить закладку?",
    name: "Название",
    url: "Адрес ссылки",
    save: "Сохранить",
    cancel: "Отмена",
    back: "Назад",
    close: "Закрыть",
    shortName: "Введите название длиной до 64 символов.",
    validUrl:
      "Введите HTTP- или HTTPS-ссылку без учётных данных длиной до 1024 символов.",
    saving: "Сохраняем закладку…",
    offline: "Подключитесь к сети, чтобы изменить закладку.",
    failed:
      "Не удалось подтвердить изменение. Закройте окно, чтобы обновить список перед повтором.",
    denied: "У вас больше нет доступа к изменению этой закладки.",
    empty:
      "Сохраните ссылку, чтобы команда могла найти её под заголовком канала.",
  },
};

export function BookmarkEditor({
  edit,
  account,
  channelId,
  online,
  authorized,
  language,
  close,
  leavePending,
  confirm,
  sessionIssue,
}: {
  edit: BookmarkEdit;
  account: BookmarkWrites;
  channelId: string;
  online: boolean;
  authorized: boolean;
  language: EntryLanguage;
  close: (reload: boolean, dismissed?: boolean) => void;
  leavePending: () => void;
  confirm: (item: Bookmark | null, dismissed: boolean) => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
}) {
  const t = editorCopy[language],
    existing = edit.action === "add" ? undefined : edit.item;
  const removing = edit.action === "delete",
    link = !existing || existing.destination.kind === "link";
  const [name, setName] = useState(existing?.name ?? ""),
    [href, setHref] = useState(
      existing?.destination.kind === "link" ? existing.destination.href : "",
    );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const pending = useRef<AbortController | null>(null),
    dismissed = useRef(false),
    dialog = useRef<HTMLDialogElement>(null),
    first = useRef<HTMLInputElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    id = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    (removing ? cancel.current : first.current)?.focus({ preventScroll: true });
    return () => {
      pending.current?.abort();
      node?.close();
    };
  }, [removing]);
  function dismiss() {
    dialog.current?.close();
    if (pending.current) {
      dismissed.current = true;
      leavePending();
    } else close(needsRefresh);
  }
  const closeRevokedAction = useEffectEvent(() => {
    if (!dismissed.current) dismiss();
  });
  useLayoutEffect(() => {
    if (!authorized) closeRevokedAction();
  }, [authorized]);
  function back() {
    if (edit.action === "add" || needsRefresh || pending.current) dismiss();
    else {
      close(false, true);
      edit.openMenu();
    }
  }
  async function save() {
    if (!online || !authorized || pending.current || needsRefresh) return;
    const label = name.trim(),
      address = href.trim(),
      originalAddress =
        existing?.destination.kind === "link"
          ? existing.destination.href.trim()
          : undefined;
    const nameChanged = label !== existing?.name,
      linkChanged = link && address !== originalAddress;
    let url = "";
    if (!removing) {
      if (!label || [...label].length > 64) {
        setError(t.shortName);
        return;
      }
      if (linkChanged) {
        let parsed: URL;
        try {
          parsed = new URL(address);
        } catch {
          setError(t.validUrl);
          return;
        }
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          [...parsed.href].length > 1024
        ) {
          setError(t.validUrl);
          return;
        }
        url = parsed.href;
      }
      if (!nameChanged && !linkChanged) {
        close(false);
        return;
      }
    }
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError("");
    try {
      let updated: Bookmark | null = null;
      if (edit.action === "add")
        updated = await account.createChannelBookmark(
          channelId,
          { type: "link", displayName: label, linkUrl: url },
          request.signal,
        );
      else if (edit.action === "delete")
        await account.deleteChannelBookmark(
          channelId,
          edit.item,
          request.signal,
        );
      else {
        const patch: { displayName?: string; linkUrl?: string } = {};
        if (nameChanged) patch.displayName = label;
        if (linkChanged) patch.linkUrl = url;
        updated = (
          await account.updateChannelBookmark(
            channelId,
            edit.item,
            patch,
            request.signal,
          )
        ).updated;
      }
      if (!request.signal.aborted) confirm(updated, dismissed.current);
    } catch (reason) {
      if (request.signal.aborted) return;
      const status = workspaceFailure(reason, "network");
      if (status === "session" || status === "unauthorized") {
        sessionIssue(status);
        return;
      }
      if (dismissed.current) {
        close(true, true);
        return;
      }
      setError(status === "forbidden" ? t.denied : t.failed);
      setNeedsRefresh(true);
    } finally {
      if (!request.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape uses the native dialog cancel event.
    <dialog
      ref={dialog}
      className="directory-join-dialog bookmark-editor modal-layout"
      aria-labelledby={id}
      onClick={(event) => {
        const node = event.currentTarget;
        if (event.target !== node) return;
        const { left, right, top, bottom } = node.getBoundingClientRect();
        if (
          event.clientX < left ||
          event.clientX > right ||
          event.clientY < top ||
          event.clientY > bottom
        )
          dismiss();
      }}
      onCancel={(e) => {
        e.preventDefault();
        back();
      }}
    >
      <header>
        {existing && (
          <button
            type="button"
            className="directory-join-close"
            aria-label={t.back}
            onClick={back}
          >
            <BookmarkIcon kind="back" />
          </button>
        )}
        <h2 id={id}>{removing ? t.confirm : existing ? t.change : t.add}</h2>
        <button
          className="directory-join-close"
          type="button"
          aria-label={t.close}
          onClick={dismiss}
        >
          <BookmarkIcon kind="close" />
        </button>
      </header>
      <form
        className="modal-form"
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="modal-scroll bookmark-editor-fields">
          {removing ? (
            <p>{existing?.name}</p>
          ) : (
            <>
              <label>
                {t.name}
                <input
                  ref={first}
                  required
                  value={name}
                  readOnly={busy || needsRefresh}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                />
              </label>
              {link && (
                <label>
                  {t.url}
                  <input
                    type="url"
                    required
                    value={href}
                    readOnly={busy || needsRefresh}
                    onChange={(e) => {
                      setHref(e.target.value);
                      setError("");
                    }}
                  />
                </label>
              )}
            </>
          )}
          {error && (
            <p className="bookmark-editor-error" role="alert">
              {error}
            </p>
          )}
          {!online && !error && <p role="status">{t.offline}</p>}
        </div>
        <footer>
          <button type="button" ref={cancel} onClick={back}>
            {t.cancel}
          </button>
          <button
            type="submit"
            className={removing ? "bookmark-delete" : undefined}
            disabled={!online || busy || needsRefresh}
          >
            {removing ? t.remove : t.save}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
