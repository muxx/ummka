import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import smallMark from "../../src-tauri/icons/symbols/ummka-small.svg?no-inline";
import { isMobile, usesMacOSOverlay } from "../build-platform.ts";
import type { EntryLanguage } from "../entry/language.ts";
import {
  PaneExpansion,
  PaneResizer,
  PaneSizeToggle,
  PaneWidthNotice,
} from "./PaneWidthControls.tsx";
import { usePaneWidths } from "./use-pane-widths.ts";
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
  accountDescription?: string;
  accountRef?: RefObject<HTMLButtonElement | null>;
  channel: { id: string; title: string } | null;
  emptyTitle: string;
  page: "navigation" | "conversation";
  onNavigation: () => void;
  onTeam: (opener: HTMLButtonElement) => void;
  onAccount: () => void;
  navigation: ReactNode;
  children: ReactNode;
  searchTrigger?: ReactNode;
  toolbar?: ReactNode;
  channelHeading?: (
    id: string,
    ref: RefObject<HTMLHeadingElement | null>,
  ) => ReactNode;
  sidePanel?: ReactNode;
  standalonePanel?: boolean;
  language?: EntryLanguage;
  resultReturn?: ReactNode;
  returnInThread?: boolean;
  composer?: ReactNode;
  draftRef?: RefObject<HTMLElement | null>;
  inboxPlaceholder?: { title: string; heading: string; hint: string };
  thread?: {
    id: string;
    title: string;
    subtitle?: string;
    controlsRef?: (node: HTMLSpanElement | null) => void;
    retainOpener?: boolean;
    content: ReactNode;
    replyRef?: RefObject<HTMLElement | null>;
    close: () => void;
  };
};

export function ThreadMark() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10 M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2" />
    </svg>
  );
}

export function Chevron({ direction }: { direction: "back" | "down" }) {
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
  accountDescription,
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
  toolbar,
  channelHeading,
  sidePanel,
  standalonePanel,
  language = "en",
  resultReturn,
  returnInThread,
  composer,
  draftRef,
  thread,
  inboxPlaceholder,
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
  const threadContextId = thread?.subtitle ? `${threadId}-context` : undefined;
  const overlay = usesMacOSOverlay;
  const channelId = channel?.id;
  const openThread = thread?.id;
  const replyRef = thread?.replyRef;
  const retainOpener = thread?.retainOpener;
  const showingPanel = Boolean(sidePanel);
  const inboxSplit = !showingPanel && Boolean(inboxPlaceholder);
  const split =
    inboxSplit || (showingPanel ? !standalonePanel : Boolean(openThread));
  const panes = usePaneWidths(
    root,
    inboxSplit ? "thread" : split ? "right" : "closed",
  );
  const geometry = panes.geometry;
  const widthStyles =
    geometry &&
    ({
      "--navigation-choice": `${geometry.navigation.width}px`,
      "--right-choice": `${panes.expanded ? geometry.right.expanded : geometry.right.width}px`,
    } as CSSProperties);
  const previous = useRef({ page, channelId, openThread });

  useLayoutEffect(() => {
    const control = lastFocus.current;
    if (
      !control?.dataset.paneWidthControl ||
      control.isConnected ||
      document.activeElement !== document.body
    )
      return;
    const toNavigation =
      (!geometry && !showingPanel && !openThread && page === "navigation") ||
      (geometry && control.dataset.paneWidthControl === "navigation");
    const target = toNavigation
      ? (sidebar.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
        team.current)
      : (root.current?.querySelector<HTMLElement>(
          ".channels-panes > aside .channels-pane-head h2",
        ) ?? heading.current);
    target?.focus({ preventScroll: true });
  });

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { page, channelId, openThread };
    if (showingPanel) return;
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
      if (
        openThread &&
        retainOpener &&
        (root.current?.clientWidth ?? 0) > 740 &&
        lastConversationControl.current?.isConnected
      ) {
        lastConversationControl.current.focus({ preventScroll: true });
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
    if (
      openThread &&
      openThread !== old.openThread &&
      (!retainOpener || !old.openThread)
    )
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
        // The timeline restores its reading position after fitting the wider pane.
        if (opener?.isConnected) opener.focus({ preventScroll: true });
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
  }, [
    page,
    channelId,
    openThread,
    draftRef,
    replyRef,
    showingPanel,
    retainOpener,
  ]);

  return (
    <div
      ref={root}
      className="channels-frame"
      style={widthStyles || undefined}
      data-macos-overlay={overlay || undefined}
      onFocusCapture={(event) => {
        lastFocus.current = event.target;
      }}
    >
      {panes.storageUnavailable && <PaneWidthNotice language={language} />}
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
        <div className="channels-bar-tools">
          {toolbar}
          <button
            ref={accountRef}
            aria-haspopup={accountRef ? "dialog" : undefined}
            className="channels-account"
            data-profile={accountName.trim() ? "ready" : "pending"}
            type="button"
            onClick={onAccount}
            aria-label={labels.account}
            aria-description={accountDescription}
            title={accountDescription ?? labels.account}
          >
            <span aria-hidden="true">
              {Array.from(accountName.trim())[0]?.toLocaleUpperCase()}
            </span>
          </button>
        </div>
      </header>
      <div
        className="channels-panes"
        data-page={sidePanel ? "details" : openThread ? "thread" : page}
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
            onClick={(event) => onTeam(event.currentTarget)}
            aria-label={`${labels.chooseTeam}, ${teamName}`}
          >
            <span>{teamName}</span>
            <Chevron direction="down" />
          </button>
          <div className="channels-pane-body">{navigation}</div>
        </nav>
        {geometry && (
          <PaneResizer
            pane="navigation"
            range={geometry.navigation}
            language={language}
            preview={panes.setPreview}
            save={panes.save}
          />
        )}
        <main
          className="channels-conversation"
          data-surface="message"
          aria-labelledby={headingId}
          onFocusCapture={(event) => {
            if (event.currentTarget.contains(event.target))
              lastConversationControl.current = event.target;
          }}
          onClickCapture={(event) => {
            if (event.target instanceof Element) {
              const control = event.target.closest<HTMLElement>(
                "button, a[href], [tabindex]",
              );
              // A dialog portaled from the feed bubbles here in React.
              if (control && event.currentTarget.contains(control))
                lastConversationControl.current = control;
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
            {channelHeading ? (
              channelHeading(headingId, heading)
            ) : (
              <h1 id={headingId} ref={heading} tabIndex={-1}>
                {channel?.title ?? emptyTitle}
              </h1>
            )}
          </header>
          {!returnInThread && resultReturn}
          <div className="channels-conversation-body">{children}</div>
          {composer}
        </main>
        {split &&
          geometry &&
          !panes.expanded &&
          geometry.right.min !== geometry.right.max && (
            <PaneResizer
              key={panes.panelKey}
              pane={panes.panelKey}
              range={geometry.right}
              language={language}
              preview={panes.setPreview}
              save={panes.save}
            />
          )}
        <PaneExpansion.Provider
          value={
            split && geometry
              ? {
                  language,
                  expanded: panes.expanded,
                  toggle: panes.toggleExpanded,
                }
              : null
          }
        >
          {sidePanel}
          {inboxPlaceholder && !sidePanel && !thread && (
            <aside
              className="channels-thread inbox-placeholder"
              aria-labelledby={threadId}
            >
              <header className="channels-pane-head">
                <ThreadMark />
                <h2 id={threadId}>{inboxPlaceholder.title}</h2>
                <PaneSizeToggle />
              </header>
              <div className="inbox-prompt">
                <ThreadMark />
                <h3>{inboxPlaceholder.heading}</h3>
                <p>{inboxPlaceholder.hint}</p>
              </div>
            </aside>
          )}
          {!sidePanel && thread && (
            <aside className="channels-thread" aria-labelledby={threadId}>
              <header className="channels-pane-head channels-thread-head">
                <div className="thread-heading">
                  <div className="thread-heading-title">
                    <ThreadMark />
                    <h2
                      id={threadId}
                      ref={threadHeading}
                      tabIndex={-1}
                      aria-describedby={threadContextId}
                    >
                      {thread.title}
                    </h2>
                  </div>
                  {threadContextId && (
                    <p id={threadContextId} className="thread-heading-context">
                      <bdi>{thread.subtitle}</bdi>
                    </p>
                  )}
                </div>
                {thread.controlsRef && (
                  <span
                    className="thread-follow-slot"
                    ref={thread.controlsRef}
                  />
                )}
                <PaneSizeToggle />
                <button
                  className="channels-icon-action thread-close"
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
        </PaneExpansion.Provider>
      </div>
    </div>
  );
}
