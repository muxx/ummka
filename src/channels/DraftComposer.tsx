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
import { draftCopy } from "./draft-copy.ts";
import { openVisibleDraft, type VisibleDraft } from "./open-visible-draft.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./draft.css";

type FieldProps = {
  language: EntryLanguage;
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
    return <DraftField editor={result} afterRetry={attempt > 0} {...field} />;
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
}: FieldProps & { editor: VisibleDraft; afterRetry: boolean }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, requestFocus] = useState(afterRetry ? 1 : 0);
  const retryButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const copy = draftCopy[language];
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
      <div className="draft-box">
        <textarea
          ref={fieldRef}
          rows={1}
          aria-label={label}
          placeholder={label}
          aria-describedby={state.conflict ? id + "-hint" : undefined}
          value={state.message}
          onChange={(event) => editor.edit(event.currentTarget.value)}
          onBlur={() => {
            void editor.flush().catch(() => {});
          }}
        />
        {!online && <small>{copy.offline}</small>}
      </div>
      <span className="draft-announcement" role="status">
        {announcement}
      </span>
    </div>
  );
}
