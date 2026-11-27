import {
  type ContextType,
  type ReactNode,
  type Ref,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { isMobile } from "../build-platform.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import { isMattermostId } from "../mattermost/model-fields.ts";
import { CollectionMark } from "./PostCollectionPane.tsx";
import { copyToClipboard, PostActionScope } from "./post-action-scope.ts";

type Scope = NonNullable<ContextType<typeof PostActionScope>>;
type PublishedActions = {
  post: LocalPost;
  author: string;
  avatar: ReactNode;
  openThread?: () => void;
};

export function PublishedPostActions(props: PublishedActions) {
  const scope = useContext(PostActionScope);
  const { post } = props;
  if (
    !scope ||
    !isMattermostId(post.id) ||
    post.type.startsWith("system_") ||
    (post.type === "burn_on_read" && post.userId !== scope.userId)
  )
    return null;
  return <AvailableActions {...props} scope={scope} />;
}

function AvailableActions({
  post,
  author,
  avatar,
  openThread,
  scope,
}: PublishedActions & { scope: Scope }) {
  const id = useId();
  const status = useSyncExternalStore(
    scope.account.subscribeToSavedPostState,
    () => scope.account.getSavedPostPresentation(post.id),
  );
  const bookmark = savePresentation(status, scope);
  const thread = post.type === "burn_on_read" ? undefined : openThread;
  const anchor = scope.anchor?.id === id ? scope.anchor : null;
  return (
    <>
      {!isMobile && (
        <SaveButton
          bookmark={bookmark}
          onChange={(origin) => {
            origin.focus({ preventScroll: true });
            scope.save(post.id, !bookmark.filled, origin);
          }}
        />
      )}
      <button
        type="button"
        id={id}
        className="timeline-post-actions"
        aria-haspopup="dialog"
        aria-controls={anchor ? `${id}-menu` : undefined}
        aria-expanded={Boolean(anchor)}
        aria-label={scope.text.actions}
        title={scope.text.actions}
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true });
          scope.open(e.currentTarget);
        }}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {anchor &&
        createPortal(
          <ActionDialog
            anchor={anchor}
            author={author}
            avatar={avatar}
            postId={post.id}
            scope={scope}
            openThread={thread}
            bookmark={bookmark}
          />,
          document.body,
        )}
    </>
  );
}

function savePresentation(
  status: ReturnType<Scope["account"]["getSavedPostPresentation"]>,
  { text, online }: Scope,
) {
  const filled = status === "saved" || status === "removing";
  const busy = status === "saving" || status === "removing";
  let detail: string | undefined;
  if (status === "unconfirmed") detail = text.savedUnconfirmed;
  else if (!filled && !busy && status !== "unsaved") {
    detail = !online
      ? text.savedOffline
      : status === "read-refused"
        ? text.savedReadRefused
        : status === "read-failed"
          ? text.savedReadFailed
          : text.savedLoading;
  }
  const label =
    status === "saving"
      ? text.saving
      : status === "removing"
        ? text.removing
        : filled
          ? text.unsave
          : text.save;
  return { busy, detail, filled, label };
}

function SaveButton({
  bookmark,
  onChange,
  menu = false,
  control,
}: {
  bookmark: ReturnType<typeof savePresentation>;
  onChange: (origin: HTMLButtonElement) => void;
  menu?: boolean;
  control?: Ref<HTMLButtonElement>;
}) {
  const hint = useId();
  const { busy, detail, filled, label } = bookmark;
  const disabled = busy || Boolean(detail);
  return (
    <button
      ref={control}
      type="button"
      className={menu ? "post-actions-save" : "timeline-post-save"}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      aria-describedby={menu && detail ? hint : undefined}
      aria-description={menu ? undefined : detail}
      title={menu ? undefined : (detail ?? label)}
      onKeyDown={(event) => {
        if (
          (event.key === "Enter" || event.key === " ") &&
          (disabled || event.repeat)
        )
          event.preventDefault();
      }}
      onClick={(event) => {
        if (!disabled) onChange(event.currentTarget);
      }}
    >
      <CollectionMark kind="all" filled={filled} />
      {menu && (
        <span>
          <strong>{label}</strong>
          {detail && <small id={hint}>{detail}</small>}
        </span>
      )}
    </button>
  );
}

function ActionDialog({
  anchor,
  author,
  avatar,
  postId,
  scope,
  openThread,
  bookmark,
}: {
  anchor: HTMLButtonElement;
  author: string;
  avatar: ReactNode;
  postId: string;
  scope: Scope;
  openThread?: () => void;
  bookmark: ReturnType<typeof savePresentation>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const saveAction = useRef<HTMLButtonElement>(null);
  const waitingForBookmark = useRef(Boolean(bookmark.detail));
  const [bookmarkAnnouncement, setBookmarkAnnouncement] = useState("");
  const dismissed = useRef(false);
  const copying = useRef(false);
  const title = useId();
  const { close, ownsRoute, text } = scope;
  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const row = anchor.closest<HTMLElement>("article");
    dismissed.current = false;
    modal.showModal();
    function position() {
      if (!modal) return;
      if (window.innerWidth <= 740) {
        modal.style.removeProperty("left");
        modal.style.removeProperty("top");
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const size = modal.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const top =
        below >= size.height + 8 || below >= rect.top
          ? rect.bottom + 4
          : rect.top - size.height - 4;
      modal.style.left = `${Math.max(8, Math.min(rect.right - size.width, window.innerWidth - size.width - 8))}px`;
      modal.style.top = `${Math.max(8, Math.min(top, window.innerHeight - size.height - 8))}px`;
    }
    position();
    (action.current ?? saveAction.current)?.focus({ preventScroll: true });
    const sizeObserver = new ResizeObserver(position);
    sizeObserver.observe(modal);
    window.addEventListener("resize", position);
    return () => {
      dismissed.current = true;
      sizeObserver.disconnect();
      window.removeEventListener("resize", position);
      const ownedFocus =
        modal.contains(document.activeElement) ||
        document.activeElement === document.body;
      modal.close();
      if (!ownedFocus) return;
      queueMicrotask(() => {
        if (
          !ownsRoute() ||
          (document.activeElement !== document.body &&
            document.activeElement !== anchor)
        )
          return;
        if (anchor.isConnected) anchor.focus({ preventScroll: true });
        else if (row?.isConnected) {
          row.tabIndex = -1;
          row.focus({ preventScroll: true });
        }
      });
    };
  }, [anchor, ownsRoute]);
  useLayoutEffect(() => {
    if (
      !scope.allowed &&
      (document.activeElement === document.body ||
        document.activeElement === dialog.current)
    )
      (action.current ?? saveAction.current)?.focus({ preventScroll: true });
  }, [scope.allowed]);
  useLayoutEffect(() => {
    if (
      waitingForBookmark.current &&
      !bookmark.detail &&
      !bookmark.busy &&
      document.activeElement === saveAction.current
    )
      setBookmarkAnnouncement(bookmark.label);
    waitingForBookmark.current = Boolean(bookmark.detail);
  }, [bookmark.detail, bookmark.busy, bookmark.label]);
  useEffect(
    () => () => {
      if (!anchor.isConnected) close(anchor);
    },
    [anchor, close],
  );
  function dismiss() {
    dismissed.current = true;
    close(anchor);
  }
  async function copy() {
    if (copying.current) return;
    copying.current = true;
    const isCurrent = scope.copyGuard(anchor);
    let message: string;
    // Begin the clipboard operation in the initiating gesture on desktop WebKit.
    try {
      const copied = await copyToClipboard(
        scope.prefix + encodeURIComponent(postId),
        () => !dismissed.current && isCurrent(),
      );
      if (!copied) return;
      message = text.copied;
    } catch {
      message = text.failed;
    } finally {
      copying.current = false;
    }
    if (dismissed.current || !isCurrent()) return;
    dismiss();
    scope.notify(anchor, message);
  }
  return (
    <dialog
      ref={dialog}
      id={`${anchor.id}-menu`}
      className="post-actions-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          dismiss();
      }}
    >
      <div className="post-actions-heading">
        <span
          aria-hidden="true"
          className="timeline-avatar post-actions-avatar"
        >
          {avatar}
        </span>
        <div>
          <h2 id={title}>{text.actions}</h2>
          <small>{author}</small>
        </div>
        <button type="button" aria-label={text.close} onClick={dismiss}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m4 4 8 8 M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="post-actions-options">
        {openThread && (
          <button
            type="button"
            ref={action}
            onClick={() => {
              if (dismissed.current || !scope.isCurrent(anchor)) return;
              dismiss();
              openThread();
            }}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 14l-3-3h-7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10M14 15v2a1 1 0 0 1-1 1H6l-3 3V11a1 1 0 0 1 1-1h2" />
            </svg>
            {scope.canReply ? text.reply : text.openThread}
          </button>
        )}
        <SaveButton
          bookmark={bookmark}
          control={saveAction}
          menu
          onChange={() => {
            if (!dismissed.current)
              scope.save(postId, !bookmark.filled, anchor, dismiss);
          }}
        />
        {scope.allowed && (
          <button type="button" onClick={() => void copy()}>
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 15 6-6 M8 10l-2 2a4.25 4.25 0 0 0 6 6l2-2 M10 8l2-2a4.25 4.25 0 0 1 6 6l-2 2" />
            </svg>
            {text.copy}
          </button>
        )}
      </div>
      <span className="post-action-announcement" role="status">
        {bookmarkAnnouncement}
      </span>
    </dialog>
  );
}
