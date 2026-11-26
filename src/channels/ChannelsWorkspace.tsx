import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isMobile } from "../build-platform.ts";
import { AccountSessionWindow } from "../entry/AccountSessionWindow.tsx";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { EntryLanguage } from "../entry/language.ts";
import { savedChannelPermissions } from "../mattermost/channel-permissions.ts";
import {
  conversationName,
  directPartnerId,
  indexChannelProfiles,
  teammateName,
} from "../mattermost/channel-profiles.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import { isMattermostId } from "../mattermost/model-fields.ts";
import { visibleSidebar } from "../mattermost/sidebar-rows.ts";
import { effectiveWorkspacePreferences } from "../mattermost/workspace-preferences.ts";
import { ChannelsFrame } from "./ChannelsFrame.tsx";
import { CollectionChannelMenu } from "./CollectionChannelMenu.tsx";
import { ComposerAccessNotice } from "./ComposerAccessNotice.tsx";
import { ConversationTimeline } from "./ConversationTimeline.tsx";
import { channelDraftActions } from "./channel-draft-actions.ts";
import { collectionCopy } from "./collection-copy.ts";
import { channelComposerAccess } from "./composer-access.ts";
import { DraftComposer } from "./DraftComposer.tsx";
import { draftCopy } from "./draft-copy.ts";
import { channelDirectoryCopy } from "./JoinedChannelDirectory.tsx";
import { CollectionMark, PostCollectionPane } from "./PostCollectionPane.tsx";
import { PrivateChannelIcon } from "./PrivateChannelIcon.tsx";
import type { ReactionThread } from "./submit-channel-reaction.ts";
import { TeamChannelDirectory } from "./TeamChannelDirectory.tsx";
import { ThreadPane } from "./ThreadPane.tsx";
import { useChannelTimeline } from "./use-channel-timeline.ts";
import { useWorkspaceBack } from "./use-workspace-back.ts";
import { useWorkspaceCollections } from "./use-workspace-collections.ts";
import { useWorkspaceProfiles } from "./use-workspace-profiles.ts";
import { useTeamRoles, useWorkspaceRead } from "./use-workspace-read.ts";
import { useWorkspaceSearch } from "./use-workspace-search.tsx";
import { workspaceCopy } from "./workspace-copy.ts";
import { openingChannel, workspaceProfileQuery } from "./workspace-data.ts";
import "./workspace.css";

type Sections = ReturnType<typeof visibleSidebar>;
function Sidebar({
  sections,
  choose,
  language,
}: {
  sections: Sections;
  choose: (id: string) => void;
  language: EntryLanguage;
}) {
  const text = workspaceCopy[language],
    prefix = useId();
  return (
    <section className="workspace-categories" aria-label={text.sidebar}>
      {sections
        .filter(
          (section) =>
            section.rows.length ||
            section.kind === "custom" ||
            section.kind === "managed",
        )
        .map((section, i) => (
          <section key={section.id} aria-labelledby={`${prefix}-${i}`}>
            <h2 id={`${prefix}-${i}`}>{section.title}</h2>
            <ul>
              {section.rows.map((row) => (
                <li key={row.id}>
                  <button
                    className="workspace-row"
                    type="button"
                    aria-current={row.current ? "page" : undefined}
                    aria-description={
                      row.kind === "P" ? text.privateChannel : undefined
                    }
                    data-unread={row.unread || undefined}
                    onClick={() => choose(row.id)}
                  >
                    <span className="workspace-kind" aria-hidden="true">
                      {row.kind === "P" ? (
                        <PrivateChannelIcon />
                      ) : row.kind === "D" ? (
                        "@"
                      ) : row.kind === "G" ? (
                        "••"
                      ) : (
                        "#"
                      )}
                    </span>
                    <span className="workspace-row-name" title={row.title}>
                      {row.title}
                    </span>
                    {row.archived && (
                      <span
                        className="workspace-state"
                        role="img"
                        title={text.archived}
                        aria-label={text.archived}
                      >
                        ▤
                      </span>
                    )}
                    {row.muted && (
                      <span
                        className="workspace-state"
                        role="img"
                        title={text.muted}
                        aria-label={text.muted}
                      >
                        ◌
                      </span>
                    )}
                    {row.mentions > 0 ? (
                      <span
                        className="workspace-count"
                        role="img"
                        aria-label={text.formatMentions(row.mentions)}
                      >
                        {row.mentions}
                      </span>
                    ) : (
                      row.unread && (
                        <span
                          className="workspace-unread"
                          role="img"
                          aria-label={text.unread}
                        />
                      )
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </section>
  );
}
function Notice({
  message,
  retry,
  label,
  alert = false,
}: {
  message: string;
  retry?: () => void;
  label: string;
  alert?: boolean;
}) {
  return (
    <div className="workspace-notice" role={alert ? "alert" : "status"}>
      <span>{message}</span>
      {retry && (
        <button type="button" onClick={retry}>
          {label}
        </button>
      )}
    </div>
  );
}
export function ChannelsWorkspace({
  workspace,
  language,
  onEnded,
}: {
  workspace: TeamWorkspace;
  language: EntryLanguage;
  onEnded: () => void;
}) {
  const { connection, team, userId, policy, online, sessionIssue } = workspace;
  const text = workspaceCopy[language];
  const host = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const replyField = useRef<HTMLTextAreaElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const collections = useWorkspaceCollections(connection, online);
  const collectionLabels = collectionCopy[language];
  const channelMenuButton = useRef<HTMLButtonElement>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const restoreDirectoryFocus = useRef(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const directoryTitle = channelDirectoryCopy[language].title;
  useLayoutEffect(() => {
    if (!directoryOpen && restoreDirectoryFocus.current) {
      restoreDirectoryFocus.current = false;
      directoryButton.current?.focus();
    }
  }, [directoryOpen]);
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [knownSaves, setKnownSaves] = useState<{
    ids: ReadonlySet<string>;
    complete: boolean;
  }>(() => ({ ids: new Set(), complete: false }));
  const savedValue =
    collections.view?.source.kind === "all" ? collections.state : null;
  const savedItems = savedValue?.value?.items;
  const hasSavedView = Boolean(savedValue);
  const complete =
    savedValue?.status === "ready" && savedValue.continuation === "none";
  useEffect(() => {
    if (hasSavedView)
      setKnownSaves({
        ids: new Set(savedItems?.map((post) => post.id)),
        complete,
      });
  }, [hasSavedView, savedItems, complete]);
  const returnToAccount = useRef(false);
  useLayoutEffect(() => {
    if (!accountOpen && returnToAccount.current) {
      returnToAccount.current = false;
      accountButton.current?.focus();
    }
  }, [accountOpen]);
  useLayoutEffect(() => {
    host.current?.querySelector<HTMLButtonElement>(".channels-team")?.focus();
  }, []);
  const [compact, setCompact] = useState(false);
  const [page, setPage] = useState<"navigation" | "conversation">(
    "conversation",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<LocalPost | null>(null);
  const position =
    workspace.messages.position?.request.teamId === team.id &&
    workspace.messages.position.request.rid === connection.rid &&
    !workspace.messages.position.system?.signal.aborted
      ? workspace.messages.position
      : null;
  const [confirmedThread, setConfirmedThread] =
    useState<TeamWorkspace["systemPost"]>();
  const [closedRequest, setClosedRequest] = useState<number | null>(null);
  const closeThread = useCallback(() => {
    position?.system?.stop("paused");
    setThread(null);
    setClosedRequest(position?.request.requestId ?? null);
  }, [position]);
  const [choiceFailed, setChoiceFailed] = useState(false);
  const suppressLatest = useRef(Boolean(workspace.systemPost));
  if (!workspace.systemPost || position?.system) suppressLatest.current = false;
  const choice = useRef(0);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      choice.current++;
    };
  }, []);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const size = () => setCompact(node.clientWidth <= 740);
    size();
    const observer = new ResizeObserver(size);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const read = useCallback(
    () => connection.readTeamSidebar(team.id),
    [connection, team.id],
  );
  const refresh = useCallback(
    (signal: AbortSignal) => connection.refreshTeamSidebar(team.id, signal),
    [connection, team.id],
  );
  const directory = useWorkspaceRead(team.id, online, read, refresh);
  const roles = useTeamRoles(
    connection,
    team,
    online && directory.state.status === "ready",
  );
  const permission = useMemo(
    () => savedChannelPermissions(roles.state.value, team.roles),
    [roles.state.value, team.roles],
  );
  // The verified sidebar may contain a newly joined channel. Yield to the next
  // publication from the team's existing observer, including loss of access.
  const published = directory.state.value;
  const status = directory.state.status;
  const [handoff, setHandoff] = useState({ position, published, status });
  if (position !== handoff.position) {
    setHandoff({ position, published, status });
    if (position) setDirectoryOpen(false);
  }
  const snapshot =
    position &&
    (position !== handoff.position ||
      (handoff.published === published && handoff.status === status)) &&
    !["forbidden", "unauthorized", "session"].includes(status)
      ? position.sidebar
      : published;
  const channel = useMemo(
    () =>
      snapshot
        ? position
          ? (snapshot.data.channels.find(
              (c) => c.id === position.request.post.channelId,
            ) ?? null)
          : (snapshot.data.channels.find((c) => c.id === selected) ??
            openingChannel(snapshot, language))
        : null,
    [snapshot, selected, language, position],
  );
  const chosen = channel?.id ?? null;
  const recent = useRef(new Set<string>());
  useEffect(() => {
    if (chosen) {
      recent.current.delete(chosen);
      recent.current.add(chosen);
    }
  }, [chosen]);
  const settings = useMemo(
    () =>
      policy.user && policy.server.value
        ? effectiveWorkspacePreferences(policy.user, policy.server.value)
        : null,
    [policy.user, policy.server.value],
  );
  const timeline = useChannelTimeline(
    connection,
    team.id,
    suppressLatest.current ? null : chosen,
    settings?.collapsedThreads ?? null,
    online,
    sessionIssue,
    position?.request,
  );
  const current = useMemo(
    () =>
      snapshot
        ? { ...snapshot, selectedChannel: directoryOpen ? null : chosen }
        : null,
    [snapshot, chosen, directoryOpen],
  );
  const savedChannelIds = useMemo(
    () => new Set(savedItems?.map((post) => post.channelId)),
    [savedItems],
  );
  const profileQuery = useMemo(() => {
    const query = workspaceProfileQuery(
      userId,
      current,
      settings,
      timeline.page,
      savedChannelIds,
    );
    const ids = new Set(query.ids);
    for (const post of collections.state?.value?.items ?? [])
      if (isMattermostId(post.userId)) ids.add(post.userId);
    return { ...query, ids: [...ids] };
  }, [
    userId,
    current,
    settings,
    timeline.page,
    collections.state?.value,
    savedChannelIds,
  ]);
  const saved = useWorkspaceProfiles(
    connection,
    profileQuery,
    online,
    sessionIssue,
  );
  const profiles = useMemo(
    () => indexChannelProfiles(Object.values(saved.profiles), saved.usernames),
    [saved],
  );
  const sections = useMemo(
    () =>
      current && settings
        ? visibleSidebar(current, {
            userId,
            preferences: settings,
            profiles,
            locale: language,
            compact,
          })
        : [],
    [current, settings, userId, profiles, language, compact],
  );
  const channels = snapshot?.data.channels;
  const savedRooms = useMemo(() => {
    const result = new Map<string, { title: string; kind: string }>();
    if (!channels || !savedChannelIds.size) return result;
    for (const room of channels) {
      if (!savedChannelIds.has(room.id)) continue;
      const title = conversationName(
        room,
        userId,
        profiles,
        settings?.nameFormat ?? "username",
        language,
      );
      result.set(room.id, { title, kind: room.kind });
    }
    return result;
  }, [
    channels,
    savedChannelIds,
    userId,
    profiles,
    settings?.nameFormat,
    language,
  ]);
  const selectedLabel = sections
    .flatMap((section) => section.rows)
    .find((row) => row.id === chosen)?.title;
  const draftText = draftCopy[language];
  function draftLabel() {
    if (!channel) return draftText.generic;
    if (channel.kind !== "D" && channel.kind !== "G")
      return draftText.channel(channel.displayName || channel.name);
    if (
      channel.kind === "D" &&
      directPartnerId(channel.name, userId) === userId
    )
      return draftText.self;
    const name =
      settings &&
      conversationName(
        channel,
        userId,
        profiles,
        settings.nameFormat,
        language,
      );
    return name ? draftText.direct(name) : draftText.generic;
  }
  useEffect(() => {
    for (const issue of [
      directory.state.status,
      policy.server.status,
      roles.state.status,
    ])
      if (issue === "session" || issue === "unauthorized") {
        sessionIssue(issue);
        return;
      }
  }, [
    sessionIssue,
    directory.state.status,
    policy.server.status,
    roles.state.status,
  ]);

  function choose(id: string, returning = false) {
    setDirectoryOpen(false);
    search.abortPending();
    if (!returning) collections.close(false);
    setChannelMenuOpen(false);
    if (!returning && (position || search.origin)) search.dismiss();
    workspace.messages.clear();
    const version = ++choice.current;
    if (id !== chosen) closeThread();
    setSelected(id);
    setPage("conversation");
    setChoiceFailed(false);
    void workspace.messages.enqueue(async () => {
      if (!active.current || version !== choice.current) return false;
      try {
        if (await connection.selectSidebarChannel(team.id, id)) return true;
      } catch {
        /* The local choice is acknowledged only by SQLite. */
      }
      if (active.current && version === choice.current) {
        setSelected(null);
        setChoiceFailed(true);
      }
      return false;
    });
  }
  const access = channelComposerAccess({
    channel: channel ?? undefined,
    permission: permission(channel ?? undefined, "create_post"),
    userId,
    profiles: profiles.byId,
    sharedChannelDMs: policy.server.value?.sharedChannelDMs,
  });
  function closeChannel() {
    if (!snapshot) return;
    const available = snapshot.data.channels.filter((room) => {
      if (room.id === chosen || room.deleteAt) return false;
      const peer = room.kind === "D" && directPartnerId(room.name, userId);
      return !peer || !profiles.byId.get(peer)?.deleteAt;
    });
    const ids = new Set(available.map((room) => room.id));
    const previous = [...recent.current].reverse().find((id) => ids.has(id));
    const canJoin = permission("team", "join_public_channels");
    const target =
      previous ??
      (canJoin === "denied"
        ? openingChannel(
            {
              selectedChannel: null,
              data: { ...snapshot.data, channels: available },
            },
            language,
          )?.id
        : available.find(
            (room) => room.kind === "O" && room.name === "town-square",
          )?.id);
    if (target) choose(target);
    else workspace.chooseAnotherTeam();
  }
  function retryPostingAccess() {
    if (
      !online ||
      (status === "ready" &&
        ["storage", "network", "forbidden"].includes(roles.state.status))
    )
      roles.retry();
    else directory.retry();
    if (
      !policy.server.value ||
      ((channel?.kind === "D" || channel?.kind === "G") &&
        policy.server.value.sharedChannelDMs === undefined)
    )
      policy.retry();
  }
  const error = (kind: string) =>
    kind === "forbidden"
      ? text.forbidden
      : kind === "storage"
        ? text.storage
        : kind === "network"
          ? text.network
          : null;
  const directoryIssue = error(status);
  const policyIssue =
    error(policy.server.status) ||
    (policy.userReadFailed ? text.storage : null);
  const own = profiles.byId.get(userId);
  function author(id: string) {
    const profile = profiles.byId.get(id);
    return profile && settings
      ? { name: teammateName(profile, settings.nameFormat) }
      : undefined;
  }
  const search = useWorkspaceSearch(
    workspace,
    language,
    (id) =>
      snapshot?.data.channels.find((row) => row.id === id)?.displayName ||
      undefined,
    (id) => author(id)?.name,
    {
      channelId: chosen,
      clear: workspace.messages.clear,
      open: (source, signal, origin) =>
        workspace.messages.open(source, signal, origin),
      beforeOpen: () => {
        collections.close(false);
        setChannelMenuOpen(false);
      },
    },
  );
  function showCollection(
    source: { kind: "all" } | { kind: "pins"; channelId: string },
    opener: HTMLButtonElement,
  ) {
    setChannelMenuOpen(false);
    if (search.back || search.origin) search.dismiss();
    workspace.messages.clear();
    setDirectoryOpen(false);
    collections.open(source, opener);
  }
  const collectionDestination =
    position &&
    !position.system &&
    position.request.post.id === collections.origin.current?.id &&
    collections.view;
  function returnToCollection() {
    const source = collections.restoreRow();
    if (source?.channelId) choose(source.channelId, true);
    else workspace.messages.clear();
  }

  const notice = (message: string, retry?: () => void, alert = false) => (
    <Notice message={message} label={text.retry} retry={retry} alert={alert} />
  );
  const nav = (
    <>
      <button
        type="button"
        className="workspace-row directory-trigger"
        ref={directoryButton}
        aria-current={directoryOpen ? "page" : undefined}
        onClick={() => {
          search.dismiss();
          workspace.messages.clear();
          collections.close(false);
          setChannelMenuOpen(false);
          closeThread();
          setDirectoryOpen(true);
          setPage("conversation");
        }}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m16 8-2.5 5.5L8 16l2.5-5.5z" />
        </svg>
        {directoryTitle}
      </button>
      {directoryIssue && notice(directoryIssue, directory.retry, true)}
      {status === "offline" && notice(snapshot ? text.offline : text.noCache)}
      {!snapshot &&
        (status === "loading" || status === "refreshing") &&
        notice(text.loading)}
      {snapshot && !snapshot.data.channels.length && notice(text.empty)}
      {snapshot &&
        snapshot.data.channels.length > 0 &&
        !settings &&
        notice(
          policyIssue ?? (online ? text.policy : text.noPolicy),
          policyIssue ? policy.retry : undefined,
          !!policyIssue,
        )}
      {settings && (
        <Sidebar sections={sections} language={language} choose={choose} />
      )}
      {choiceFailed && notice(text.selected, undefined, true)}
    </>
  );
  const closed = () => {
    returnToAccount.current = true;
    setAccountOpen(false);
  };
  const historyIssue =
    error(timeline.status) ||
    (timeline.notice
      ? (error(timeline.notice) ??
        (timeline.notice === "offline" ? text.offlineEmpty : text.edge))
      : null);
  const historyDenied =
    timeline.notice === "forbidden" ||
    ["forbidden", "session", "unauthorized"].includes(timeline.status);
  // App keys this workspace by connection and team. Also discard a selection
  // when the directory refresh removes the channel or revokes access.
  const activeThread =
    !historyDenied && settings
      ? position && closedRequest !== position.request.requestId
        ? (timeline.focus?.focusedReply ?? null)
        : thread?.channelId === chosen
          ? thread
          : null
      : null;
  if (thread && !activeThread) setThread(null);
  const pinsSource =
    collections.view?.source.kind === "pins"
      ? collections.view.source.channelId
      : null;
  const pinsAvailable =
    !pinsSource ||
    (!["forbidden", "session", "unauthorized"].includes(
      directory.state.status,
    ) &&
      !(chosen === pinsSource && historyDenied) &&
      (snapshot?.data.channels.some((room) => room.id === pinsSource) ??
        false));
  useEffect(() => {
    if (!pinsAvailable) collections.close(false);
  }, [pinsAvailable, collections.close]);
  const visibleSearchPanel = position ? null : search.panel;
  const canReturnToResults = Boolean(
    position && !position.system && search.origin,
  );
  function returnToResults() {
    const channelId = search.restoreRow();
    if (channelId) choose(channelId, true);
  }
  const manualThread =
    activeThread && closedRequest === position?.request.requestId;
  function workspaceBack() {
    if (channelMenuOpen)
      return () => {
        setChannelMenuOpen(false);
        channelMenuButton.current?.focus();
      };
    if (search.dialog || (directoryOpen && visibleSearchPanel))
      return search.back;
    if (directoryOpen)
      return () => {
        restoreDirectoryFocus.current = true;
        setDirectoryOpen(false);
        if (compact || !chosen) setPage("navigation");
      };
    if (manualThread) return closeThread;
    if (collectionDestination) return returnToCollection;
    if (collections.view && !position) return () => collections.close();
    if (canReturnToResults) return returnToResults;
    if (visibleSearchPanel) return search.back;
    return activeThread ? closeThread : null;
  }
  useWorkspaceBack(
    accountOpen || workspace.messages.dialogOpen,
    workspaceBack(),
  );
  useEffect(() => {
    const request = position?.system;
    if (!request || request !== workspace.systemPost || request.signal.aborted)
      return;
    if (
      ["unavailable", "forbidden", "inaccessible"].includes(timeline.status)
    ) {
      request.stop(
        timeline.status === "inaccessible" ? "archived" : "unavailable",
        position.membership,
      );
      return;
    }
    if (
      ["offline", "network", "storage", "superseded", "positionLost"].includes(
        timeline.status,
      )
    ) {
      request.stop("failed", position.membership);
      return;
    }
    const scene = host.current;
    if (
      !timeline.focus ||
      !scene ||
      (timeline.focus.focusedReply && confirmedThread !== request)
    )
      return;
    const paneClass = timeline.focus.focusedReply
      ? ".thread-feed"
      : ".timeline-scroll";
    const check = () => {
      if (
        request.signal.aborted ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      const row = document.activeElement;
      if (
        !(row instanceof HTMLElement) ||
        row.dataset.postId !== request.target.postId ||
        !scene.contains(row)
      )
        return;
      if (
        Boolean(row.closest(".thread-feed")) !==
        Boolean(timeline.focus?.focusedReply)
      )
        return;
      const pane = row.closest(paneClass)?.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      if (
        pane?.height &&
        pane.width &&
        box.height &&
        box.width &&
        pane.right > box.left &&
        box.right > pane.left &&
        pane.bottom > box.top &&
        box.bottom > pane.top
      )
        request.shown(row.dataset.postId);
    };
    let frame: number | null = null;
    function cancel() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    }
    function schedule() {
      if (
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        request?.signal.aborted
      ) {
        cancel();
        return;
      }
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null;
          check();
        });
    }
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", schedule);
    scene.addEventListener("focusin", schedule);
    scene.addEventListener("scroll", schedule, true);
    const observer = new ResizeObserver(schedule);
    observer.observe(scene);
    schedule();
    return () => {
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", schedule);
      scene.removeEventListener("focusin", schedule);
      scene.removeEventListener("scroll", schedule, true);
      observer.disconnect();
      cancel();
    };
  }, [
    position,
    workspace.systemPost,
    timeline.focus,
    timeline.status,
    confirmedThread,
  ]);
  const channelTitle = channel
    ? selectedLabel || channel.displayName || text.nav
    : text.choose;
  function composer(rootId?: string, reader?: ReactionThread) {
    if (historyDenied) return null;
    if (access !== "writable" || !channel) {
      return (
        <ComposerAccessNotice
          access={access}
          language={language}
          online={online}
          statuses={[status, roles.state.status, policy.server.status]}
          close={rootId ? undefined : closeChannel}
          retry={retryPostingAccess}
        />
      );
    }
    return (
      <DraftComposer
        connection={connection}
        channelId={channel.id}
        rootId={rootId}
        conversation={{
          name: selectedLabel || channel.displayName || channel.name,
          direct: channel.kind === "D" || channel.kind === "G",
        }}
        keys={policy.user?.composerKeys}
        sendContext={channelDraftActions(
          workspace,
          channel,
          permission,
          settings?.collapsedThreads ?? null,
          search.fromCommand,
          reader,
        )}
        label={rootId ? draftText.reply : draftLabel()}
        language={language}
        online={online}
        sessionIssue={sessionIssue}
        fieldRef={rootId ? replyField : draftField}
      />
    );
  }
  return (
    <div ref={host} className="workspace-window">
      <ChannelsFrame
        labels={{
          navigation: text.nav,
          account: text.account,
          chooseTeam: text.switchTeam,
          closeThread: text.closeThread,
        }}
        toolbar={
          <>
            {search.trigger}
            <button
              type="button"
              className="channels-icon-action collection-saved-trigger"
              aria-label={collectionLabels.saved}
              title={collectionLabels.saved}
              onClick={(event) =>
                showCollection({ kind: "all" }, event.currentTarget)
              }
            >
              <CollectionMark kind="all" />
              {knownSaves.complete && knownSaves.ids.size > 0 && (
                <small aria-hidden="true">{knownSaves.ids.size}</small>
              )}
            </button>
          </>
        }
        channelHeading={
          !directoryOpen && channel && !historyDenied
            ? (id, ref) => (
                <CollectionChannelMenu
                  headingId={id}
                  headingRef={ref}
                  title={channelTitle}
                  language={language}
                  trigger={channelMenuButton}
                  open={channelMenuOpen}
                  setOpen={setChannelMenuOpen}
                  onPins={(opener) =>
                    showCollection(
                      { kind: "pins", channelId: channel.id },
                      opener,
                    )
                  }
                />
              )
            : undefined
        }
        sidePanel={
          position ? null : collections.view &&
            collections.state &&
            pinsAvailable ? (
            <PostCollectionPane
              key={collections.view.key}
              model={collections.view.model}
              state={collections.state}
              kind={collections.view.source.kind}
              language={language}
              online={online}
              canRemove={
                collections.view.source.kind === "all" ||
                Boolean(
                  channel &&
                    !channel.deleteAt &&
                    !historyDenied &&
                    (permission(channel, "read_channel_content") ===
                      "allowed" ||
                      (channel.kind === "O" &&
                        permission("team", "read_public_channel") ===
                          "allowed")),
                )
              }
              channelInfo={(id) => savedRooms.get(id)}
              authorName={(id) => author(id)?.name}
              savedIds={knownSaves.ids}
              sessionIssue={sessionIssue}
              restore={collections.restore}
              openRow={(id, origin, scroll) =>
                void collections.activate(
                  { id, channelId: chosen, scroll },
                  (signal) =>
                    workspace.messages.open(
                      { kind: "post", id },
                      signal,
                      origin,
                    ),
                )
              }
              close={() => collections.close()}
            />
          ) : (
            search.panel
          )
        }
        resultReturn={
          position && (
            <>
              {position.membership && (
                <span className="search-membership" role="status">
                  {position.membership}
                </span>
              )}
              {collectionDestination && (
                <button
                  type="button"
                  className="search-return"
                  onClick={returnToCollection}
                >
                  {collectionDestination.source.kind === "all"
                    ? collectionLabels.savedBack
                    : collectionLabels.pinsBack}
                </button>
              )}
              {search.origin && !position.system && (
                <button
                  type="button"
                  className="search-return"
                  onClick={returnToResults}
                >
                  {search.backLabel}
                </button>
              )}
            </>
          )
        }
        returnInThread={compact && Boolean(activeThread)}
        accountRef={accountButton}
        draftRef={directoryOpen ? undefined : draftField}
        accountName={
          own && settings ? teammateName(own, settings.nameFormat) : ""
        }
        teamName={team.displayName || team.name}
        channel={
          directoryOpen
            ? { id: "team-directory", title: directoryTitle }
            : channel
              ? {
                  id: channel.id,
                  title: channelTitle,
                }
              : null
        }
        emptyTitle={
          canReturnToResults
            ? (directoryIssue ?? (snapshot ? text.forbidden : text.noCache))
            : text.choose
        }
        page={
          chosen || directoryOpen || canReturnToResults ? page : "navigation"
        }
        onNavigation={() => {
          workspace.systemPost?.stop("paused");
          restoreDirectoryFocus.current = directoryOpen;
          setDirectoryOpen(false);
          search.abortPending();
          collections.close(false);
          setPage("navigation");
        }}
        onAccount={() => {
          workspace.systemPost?.stop("paused");
          search.abortPending();
          collections.abort();
          setAccountOpen(true);
        }}
        onTeam={workspace.chooseAnotherTeam}
        navigation={nav}
        thread={
          activeThread && settings
            ? {
                id: activeThread.id,
                title: text.thread,
                close: closeThread,
                replyRef:
                  activeThread.rootId || isMobile ? undefined : replyField,
                content: (
                  <ThreadPane
                    key={JSON.stringify([
                      connection.rid,
                      activeThread.channelId,
                      activeThread.id,
                      position?.system ? position.request.requestId : null,
                      settings.collapsedThreads,
                    ])}
                    connection={connection}
                    userId={userId}
                    post={activeThread}
                    collapsedThreads={settings.collapsedThreads}
                    locale={language}
                    nameFormat={settings.nameFormat}
                    author={author}
                    online={online}
                    sessionIssue={sessionIssue}
                    onOpened={
                      position?.system
                        ? () => setConfirmedThread(position.system)
                        : undefined
                    }
                    onUnavailable={
                      position?.system
                        ? (reason) =>
                            position.system?.stop(
                              reason === "limited"
                                ? "archived"
                                : reason === "failed"
                                  ? "failed"
                                  : "unavailable",
                              position.membership,
                            )
                        : undefined
                    }
                    renderComposer={composer}
                  />
                ),
              }
            : undefined
        }
        composer={
          <div className="workspace-conversation-route" hidden={directoryOpen}>
            {composer()}
          </div>
        }
      >
        {directoryOpen && (
          <TeamChannelDirectory
            key={team.id}
            account={connection}
            teamId={team.id}
            language={language}
            state={directory.state}
            canBrowse={
              permission("team", "list_team_channels") === "allowed" &&
              permission("team", "join_public_channels") === "allowed"
            }
            online={online}
            choose={choose}
            refresh={directory.retry}
            sessionIssue={sessionIssue}
          />
        )}
        <div className="workspace-conversation-route" hidden={directoryOpen}>
          {timeline.status === "positionLost" && (
            <Notice
              message={text.positionLost}
              label={text.latest}
              retry={timeline.showLatest}
            />
          )}
          {historyIssue &&
            notice(
              historyIssue,
              timeline.canRetry ? timeline.retry : undefined,
              true,
            )}
          {chosen &&
            settings &&
            !historyDenied &&
            timeline.status !== "positionLost" && (
              <ConversationTimeline
                viewport={timeline.viewport}
                channelId={chosen}
                connection={connection}
                latest={timeline.latest}
                userId={userId}
                sessionIssue={sessionIssue}
                page={timeline.page}
                inaccessibleBefore={timeline.firstInaccessiblePostTime}
                waitingMessage={
                  !timeline.page &&
                  (timeline.status === "loading" ||
                    timeline.status === "refreshing")
                    ? text.loadingHistory
                    : undefined
                }
                offline={!online}
                locale={language}
                author={author}
                onReadEdge={timeline.loadEdge}
                address={
                  timeline.focus && !timeline.focus.focusedReply
                    ? timeline.focus
                    : undefined
                }
                onOpenThread={(post) => {
                  setClosedRequest(position?.request.requestId ?? null);
                  collections.close(false);
                  setThread(post);
                }}
                openThreadPostId={activeThread?.id}
                collapsedThreads={settings.collapsedThreads}
              />
            )}
        </div>
      </ChannelsFrame>
      {search.dialog}
      {accountOpen && (
        <AccountSessionWindow
          workspace={workspace}
          language={language}
          onEnded={onEnded}
          onDismiss={closed}
        />
      )}
    </div>
  );
}
