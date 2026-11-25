import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { resolveComposerSubmission } from "./composer-submission.ts";
import type { MentionConfirmation } from "./DraftPostConfirmation.tsx";
import type { ActionFeedback } from "./draft-action-feedback.ts";
import type { VisibleDraft } from "./open-visible-draft.ts";
import {
  prepareVisiblePost,
  type VisiblePostContext,
} from "./prepare-visible-post.ts";

type PreparedDraft = NonNullable<
  Awaited<ReturnType<VisibleDraft["prepareSubmission"]>>
>;
type Route = Awaited<ReturnType<typeof resolveComposerSubmission>>;
type OtherRoute = Exclude<Route, { kind: "post" }>;
export type DraftSendContext = {
  post: VisiblePostContext;
  route: (message: string, signal: AbortSignal) => Promise<Route>;
  performOther: (
    route: OtherRoute,
    prepared: PreparedDraft,
    signal: AbortSignal,
  ) => Promise<ActionFeedback>;
};
type ActiveSend = { controller: AbortController; confirmPost?: PreparedDraft };

export function useDraftSend(
  editor: VisibleDraft,
  context: DraftSendContext,
  online: boolean,
  field: RefObject<HTMLTextAreaElement | null>,
  sessionIssue: (issue: "unauthorized") => void,
  report: (error: unknown) => void,
) {
  const active = useRef<ActiveSend | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningCommand, setRunningCommand] = useState(false);
  const [confirmation, setConfirmation] = useState<MentionConfirmation | null>(
    null,
  );
  const cancel = useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
    setConfirmation(null);
    setBusy(false);
    setRunningCommand(false);
  }, []);
  useLayoutEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    if (!online) cancel();
  }, [online, cancel]);
  useLayoutEffect(
    () =>
      editor.subscribe(() => {
        const offered = active.current?.confirmPost;
        if (offered && !offered.isCurrent()) cancel();
      }),
    [editor, cancel],
  );
  function focus() {
    field.current?.focus({ preventScroll: true });
  }
  function finish(controller: AbortController) {
    if (active.current?.controller !== controller) return;
    active.current = null;
    setBusy(false);
    setRunningCommand(false);
    setConfirmation(null);
  }
  async function post(prepared: PreparedDraft) {
    const input = field.current;
    const result = await prepared.submitPost();
    if (result.kind === "sending") {
      const stillVisible = () => input?.isConnected && field.current === input;
      void result.completion.then(
        (outcome) => {
          if (outcome.kind === "unauthorized" && stillVisible())
            sessionIssue("unauthorized");
        },
        (error: unknown) => {
          if (stillVisible()) report(error);
        },
      );
    }
  }
  async function begin(message?: string, textRevision?: string) {
    if (active.current || !online) return;
    if (message !== undefined && message !== editor.getSnapshot().message)
      editor.edit(message);
    setFeedback(null);
    const controller = new AbortController();
    const action: ActiveSend = { controller };
    active.current = action;
    setBusy(true);
    try {
      const prepared = await editor.prepareSubmission(controller.signal);
      if (!prepared?.isCurrent() || controller.signal.aborted) return;
      if (textRevision !== undefined && prepared.revision !== textRevision)
        return;
      const route =
        textRevision === undefined
          ? await context.route(prepared.message, controller.signal)
          : ({ kind: "post" } as const);
      if (!prepared.isCurrent() || controller.signal.aborted) return;
      if (route.kind !== "post") {
        setRunningCommand(route.kind === "command");
        const answer = await context.performOther(
          route,
          prepared,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setFeedback(answer);
          await editor.refresh();
        }
        return;
      }
      const decision = await prepareVisiblePost(
        context.post,
        prepared.message,
        controller.signal,
      );
      if (!prepared.isCurrent() || controller.signal.aborted) return;
      if (decision.kind !== "ready") {
        report("mention_policy_unavailable");
        return;
      }
      if (decision.confirmation) {
        action.confirmPost = prepared;
        setConfirmation(decision.confirmation);
      } else await post(prepared);
    } catch (error) {
      if (!controller.signal.aborted) report(error);
    } finally {
      if (!action.confirmPost) finish(controller);
    }
  }
  async function confirm() {
    const action = active.current;
    const prepared = action?.confirmPost;
    if (!action || !prepared) return;
    const { controller } = action;
    delete action.confirmPost;
    setConfirmation(null);
    try {
      if (prepared.isCurrent() && online) await post(prepared);
    } catch (error) {
      if (!controller.signal.aborted) report(error);
    } finally {
      if (!controller.signal.aborted) focus();
      finish(controller);
    }
  }
  return {
    begin,
    feedback,
    clearFeedback: () => setFeedback(null),
    confirm,
    confirmation,
    busy,
    runningCommand,
    cancel,
    back() {
      cancel();
      focus();
    },
  };
}
