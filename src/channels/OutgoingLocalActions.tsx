import { useRef, useState } from "react";
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
  refresh: () => void;
  notify: (message: string) => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};

export function OutgoingLocalActions({
  post,
  state,
  locale,
  dismiss,
  refresh,
  notify,
  sessionIssue,
}: Props) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const copy = outgoingCopy[locale];
  if (!state.actions.copy && !state.actions.dismiss) return null;

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
