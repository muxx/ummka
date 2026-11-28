import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { readChannelFilesPage } from "./channel-files-page.ts";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { ChannelFileCard } from "./PublishedAttachments.tsx";
import { searchCopy } from "./search-copy.ts";
import { useNextPageButton } from "./use-next-page-button.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

export const filePanelCopy = {
  en: {
    title: "Channel files",
    close: "Close channel files",
    back: "Back to channel info",
    backToChannel: "Back to conversation",
    empty: "No files yet",
    hint: "Attachments from the channel and its threads will appear here.",
    loading: "Loading files…",
    denied: "Channel files are unavailable.",
    failed: "Couldn’t load channel files.",
    offline: "Connect to see channel files.",
    retry: "Try again",
    more: "Show more files",
  },
  ru: {
    title: "Файлы канала",
    close: "Закрыть файлы канала",
    back: "Вернуться к сведениям о канале",
    backToChannel: "Вернуться в беседу",
    empty: "Файлов пока нет",
    hint: "Вложения из канала и его тредов появятся здесь.",
    loading: "Загрузка файлов…",
    denied: "Файлы канала недоступны.",
    failed: "Не удалось загрузить файлы канала.",
    offline: "Подключитесь к сети, чтобы увидеть файлы канала.",
    retry: "Повторить",
    more: "Показать ещё файлы",
  },
};
export function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5" />
    </svg>
  );
}
type Props = {
  account: Pick<
    WorkspaceConnection,
    "readChannelIdentity" | "readFileSearchPage" | "readChannelFile"
  >;
  teamId: string;
  channelId: string;
  name: string;
  language: EntryLanguage;
  online: boolean;
  hidden: boolean;
  restoreButton?: HTMLButtonElement;
  back: () => void;
  direct?: boolean;
  close: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
  showMessage: (postId: string, button: HTMLButtonElement) => void;
};
type Page = Awaited<ReturnType<typeof readChannelFilesPage>>;
type Result = Pick<Page, "items" | "firstInaccessibleFileTime" | "isEnd"> & {
  status: "loading" | "ready" | "failed" | "denied";
};
const initial: Result = {
  items: [],
  firstInaccessibleFileTime: 0,
  isEnd: false,
  status: "loading",
};

function FileList({
  account,
  teamId,
  channelId,
  language,
  sessionIssue,
  hidden,
  showMessage,
}: Props) {
  const t = filePanelCopy[language];
  const [request, setRequest] = useState({ page: 0 });
  const [result, setResult] = useState(initial);
  const report = useEffectEvent(sessionIssue);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    void readChannelFilesPage(
      account,
      teamId,
      channelId,
      request.page,
      signal,
    ).then(
      (page) => {
        if (signal.aborted) return;
        setResult((old) => {
          const rows = new Map(old.items.map((file) => [file.id, file]));
          for (const file of page.items) rows.set(file.id, file);
          return {
            items: [...rows.values()],
            status: "ready",
            isEnd: page.isEnd,
            firstInaccessibleFileTime: Math.max(
              old.firstInaccessibleFileTime,
              page.firstInaccessibleFileTime,
            ),
          };
        });
      },
      (error: unknown) => {
        if (signal.aborted) return;
        const failure = workspaceFailure(error, "network");
        if (failure === "session" || failure === "unauthorized")
          report(failure);
        if (
          failure === "forbidden" ||
          failure === "session" ||
          failure === "unauthorized"
        )
          setResult({ ...initial, status: "denied" });
        else setResult((old) => ({ ...old, status: "failed" }));
      },
    );
    return () => controller.abort();
  }, [account, teamId, channelId, request]);
  const visible = result.items.filter((f) => f.name?.trim());
  const body = useRef<HTMLDivElement>(null);
  const focusIndex = useRef<number | null>(null);
  function read(page: number, button: HTMLButtonElement) {
    if (button === document.activeElement) focusIndex.current = visible.length;
    setResult((old) => ({ ...old, status: "loading" }));
    setRequest({ page });
  }
  const next =
    !hidden && result.status === "ready" && !result.isEnd
      ? request.page + 1
      : null;
  const boundary = useNextPageButton(next, read);
  useLayoutEffect(() => {
    const index = focusIndex.current;
    if (index === null || result.status === "loading" || !body.current) return;
    focusIndex.current = null;
    if (document.activeElement !== document.body || hidden) return;
    const cards =
      body.current.querySelectorAll<HTMLButtonElement>(".post-file");
    const target =
      cards.item(index) ??
      body.current.querySelector<HTMLElement>(
        ".channel-files-control, [role=alert], .channel-files-empty",
      ) ??
      cards.item(cards.length - 1);
    target?.focus();
  }, [result, hidden]);
  return (
    <div className="channel-files-body" ref={body} data-channel-files="">
      {result.firstInaccessibleFileTime > 0 && (
        <p>{searchCopy[language].retention}</p>
      )}
      {visible.length > 0 && (
        <ul className="post-files channel-files-list">
          {visible.map((file, i) => (
            <li key={file.id}>
              <ChannelFileCard
                file={file}
                index={i}
                language={language}
                read={(signal) =>
                  account.readChannelFile(channelId, file.id, signal)
                }
                showMessage={showMessage}
              />
            </li>
          ))}
        </ul>
      )}
      {result.status === "ready" && !visible.length && result.isEnd && (
        <div className="channel-files-empty" role="status" tabIndex={-1}>
          <FileIcon />
          <h3>{t.empty}</h3>
          <p>{t.hint}</p>
        </div>
      )}
      {result.status === "loading" && <p role="status">{t.loading}</p>}
      {result.status === "denied" && (
        <p role="alert" tabIndex={-1}>
          {t.denied}
        </p>
      )}
      {result.status === "failed" && <p role="alert">{t.failed}</p>}
      {result.status === "failed" && (
        <button
          type="button"
          className="channel-files-control"
          onClick={(e) => read(request.page, e.currentTarget)}
        >
          {t.retry}
        </button>
      )}
      {next !== null && (
        <button
          ref={boundary}
          className="channel-files-control"
          type="button"
          onClick={(e) => read(next, e.currentTarget)}
        >
          {t.more}
        </button>
      )}
    </div>
  );
}

export function ChannelFilesPanel(props: Props) {
  const t = filePanelCopy[props.language];
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const returnFocus = useEffectEvent(() => {
    const button = props.restoreButton;
    (button?.isConnected ? button : heading.current)?.focus({
      preventScroll: true,
    });
  });
  useLayoutEffect(() => {
    if (!props.hidden) returnFocus();
  }, [props.hidden]);
  return (
    <aside
      hidden={props.hidden}
      style={props.hidden ? { display: "none" } : undefined}
      className="channels-thread channel-information channel-context-pane channel-files-panel"
      aria-labelledby={id}
    >
      <header className="channels-pane-head">
        <button
          type="button"
          className="channels-icon-action"
          aria-label={props.direct ? t.backToChannel : t.back}
          onClick={props.back}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m11 5-7 7 7 7M4 12h16" />
          </svg>
        </button>
        <div className="channels-pane-titles">
          <h2 id={id} tabIndex={-1} ref={heading}>
            <FileIcon />
            {t.title}
          </h2>
          <p>{props.name}</p>
        </div>
        <PaneSizeToggle />
        <button
          type="button"
          className="channels-icon-action channel-files-close"
          aria-label={t.close}
          onClick={props.close}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m6 6 12 12m0-12L6 18" />
          </svg>
        </button>
      </header>
      {props.online ? (
        <FileList key={props.channelId} {...props} />
      ) : (
        <p className="channel-files-body" role="status">
          {t.offline}
        </p>
      )}
    </aside>
  );
}
