import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { SidebarPreferences } from "../mattermost/workspace-preferences.ts";
import { composerEnter } from "./composer-enter.ts";
import { DraftPostConfirmation } from "./DraftPostConfirmation.tsx";
import { draftActionFeedback } from "./draft-action-feedback.ts";
import { draftCopy } from "./draft-copy.ts";
import { openVisibleDraft, type VisibleDraft } from "./open-visible-draft.ts";
import { type DraftSendContext, useDraftSend } from "./use-draft-send.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./draft.css";

type FieldProps = {
  language: EntryLanguage;
  sendContext: DraftSendContext;
  conversation: { name: string; direct: boolean };
  keys: SidebarPreferences["composerKeys"];
  online: boolean;
  label: string;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};
type Props = FieldProps & {
  connection: Pick<
    WorkspaceConnection,
    "readDraft" | "saveDraft" | "submitDraft" | "rid"
  >;
  channelId: string;
  rootId?: string;
};

export function DraftComposer(props: Props) {
  return (
    <DraftPlace
      key={JSON.stringify([
        props.connection.rid,
        props.channelId,
        props.rootId,
      ])}
      {...props}
    />
  );
}

function DraftPlace({ connection, channelId, rootId, ...field }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [switchedAt] = useState(() =>
    rootId === undefined ? performance.now() : undefined,
  );
  const [loaded, setLoaded] = useState<{
    attempt: number;
    value: VisibleDraft | "failed";
  } | null>(null);
  const result = loaded?.attempt === attempt ? loaded.value : null;
  const retryButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (
      attempt &&
      result === "failed" &&
      document.activeElement === document.body
    )
      retryButton.current?.focus({ preventScroll: true });
  }, [attempt, result]);
  const { sessionIssue } = field;
  useEffect(() => {
    let visible = true;
    const lease = openVisibleDraft(connection, { channelId, rootId });
    void lease.opened.then(
      (editor) => {
        if (!visible) return;
        setLoaded({ attempt, value: editor });
        if (lease.reused) void editor.refresh().catch(() => {});
      },
      (error: unknown) => {
        if (!visible) return;
        const issue = workspaceFailure(error, "storage");
        if (issue === "session" || issue === "unauthorized")
          sessionIssue(issue);
        else setLoaded({ attempt, value: "failed" });
      },
    );
    return () => {
      visible = false;
      lease.close();
    };
  }, [connection, channelId, rootId, attempt, sessionIssue]);
  const copy = draftCopy[field.language];
  if (result && result !== "failed")
    return (
      <DraftField
        editor={result}
        switchedAt={switchedAt}
        afterRetry={attempt > 0}
        {...field}
      />
    );
  return (
    <div
      className="workspace-notice"
      role={result === "failed" ? "alert" : "status"}
    >
      {result === "failed" ? copy.loadFailed : copy.loading}
      {result === "failed" && (
        <button
          ref={retryButton}
          type="button"
          onClick={() => {
            setAttempt((n) => n + 1);
          }}
        >
          {copy.retry}
        </button>
      )}
    </div>
  );
}

function DraftField({
  editor,
  afterRetry,
  fieldRef,
  label,
  language,
  online,
  sessionIssue,
  sendContext,
  conversation,
  keys,
  switchedAt,
}: FieldProps & {
  editor: VisibleDraft;
  afterRetry: boolean;
  switchedAt: number | undefined;
}) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, requestFocus] = useState(afterRetry ? 1 : 0);
  const retryButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const copy = draftCopy[language];
  const [sendError, setSendError] = useState("");
  const sending = useDraftSend(
    editor,
    sendContext,
    online,
    fieldRef,
    sessionIssue,
    (error) => {
      if (error === "mention_policy_unavailable") {
        setSendError(copy.mentionPolicy);
        return;
      }
      const issue = workspaceFailure(error, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      else setSendError(copy.sendFailed);
    },
  );
  const feedback = sending.feedback;
  const answer = feedback?.kind === "command" ? feedback.answer : null;
  const unknown =
    answer?.kind === "answered" &&
    answer.result.kind === "unknownCommand" &&
    answer.settlement === "saved"
      ? answer.draft
      : null;
  const textRevision =
    unknown?.revision &&
    unknown.revision === state.stored.revision &&
    state.message === unknown.message &&
    !state.conflict
      ? unknown.revision
      : null;
  const pending =
    state.stored.commandPending && state.message === state.stored.message;
  const resultText = feedback
    ? draftActionFeedback(feedback, language)
    : pending
      ? copy.pendingCommand
      : "";
  const labelSend = state.message.startsWith("/") ? copy.command : copy.send;
  function submit(amended?: string) {
    setSendError("");
    void sending.begin(amended);
  }
  const empty = !state.stored.message;
  const conflictTitle = !empty
    ? copy.changed
    : state.stored.clearedBySubmission
      ? copy.sent
      : copy.cleared;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    if (
      focusRequest &&
      retryButton.current &&
      document.activeElement === document.body
    ) {
      retryButton.current.focus({ preventScroll: true });
      return;
    }
    const pane = field.closest("main, aside");
    if (
      (focusRequest &&
        (document.activeElement === document.body ||
          document.activeElement === field)) ||
      (pane?.querySelector("h1, h2") === document.activeElement &&
        (field.closest(".channels-frame")?.clientWidth ?? 0) > 740)
    )
      field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [fieldRef, focusRequest]);

  useEffect(() => {
    let visible = true;
    const refresh = async () => {
      const before = editor.getSnapshot();
      try {
        await editor.refresh();
      } catch {
        return;
      }
      const after = editor.getSnapshot();
      if (
        visible &&
        !after.conflict &&
        before.stored.revision !== after.stored.revision &&
        before.message !== after.message
      )
        setAnnouncement(
          after.stored.clearedBySubmission ? copy.sent : copy.updated,
        );
    };
    const save = () => {
      void editor.flush().catch(() => {});
    };
    const visibility = () => {
      if (document.hidden) save();
      else void refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      visible = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", save);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [editor, copy]);
  useEffect(() => {
    if (state.conflict) setAnnouncement(conflictTitle + ". " + copy.unsaved);
  }, [state.conflict, conflictTitle, copy.unsaved]);
  useEffect(() => {
    if (state.error === null) return;
    const issue = workspaceFailure(state.error, "storage");
    if (issue === "unauthorized" || issue === "session") sessionIssue(issue);
  }, [state.error, sessionIssue]);

  async function resolve(keep: boolean) {
    const field = fieldRef.current;
    try {
      if (keep) await editor.keepLocal(state.stored.revision);
      else await editor.takeStored(state.stored.revision);
    } catch {
      if (field?.isConnected && fieldRef.current === field)
        requestFocus((n) => n + 1);
      return;
    }
    if (
      editor.getSnapshot().conflict ||
      !field?.isConnected ||
      fieldRef.current !== field
    )
      return;
    requestFocus((n) => n + 1);
    setAnnouncement(keep ? copy.kept : copy.used);
  }

  async function retry() {
    const field = fieldRef.current;
    try {
      await editor.retryStorage();
    } catch {
      if (field?.isConnected && fieldRef.current === field)
        requestFocus((n) => n + 1);
      return;
    }
    if (
      editor.getSnapshot().error === null &&
      field?.isConnected &&
      fieldRef.current === field
    )
      requestFocus((n) => n + 1);
  }
  return (
    <div className="draft-wrap">
      {state.conflict && (
        <fieldset className="draft-conflict">
          <legend>{conflictTitle}</legend>
          {!empty && (
            <>
              <label htmlFor={id + "-stored"}>{copy.stored}</label>
              <textarea
                id={id + "-stored"}
                className="draft-stored"
                rows={3}
                readOnly
                value={state.stored.message}
              />
            </>
          )}
          <p id={id + "-hint"}>
            {empty && copy.empty + " "}
            {copy.unsaved}
          </p>
          <div className="draft-actions">
            <button
              type="button"
              aria-describedby={id + "-hint"}
              onClick={() => void resolve(true)}
            >
              {empty ? copy.keepDraft : copy.keep}
            </button>
            <button
              type="button"
              aria-describedby={id + (empty ? "-hint" : "-stored")}
              onClick={() => void resolve(false)}
            >
              {empty ? copy.clear : copy.take}
            </button>
          </div>
        </fieldset>
      )}
      {state.error !== null && (
        <div className="workspace-notice" role="alert">
          {copy.saveFailed}
          <button type="button" ref={retryButton} onClick={() => void retry()}>
            {copy.retry}
          </button>
        </div>
      )}
      {sending.confirmation && (
        <DraftPostConfirmation
          language={language}
          conversation={conversation}
          confirmation={sending.confirmation}
          confirm={() => void sending.confirm()}
          cancel={sending.back}
        />
      )}
      {sending.runningCommand && (
        <p className="draft-announcement" role="status">
          {copy.runningCommand}
        </p>
      )}
      {resultText && (
        <div className="draft-feedback">
          {answer?.kind === "answered" &&
            answer.result.kind === "executed" &&
            answer.result.response.responseType === "ephemeral" && (
              <small>{copy.onlyYou}</small>
            )}
          <p role="status">{resultText}</p>
          {answer?.kind === "answered" &&
            answer.settlement === "storageUnavailable" && (
              <small>{copy.settlementFailed}</small>
            )}
          {textRevision !== null && (
            <button
              type="button"
              disabled={!online || sending.busy}
              onClick={() => void sending.begin(undefined, textRevision)}
            >
              {copy.asText}
            </button>
          )}
          {feedback && !pending && (
            <button
              type="button"
              onClick={() => {
                sending.clearFeedback();
                fieldRef.current?.focus({ preventScroll: true });
              }}
            >
              {copy.dismiss}
            </button>
          )}
        </div>
      )}
      {sendError && (
        <p role="alert" className="draft-submit-error">
          {sendError}
        </p>
      )}
      <div className="draft-box">
        <textarea
          ref={fieldRef}
          rows={1}
          aria-label={label}
          placeholder={label}
          readOnly={sending.runningCommand}
          aria-describedby={state.conflict ? id + "-hint" : undefined}
          value={state.message}
          onKeyDown={(event) => {
            const decision = composerEnter(event.nativeEvent, {
              message: event.currentTarget.value,
              caret: event.currentTarget.selectionStart,
              mobile: import.meta.env.UMMKA_MOBILE === true,
              preferences: keys,
              millisecondsSinceChannelSwitch:
                switchedAt === undefined
                  ? undefined
                  : performance.now() - switchedAt,
            });
            if (decision.kind === "native") return;
            event.preventDefault();
            if (decision.kind === "submit" && !pending)
              submit(decision.message);
          }}
          onChange={(event) => {
            setSendError("");
            sending.clearFeedback();
            editor.edit(event.currentTarget.value);
          }}
          onBlur={() => {
            void editor.flush().catch(() => {});
          }}
        />
        <button
          className="draft-send"
          type="button"
          aria-label={labelSend}
          title={labelSend}
          disabled={
            !online ||
            sending.busy ||
            pending ||
            state.conflict ||
            !state.message.trim()
          }
          onClick={() => submit()}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <path d="M3 4L21 12L3 20L6 12Z M6 12H20" />
          </svg>
        </button>
        {!online && <small>{copy.offline}</small>}
      </div>
      <span className="draft-announcement" role="status">
        {announcement}
      </span>
    </div>
  );
}
