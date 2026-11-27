import {
  type ContextType,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import type { LocalPost } from "../mattermost/local-history.ts";
import { isMattermostId } from "../mattermost/model-fields.ts";
import { copyToClipboard, PostActionScope } from "./post-action-scope.ts";

export function PublishedPostActions({
  post,
  author,
  avatar,
}: {
  post: LocalPost;
  author: string;
  avatar: ReactNode;
}) {
  const scope = useContext(PostActionScope);
  const id = useId();
  if (
    !scope?.allowed ||
    !isMattermostId(post.id) ||
    post.type.startsWith("system_") ||
    (post.type === "burn_on_read" && post.userId !== scope.userId)
  )
    return null;
  const anchor = scope.anchor?.id === id ? scope.anchor : null;
  return (
    <>
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
          />,
          document.body,
        )}
    </>
  );
}

function ActionDialog({
  anchor,
  author,
  avatar,
  postId,
  scope,
}: {
  anchor: HTMLButtonElement;
  author: string;
  avatar: ReactNode;
  postId: string;
  scope: NonNullable<ContextType<typeof PostActionScope>>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useRef<HTMLButtonElement>(null);
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
    action.current?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    return () => {
      dismissed.current = true;
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
    if (dismissed.current) return;
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
        <button type="button" ref={action} onClick={() => void copy()}>
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
      </div>
    </dialog>
  );
}
