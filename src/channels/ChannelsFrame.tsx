import {
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import smallMark from "../../src-tauri/icons/symbols/ummka-small.svg?no-inline";
import { isMobile, usesMacOSOverlay } from "../build-platform.ts";
import "./frame.css";

type FrameLabels = {
  navigation: string;
  chooseTeam: string;
  account: string;
  closeThread: string;
};

type FrameProps = {
  labels: FrameLabels;
  teamName: string;
  accountName: string;
  accountRef?: RefObject<HTMLButtonElement | null>;
  channel: { id: string; title: string } | null;
  emptyTitle: string;
  page: "navigation" | "conversation";
  onNavigation: () => void;
  onTeam: () => void;
  onAccount: () => void;
  navigation: ReactNode;
  children: ReactNode;
  searchTrigger?: ReactNode;
  searchPanel?: ReactNode;
  resultReturn?: ReactNode;
  returnInThread?: boolean;
  composer?: ReactNode;
  draftRef?: RefObject<HTMLElement | null>;
  thread?: {
    id: string;
    title: string;
    content: ReactNode;
    replyRef?: RefObject<HTMLElement | null>;
    close: () => void;
  };
};

function Chevron({ direction }: { direction: "back" | "down" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "back" ? "m14 5-7 7 7 7" : "m6 9 6 6 6-6"} />
    </svg>
  );
}

export function ChannelsFrame({
  labels,
  teamName,
  accountName,
  accountRef,
  channel,
  emptyTitle,
  page,
  onNavigation,
  onTeam,
  onAccount,
  navigation,
  children,
  searchTrigger,
  searchPanel,
  resultReturn,
  returnInThread,
  composer,
  draftRef,
  thread,
}: FrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const team = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const threadHeading = useRef<HTMLHeadingElement>(null);
  const lastConversationControl = useRef<HTMLElement>(null);
  const threadOpener = useRef<HTMLElement>(null);
  const lastFocus = useRef<HTMLElement>(null);
  const headingId = useId();
  const threadId = useId();
  const overlay = usesMacOSOverlay;
  const channelId = channel?.id;
  const openThread = thread?.id;
  const replyRef = thread?.replyRef;
  const showingSearch = Boolean(searchPanel);
  const previous = useRef({ page, channelId, openThread });

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { page, channelId, openThread };
    if (showingSearch) return;
    function focusNavigation() {
      const current = sidebar.current?.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      (current ?? team.current)?.focus();
    }
    function focusVisiblePane() {
      if (!openThread && page === "navigation") {
        focusNavigation();
        return;
      }
      const field = openThread ? replyRef?.current : draftRef?.current;
      // Compact layouts focus the title so navigating never raises the on-screen keyboard.
      if (field && (root.current?.clientWidth ?? 0) > 740) {
        field.focus();
        if (document.activeElement === field) return;
      }
      (openThread ? threadHeading : heading).current?.focus();
    }
    if (channelId !== old.channelId) {
      lastConversationControl.current = null;
      threadOpener.current = null;
    }
    if (openThread && openThread !== old.openThread)
      threadOpener.current = lastConversationControl.current;
    if (
      openThread !== old.openThread ||
      page !== old.page ||
      channelId !== old.channelId
    ) {
      const opener = threadOpener.current;
      if (!openThread) threadOpener.current = null;
      if (
        old.openThread &&
        !openThread &&
        page === "conversation" &&
        channelId === old.channelId
      ) {
        if (opener?.isConnected) opener.focus();
        if (!opener?.isConnected || document.activeElement !== opener)
          heading.current?.focus();
      } else focusVisiblePane();
    }
    const scene = root.current;
    if (!scene) return;
    const observer = new ResizeObserver(() => {
      const el = lastFocus.current;
      if (!el?.isConnected || el.getClientRects().length > 0) return;
      const active = document.activeElement;
      if (active === document.body || scene.contains(active))
        focusVisiblePane();
    });
    observer.observe(scene);
    return () => observer.disconnect();
  }, [page, channelId, openThread, draftRef, replyRef, showingSearch]);

  return (
    <div
      ref={root}
      className="channels-frame"
      data-macos-overlay={overlay || undefined}
      onFocusCapture={(event) => {
        lastFocus.current = event.target;
      }}
    >
      <header
        className="channels-bar"
        data-surface="topbar"
        data-tauri-drag-region={overlay || undefined}
      >
        <div
          className="channels-bar-brand"
          data-tauri-drag-region={overlay || undefined}
        >
          {isMobile && (
            <img
              className="channels-brand-mark"
              src={smallMark}
              alt="ummka"
              width="24"
              height="24"
            />
          )}
        </div>
        {searchTrigger}
        <button
          ref={accountRef}
          aria-haspopup={accountRef ? "dialog" : undefined}
          className="channels-account"
          type="button"
          onClick={onAccount}
          aria-label={labels.account}
          title={labels.account}
        >
          <span aria-hidden="true">
            {Array.from(accountName.trim())[0]?.toLocaleUpperCase() || "•"}
          </span>
        </button>
      </header>
      <div
        className="channels-panes"
        data-page={searchPanel ? "search" : openThread ? "thread" : page}
      >
        <nav
          ref={sidebar}
          className="channels-sidebar"
          data-surface="navigation"
          aria-label={labels.navigation}
        >
          <button
            ref={team}
            className="channels-team"
            type="button"
            onClick={onTeam}
            aria-label={`${labels.chooseTeam}, ${teamName}`}
          >
            <span>{teamName}</span>
            <Chevron direction="down" />
          </button>
          <div className="channels-pane-body">{navigation}</div>
        </nav>
        <main
          className="channels-conversation"
          data-surface="message"
          aria-labelledby={headingId}
          onFocusCapture={(event) => {
            lastConversationControl.current = event.target;
          }}
          onClickCapture={(event) => {
            if (event.target instanceof Element) {
              const control = event.target.closest<HTMLElement>(
                "button, a[href], [tabindex]",
              );
              if (control) lastConversationControl.current = control;
            }
          }}
        >
          <header className="channels-pane-head">
            <button
              type="button"
              className="channels-mobile-back channels-icon-action"
              aria-label={labels.navigation}
              onClick={onNavigation}
            >
              <Chevron direction="back" />
            </button>
            <h1 id={headingId} ref={heading} tabIndex={-1}>
              {channel?.title ?? emptyTitle}
            </h1>
          </header>
          {!returnInThread && resultReturn}
          <div className="channels-conversation-body">{children}</div>
          {composer}
        </main>
        {searchPanel}
        {!searchPanel && thread && (
          <aside className="channels-thread" aria-labelledby={threadId}>
            <header className="channels-pane-head">
              <h2 id={threadId} ref={threadHeading} tabIndex={-1}>
                {thread.title}
              </h2>
              <button
                className="channels-icon-action"
                type="button"
                aria-label={labels.closeThread}
                onClick={thread.close}
              >
                <span className="thread-back-icon">
                  <Chevron direction="back" />
                </span>
                <svg
                  className="thread-close-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </header>
            {returnInThread && resultReturn}
            <div className="channels-pane-body">{thread.content}</div>
          </aside>
        )}
      </div>
    </div>
  );
}
