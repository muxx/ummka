import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { EntryLanguage } from "../entry/language.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import {
  attachmentCopy,
  attachmentName,
  attachmentSize,
  cardFiles,
  hasDetails,
  hiddenFiles,
  type PublishedFile,
} from "./post-attachment-cards.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./published-attachments.css";

type Owner = Pick<TeamWorkspace, "online" | "sessionIssue"> & {
  connection: Pick<TeamWorkspace["connection"], "readPostFiles">;
};
type Selection = {
  row: string;
  fileId: string;
  button: HTMLButtonElement;
  scope: string;
};

export function useAttachmentWindow(
  { connection, online, sessionIssue }: Owner,
  scope: string,
  roomTitle: string,
) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const activeScope = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);
  if (selected && selected.scope !== scope) setSelected(null);
  const close = useCallback(
    (row: string) =>
      setSelected((current) => (current?.row === row ? null : current)),
    [],
  );
  return useMemo(
    () => ({
      connection,
      roomTitle,
      online,
      sessionIssue,
      selected,
      activeScope,
      close,
      open(row: string, fileId: string, button: HTMLButtonElement) {
        setSelected({ row, fileId, button, scope });
      },
    }),
    [connection, roomTitle, online, sessionIssue, selected, close, scope],
  );
}
export const AttachmentWindow = createContext<ReturnType<
  typeof useAttachmentWindow
> | null>(null);

type DetailState =
  | { kind: "loading" | "unavailable" | "failure" | "idle" | "denied" | "gone" }
  | { kind: "ready"; file: PublishedFile };
function FileDetails({
  postId,
  channelId,
  file,
  authorName,
  fallback,
  language,
  selection,
  window,
}: {
  postId: string;
  channelId: string;
  file: PublishedFile;
  authorName: string;
  fallback: string;
  language: EntryLanguage;
  selection: Selection;
  window: ReturnType<typeof useAttachmentWindow>;
}) {
  const text = attachmentCopy[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const [attempt, setAttempt] = useState(window.online ? 1 : 0);
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const { connection, online, activeScope } = window;
  const known = hasDetails(file);
  const failedSession = useEffectEvent((issue: "session" | "unauthorized") =>
    window.sessionIssue(issue),
  );
  if (!online && attempt) setAttempt(0);
  useEffect(() => {
    if (known || !attempt || !online) return;
    const request = new AbortController();
    setState({ kind: "loading" });
    void connection.readPostFiles(channelId, postId, request.signal).then(
      (files) => {
        if (request.signal.aborted) return;
        const found = files.find((entry) => entry.id === file.id);
        setState(
          found && hasDetails(found)
            ? { kind: "ready", file: found }
            : { kind: "unavailable" },
        );
      },
      (error) => {
        if (request.signal.aborted) return;
        const cause = workspaceFailure(error, "network");
        if (cause === "session" || cause === "unauthorized")
          failedSession(cause);
        setState({
          kind:
            cause === "forbidden"
              ? error instanceof ResponseError && error.response.status === 404
                ? "gone"
                : "denied"
              : cause === "session" || cause === "unauthorized"
                ? "unavailable"
                : "failure",
        });
      },
    );
    return () => request.abort();
  }, [connection, channelId, postId, file.id, known, attempt, online]);
  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const button = selection.button;
    const article = button.closest<HTMLElement>("[data-post-id]");
    const pane = article?.closest<HTMLElement>(".timeline-scroll");
    modal.showModal();
    closeButton.current?.focus();
    return () => {
      const ownedFocus =
        modal.contains(document.activeElement) ||
        document.activeElement === document.body;
      modal.close();
      if (!ownedFocus) return;
      queueMicrotask(() => {
        if (
          activeScope.current !== selection.scope ||
          !pane?.isConnected ||
          (document.activeElement !== document.body &&
            document.activeElement !== article &&
            document.activeElement !== button)
        )
          return;
        const row = article?.isConnected
          ? article
          : pane.querySelector<HTMLElement>(
              `[data-post-id="${CSS.escape(postId)}"]`,
            );
        const target = button.isConnected
          ? button
          : (row?.querySelector<HTMLButtonElement>(
              `[data-file-id="${CSS.escape(selection.fileId)}"]`,
            ) ?? row);
        if (target && target === row && !target.hasAttribute("tabindex"))
          target.tabIndex = -1;
        if (target?.getClientRects().length)
          target.focus({ preventScroll: true });
      });
    };
  }, [selection, postId, activeScope]);
  const displayed = known ? file : state.kind === "ready" ? state.file : null;
  const name = displayed?.name?.trim() || fallback;
  const extension =
    displayed?.extension?.trim() ||
    /\.([a-z0-9]{1,8})$/i.exec(displayed?.name ?? "")?.[1];
  const type = extension?.toUpperCase() || displayed?.mimeType?.trim();
  const inThread = Boolean(selection.button.closest(".thread-feed"));
  const status = !online
    ? "offline"
    : !attempt
      ? state.kind === "idle"
        ? "idle"
        : "ready"
      : state.kind;
  return createPortal(
    <dialog
      ref={dialog}
      className="attachment-details modal-layout"
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault();
        window.close(selection.row);
      }}
    >
      <header>
        <div>
          <h2 id={heading}>{name}</h2>
        </div>
        <button
          type="button"
          ref={closeButton}
          aria-label={text.close}
          onClick={() => window.close(selection.row)}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <section
        className="modal-scroll attachment-body"
        aria-label={text.details}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: File metadata must remain keyboard-scrollable in a short window.
        tabIndex={0}
      >
        <p className="attachment-room">
          {authorName} ·{" "}
          {inThread ? `${text.inThread} ${window.roomTitle}` : window.roomTitle}
        </p>
        {displayed ? (
          <>
            <dl>
              {displayed.name?.trim() && (
                <>
                  <dt>{text.name}</dt>
                  <dd>{displayed.name}</dd>
                </>
              )}
              {displayed.size !== undefined && (
                <>
                  <dt>{text.size}</dt>
                  <dd>
                    {displayed.size === 0
                      ? text.emptySize
                      : attachmentSize(displayed.size, language)}
                  </dd>
                </>
              )}
              {type && (
                <>
                  <dt>{text.type}</dt>
                  <dd>{type}</dd>
                </>
              )}
              {Boolean(displayed.width && displayed.height) && (
                <>
                  <dt>{text.dimensions}</dt>
                  <dd>
                    {displayed.width} × {displayed.height} px
                  </dd>
                </>
              )}
            </dl>
            {displayed.archived && <p>{text.archived}</p>}
          </>
        ) : (
          <div className="attachment-status">
            <div role="status">
              {status === "loading" ? (
                <>
                  <h3>{text.pending}</h3>
                  <p>{text.serverDetail}</p>
                </>
              ) : status === "offline" ||
                status === "ready" ||
                status === "idle" ? (
                <>
                  <h3>
                    {status === "idle" ? text.idleTitle : text.offlineTitle}
                  </h3>
                  <p>{text[status]}</p>
                </>
              ) : (
                <p>{text[status]}</p>
              )}
            </div>
            {status === "loading" && (
              <button
                type="button"
                onClick={() => {
                  setAttempt(0);
                  setState({ kind: "idle" });
                }}
              >
                {text.cancel}
              </button>
            )}
            {["offline", "ready", "idle", "failure"].includes(status) && (
              <button
                type="button"
                disabled={!online}
                onClick={() => {
                  setState({ kind: "loading" });
                  setAttempt((n) => n + 1);
                }}
              >
                {status === "failure" ? text.retry : text.load}
              </button>
            )}
          </div>
        )}
      </section>
    </dialog>,
    document.body,
  );
}

export function PublishedAttachments({
  post,
  authorName,
  language,
}: {
  post: LocalPost;
  authorName: string;
  language: EntryLanguage;
}) {
  const window = useContext(AttachmentWindow);
  const row = useId();
  const observation = post.attachments;
  const files = useMemo(
    () => (observation ? cardFiles(observation) : []),
    [observation],
  );
  const text = attachmentCopy[language];
  const selected = window?.selected?.row === row ? window.selected : null;
  const file = selected && files.find((entry) => entry.id === selected.fileId);
  const close = window?.close;
  useLayoutEffect(() => () => close?.(row), [close, row]);
  useLayoutEffect(() => {
    if (selected && !file) close?.(row);
  }, [selected, file, close, row]);
  if (observation?.redactedFileCount)
    return (
      <p className="attachment-hidden">
        {hiddenFiles(observation.redactedFileCount, language)}
      </p>
    );
  if (!files.length || !window) return null;
  return (
    <>
      <ul className="post-files">
        {files.map((item, i) => {
          const name = attachmentName(item, i + 1, language);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="post-file"
                data-file-id={item.id}
                data-unnamed={!hasDetails(item) || undefined}
                aria-label={[
                  `${text.open} ${item.name?.trim() || i + 1}`,
                  item.size !== undefined &&
                    attachmentSize(item.size, language),
                  !hasDetails(item) && text.onServer,
                  item.archived && text.archived,
                ]
                  .filter(Boolean)
                  .join(", ")}
                onClick={(event) =>
                  window.open(row, item.id, event.currentTarget)
                }
              >
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  {item.mimeType?.startsWith("image/") ? (
                    <>
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <circle cx="8" cy="9" r="1" />
                      <path d="m4 17 5-5 3 3 3-4 5 6" />
                    </>
                  ) : (
                    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5" />
                  )}
                </svg>
                <bdi className="post-file-name">{name}</bdi>
                {item.size !== undefined && (
                  <small>{attachmentSize(item.size, language)}</small>
                )}
                {!hasDetails(item) && <small>{text.onServer}</small>}
                {item.archived && <small>{text.archived}</small>}
              </button>
            </li>
          );
        })}
      </ul>
      {selected && file && (
        <FileDetails
          key={file.id}
          postId={post.id}
          channelId={post.channelId}
          file={file}
          authorName={authorName}
          fallback={`${text.file} ${files.indexOf(file) + 1}`}
          language={language}
          selection={selected}
          window={window}
        />
      )}
    </>
  );
}
