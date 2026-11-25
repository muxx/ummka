import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import { outgoingCopy } from "./outgoing-copy.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

type State = ReturnType<WorkspaceConnection["getOutgoingPostState"]>;
type Props = {
  post: PendingPost;
  state: State;
  locale: keyof typeof outgoingCopy;
  dismiss: WorkspaceConnection["dismissPendingPost"];
  resend: WorkspaceConnection["resendPost"];
  refresh: () => void;
  notify: (message: string) => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};

export function OutgoingRowActions({
  post,
  state,
  locale,
  dismiss,
  resend,
  refresh,
  notify,
  sessionIssue,
}: Props) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const focusNext = useRef(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const warningId = useId();
  const copy = outgoingCopy[locale];
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    (asking ? confirmButton : retryButton).current?.focus({
      preventScroll: true,
    });
  }, [asking]);

  function ask(value: boolean) {
    if (active.current) return;
    focusNext.current = true;
    setAsking(value);
  }

  async function repeat(button: HTMLButtonElement) {
    if (active.current || !state.actions.retry) return;
    active.current = true;
    setBusy(true);
    const pane = button.closest<HTMLElement>(".timeline-scroll");
    button.closest("article")?.focus({ preventScroll: true });
    setAsking(false);
    try {
      const result = await resend(
        { pendingId: post.pendingId, attempt: post.attempt },
        { kind: "despiteUnknownDelivery" },
      );
      // Consume the completion even if the original timeline has since unmounted.
      const outcome =
        result.kind === "sending" ? await result.completion : null;
      if (!pane?.isConnected) return;
      refresh();
      if (outcome?.kind === "unauthorized") sessionIssue("unauthorized");
      else if (result.kind === "unavailable") notify(copy.changed);
      else if (result.kind === "offline") notify(copy.offline);
    } catch (error) {
      if (!pane?.isConnected) return;
      refresh();
      const reason = workspaceFailure(error, "storage");
      if (reason === "session" || reason === "unauthorized")
        sessionIssue(reason);
      else notify(copy.resendFailed);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  function cancelOnEscape(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    ask(false);
  }

  if (asking && state.actions.retry !== undefined)
    return (
      <>
        <p id={warningId} className="timeline-delivery">
          {copy.duplicateRisk}
        </p>
        <div className="timeline-local-actions">
          <button
            ref={confirmButton}
            onKeyDown={cancelOnEscape}
            type="button"
            aria-describedby={warningId}
            aria-disabled={!state.actions.retry || busy}
            onClick={(e) => void repeat(e.currentTarget)}
          >
            {copy.sendAnyway}
          </button>
          <button
            type="button"
            onKeyDown={cancelOnEscape}
            onClick={() => ask(false)}
          >
            {copy.cancel}
          </button>
        </div>
      </>
    );
  if (
    !state.actions.copy &&
    !state.actions.dismiss &&
    state.actions.retry === undefined
  )
    return null;

  async function act(button: HTMLButtonElement, action: "copy" | "dismiss") {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    const pane = button.closest<HTMLElement>(".timeline-scroll");
    const hadFocus = document.activeElement === button;
    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(post.message);
        if (button.isConnected) notify(copy.copied);
      } else {
        const removed = await dismiss({
          pendingId: post.pendingId,
          attempt: post.attempt,
        });
        if (!pane?.isConnected) return;
        refresh();
        const refused =
          state.kind === "refused" ||
          (state.kind === "previousLogin" && state.outcome.kind === "refused");
        notify(
          removed
            ? refused
              ? copy.removed
              : copy.removedLocally
            : copy.changed,
        );
        if (
          hadFocus &&
          (document.activeElement === button ||
            document.activeElement === document.body)
        )
          pane.focus({ preventScroll: true });
      }
    } catch (error) {
      if (!pane?.isConnected) return;
      const failure = workspaceFailure(error, "storage");
      if (
        action === "dismiss" &&
        (failure === "session" || failure === "unauthorized")
      )
        sessionIssue(failure);
      else notify(action === "copy" ? copy.copyFailed : copy.removeFailed);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="timeline-local-actions">
      {state.actions.retry !== undefined && (
        <button
          ref={retryButton}
          type="button"
          aria-disabled={!state.actions.retry || busy}
          onClick={() => {
            if (state.actions.retry) ask(true);
          }}
        >
          {copy.sendAgain}
        </button>
      )}
      {state.actions.copy && (
        <button
          type="button"
          aria-disabled={busy}
          onClick={(e) => void act(e.currentTarget, "copy")}
        >
          {copy.copyText}
        </button>
      )}
      {state.actions.dismiss && (
        <button
          type="button"
          aria-disabled={busy}
          onClick={(e) => void act(e.currentTarget, "dismiss")}
        >
          {copy.remove}
        </button>
      )}
    </div>
  );
}
