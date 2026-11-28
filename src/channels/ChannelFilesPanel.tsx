import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  ChannelListStatus,
  channelListCopy,
  channelListError,
  channelListOffline,
} from "./ChannelListState.tsx";
import { ChannelSectionHeader } from "./ChannelSectionHeader.tsx";
import { readChannelFilesPage } from "./channel-files-page.ts";
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
    denied: "No access to channel files",
    more: "Show more files",
  },
  ru: {
    title: "Файлы канала",
    close: "Закрыть файлы канала",
    back: "Вернуться к сведениям о канале",
    backToChannel: "Вернуться в беседу",
    empty: "Файлов пока нет",
    hint: "Вложения из канала и его тредов появятся здесь.",
    loading: "Загружаем файлы…",
    denied: "Нет доступа к файлам",
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
  panelHeading,
  showMessage,
}: Props & { panelHeading: RefObject<HTMLHeadingElement | null> }) {
  const t = filePanelCopy[language];
  const listText = channelListCopy[language];
  const [request, setRequest] = useState({ page: 0 });
  const [retrying, setRetrying] = useState(false);
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
        setRetrying(false);
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
        setRetrying(false);
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
  const noticeHeading = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const focusIndex = useRef<number | null>(null);
  function read(page: number, button: HTMLButtonElement, retry = false) {
    if (button === document.activeElement) focusIndex.current = visible.length;
    setRetrying(retry);
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
    if (result.status === "loading" || !body.current || hidden) return;
    focusIndex.current = null;
    const active = document.activeElement;
    if (result.status === "denied") {
      if (active === document.body || active === panelHeading.current)
        noticeHeading.current?.focus({ preventScroll: true });
      return;
    }
    if (
      index === null ||
      (active !== document.body &&
        active !== retryButton.current &&
        active !== boundary.current)
    )
      return;
    const cards =
      body.current.querySelectorAll<HTMLButtonElement>(".post-file");
    const target =
      (result.status === "failed" ? retryButton.current : cards.item(index)) ??
      noticeHeading.current ??
      boundary.current ??
      cards.item(cards.length - 1);
    target?.focus({ preventScroll: true });
  }, [result, hidden, boundary, panelHeading]);
  const edge =
    request.page > 0 &&
    (result.status === "loading" || result.status === "failed");
  const loading = result.status === "loading";
  const waitingOnBoundary =
    edge && loading && !retrying && focusIndex.current !== null;
  const notice =
    result.status === "denied"
      ? { variant: "error" as const, title: t.denied }
      : result.status === "failed" || retrying
        ? channelListError(language, edge)
        : loading
          ? {
              variant: "pending" as const,
              message: edge ? listText.loadingMore : t.loading,
            }
          : !visible.length && result.isEnd
            ? { variant: "empty" as const, title: t.empty, message: t.hint }
            : null;
  return (
    <div
      className="channel-files-body"
      ref={body}
      data-channel-files=""
      aria-busy={loading || undefined}
    >
      {result.firstInaccessibleFileTime > 0 && (
        <p className="channel-file-retention">
          {searchCopy[language].retention}
        </p>
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
      <ChannelListStatus
        language={language}
        notice={waitingOnBoundary ? null : notice}
        heading={noticeHeading}
        edge={edge}
        retry={
          result.status === "failed" || retrying
            ? {
                running: retrying,
                button: retryButton,
                read: () => {
                  if (retryButton.current)
                    read(request.page, retryButton.current, true);
                },
              }
            : undefined
        }
      />
      {(next !== null || waitingOnBoundary) && (
        <button
          ref={boundary}
          className="channel-list-more"
          type="button"
          aria-busy={waitingOnBoundary || undefined}
          aria-disabled={waitingOnBoundary || undefined}
          onClick={(e) => {
            if (next !== null) read(next, e.currentTarget);
          }}
        >
          {waitingOnBoundary ? listText.loadingMore : t.more}
        </button>
      )}
    </div>
  );
}

export function ChannelFilesPanel(props: Props) {
  const t = filePanelCopy[props.language];
  const heading = useRef<HTMLHeadingElement>(null);
  const offlineHeading = useRef<HTMLHeadingElement>(null);
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
      <ChannelSectionHeader
        id={id}
        heading={heading}
        icon={<FileIcon />}
        title={t.title}
        name={props.name}
        desktopBack={!props.direct}
        backLabel={props.direct ? t.backToChannel : t.back}
        closeLabel={t.close}
        back={props.back}
        close={props.close}
      />
      {props.online ? (
        <FileList key={props.channelId} {...props} panelHeading={heading} />
      ) : (
        <ChannelListStatus
          language={props.language}
          notice={channelListOffline(props.language)}
          heading={offlineHeading}
        />
      )}
    </aside>
  );
}
