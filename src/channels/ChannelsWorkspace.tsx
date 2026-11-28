import {
  type CSSProperties,
  lazy,
  Suspense,
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
import { AppearanceMark } from "../appearance/AppearanceMark.tsx";
import { isMobile } from "../build-platform.ts";
import { AccountSessionWindow } from "../entry/AccountSessionWindow.tsx";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { EntryLanguage } from "../entry/language.ts";
import { TeamSwitchDialog } from "../entry/TeamSwitchDialog.tsx";
import { teamChoiceText } from "../entry/team-choice-text.ts";
import type { SystemPostRequest } from "../entry/use-system-permalink.tsx";
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
import { ChannelNotificationsDialog } from "./ChannelNotificationsDialog.tsx";
import { ChannelsFrame, ThreadMark } from "./ChannelsFrame.tsx";
import { CollectionChannelMenu } from "./CollectionChannelMenu.tsx";
import { CollectionResultSteps } from "./CollectionResultSteps.tsx";
import { ComposerAccessNotice } from "./ComposerAccessNotice.tsx";
import { ConversationTimeline } from "./ConversationTimeline.tsx";
import { channelDraftActions } from "./channel-draft-actions.ts";
import { collectionCopy } from "./collection-copy.ts";
import { channelComposerAccess } from "./composer-access.ts";
import {
  DirectoryCompass,
  DirectoryHeading,
  DirectoryNavigationIcon,
  directoryCopy,
} from "./DirectorySurface.tsx";
import { DraftComposer } from "./DraftComposer.tsx";
import { draftCopy } from "./draft-copy.ts";
import { MentionMark, MentionsPane, mentionCopy } from "./MentionsPane.tsx";
import { CollectionMark, PostCollectionPane } from "./PostCollectionPane.tsx";
import { PrivateChannelIcon } from "./PrivateChannelIcon.tsx";
import {
  AttachmentWindow,
  useAttachmentWindow,
} from "./PublishedAttachments.tsx";
import { PublishedCodeReader } from "./PublishedCodeReader.tsx";
import { PublishedLinkNavigation } from "./PublishedPostLink.tsx";
import {
  PublishedReaderWindow,
  PublishedTableScreen,
  usePublishedReaderWindow,
} from "./PublishedReaderWindow.tsx";
import {
  PublishedReadingReturn,
  PublishedReadingStatus,
} from "./PublishedReadingReturn.tsx";
import { PostActionScope, usePostActionScope } from "./post-action-scope.ts";
import { showPostArrival } from "./post-arrival.ts";
import { newestCollectionItems } from "./post-collection.ts";
import {
  capturePublishedReadingOrigin,
  type PublishedLinkLanding,
  type PublishedReadingOrigin,
  publishedOriginLink,
} from "./published-reading-history.ts";
import type { ReactionThread } from "./submit-channel-reaction.ts";
import { TeamChannelDirectory } from "./TeamChannelDirectory.tsx";
import { ThreadInboxPane } from "./ThreadInboxPane.tsx";
import { ThreadPane } from "./ThreadPane.tsx";
import type { ThreadInboxPlace } from "./thread-inbox.ts";
import { threadInboxCopy } from "./thread-inbox-copy.ts";
import type {
  ChannelHistoryAccess,
  RetainedChannelWindow,
  TimelineRequest,
} from "./timeline-reader.ts";
import { measureTimeline, type TimelinePlace } from "./timeline-viewport.ts";
import { useChannelTimeline } from "./use-channel-timeline.ts";
import { useResultChannelIdentities } from "./use-result-channel-identities.ts";
import { useWorkspaceBack } from "./use-workspace-back.ts";
import { useWorkspaceCollections } from "./use-workspace-collections.ts";
import { useWorkspaceProfiles } from "./use-workspace-profiles.ts";
import { useTeamRoles, useWorkspaceRead } from "./use-workspace-read.ts";
import { useWorkspaceSearch } from "./use-workspace-search.tsx";
import { useWorkspaceThreadInbox } from "./use-workspace-thread-inbox.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import { openingChannel, workspaceProfileQuery } from "./workspace-data.ts";
import "./workspace.css";

const AppearanceDialog = lazy(
  () => import("../appearance/AppearanceDialog.tsx"),
);

type AccountOverlay =
  | { kind: "account"; focusTeamChoice?: boolean }
  | { kind: "team-from-account" }
  | { kind: "team"; opener: HTMLButtonElement };

function roomHeading(name: string, kind?: string) {
  return kind === "O" || kind === "P" ? `# ${name}` : name;
}

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
function confirmVisiblePost(
  request: SystemPostRequest,
  scene: HTMLElement,
  control: HTMLElement,
  inThread: boolean,
) {
  if (
    request.signal.aborted ||
    document.visibilityState !== "visible" ||
    !document.hasFocus()
  )
    return;
  // Activating a link can move focus inside the destination before its first visible frame.
  const row = control.matches("a[href]")
    ? control.closest<HTMLElement>("[data-post-id]")
    : control;
  if (
    !row ||
    row.dataset.postId !== request.target.postId ||
    !scene.contains(row) ||
    Boolean(row.closest(".thread-feed")) !== inThread
  )
    return;
  const pane = row.closest(".timeline-scroll")?.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  const focus = control === row ? box : control.getBoundingClientRect();
  if (
    pane &&
    Math.min(pane.right, box.right, focus.right) >
      Math.max(pane.left, box.left, focus.left) &&
    Math.min(pane.bottom, box.bottom, focus.bottom) >
      Math.max(pane.top, box.top, focus.top)
  )
    request.shown(row.dataset.postId);
}

export function ChannelsWorkspace({
  workspace,
  language,
}: {
  workspace: TeamWorkspace;
  language: EntryLanguage;
}) {
  const { connection, team, userId, serverUrl, policy, online, sessionIssue } =
    workspace;
  const publishedLinks = useContext(PublishedLinkNavigation);
  const { publishedReading } = workspace.messages;
  const readingReturn = workspace.messages.readingReturn;
  const text = workspaceCopy[language];
  const host = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const replyField = useRef<HTMLTextAreaElement>(null);
  const [threadControls, setThreadControls] = useState<HTMLSpanElement | null>(
    null,
  );
  const [accountOverlay, setAccountOverlay] = useState<AccountOverlay | null>(
    null,
  );
  const accountOverlayReturn = useRef<HTMLButtonElement | null>(null);
  const appearanceButton = useRef<HTMLButtonElement>(null);
  const savedButton = useRef<HTMLButtonElement>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceNotice, setAppearanceNotice] = useState("");
  const appearanceLabel = language === "ru" ? "Оформление" : "Appearance";
  useEffect(() => {
    if (!appearanceNotice) return;
    const timeout = window.setTimeout(() => setAppearanceNotice(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [appearanceNotice]);
  const archivePolicy = policy.server.value?.search?.archivedChannels;
  const { closeSavedSurface } = workspace.messages;
  const closeWorkspaceSaved = useCallback(
    () => closeSavedSurface(team.id),
    [closeSavedSurface, team.id],
  );
  const collections = useWorkspaceCollections(
    connection,
    online,
    archivePolicy,
    sessionIssue,
    closeWorkspaceSaved,
  );
  const mentionLabels = mentionCopy[language];
  const collectionLabels = collectionCopy[language];
  const channelMenuButton = useRef<HTMLButtonElement>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const directoryReturn = useRef<() => boolean>(null);
  const restoreDirectoryControl = useRef(false);
  const focusDirectory = useCallback(() => {
    if (!restoreDirectoryControl.current) return false;
    restoreDirectoryControl.current = false;
    return directoryReturn.current?.() ?? false;
  }, []);
  const directoryScope = JSON.stringify([connection.rid, team.id]);
  const restoreDirectoryFocus = useRef(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const directoryTitle = directoryCopy[language].title;
  const teamName = team.displayName || team.name;
  useLayoutEffect(() => {
    if (!directoryOpen && restoreDirectoryFocus.current) {
      restoreDirectoryFocus.current = false;
      directoryButton.current?.focus();
    }
  }, [directoryOpen]);
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [notificationRoom, setNotificationRoom] = useState<string | null>(null);
  const restoreChannelTitle = useRef(false);
  useLayoutEffect(() => {
    if (notificationRoom === null && restoreChannelTitle.current) {
      restoreChannelTitle.current = false;
      channelMenuButton.current?.focus();
    }
  }, [notificationRoom]);
  const [knownSaves, setKnownSaves] = useState<{
    ids: ReadonlySet<string>;
    complete: boolean;
  }>(() => ({ ids: new Set(), complete: false }));
  const savedValue =
    collections.view?.kind === "all" ? collections.state : null;
  const savedItems = savedValue?.value?.items;
  const hasSavedView = Boolean(savedValue);
  const complete =
    Boolean(savedValue?.value) && savedValue?.continuation === "none";
  useEffect(() => {
    if (hasSavedView)
      setKnownSaves({
        ids: new Set(savedItems?.map((post) => post.id)),
        complete,
      });
  }, [hasSavedView, savedItems, complete]);
  useLayoutEffect(() => {
    if (accountOverlay) return;
    accountOverlayReturn.current?.focus({ preventScroll: true });
    accountOverlayReturn.current = null;
  }, [accountOverlay]);
  useLayoutEffect(() => {
    host.current?.querySelector<HTMLButtonElement>(".channels-team")?.focus();
  }, []);
  const [compact, setCompact] = useState(false);
  const [page, setPage] = useState<"navigation" | "conversation">(
    "conversation",
  );
  const [selected, setSelected] = useState<{
    id: string;
    focus: boolean;
  } | null>(null);
  const selectedChannelId = selected?.id;
  const [thread, setThread] = useState<LocalPost | null>(null);
  const requestedPosition =
    workspace.messages.position?.request.teamId === team.id &&
    workspace.messages.position.request.rid === connection.rid &&
    !workspace.messages.position.system?.signal.aborted
      ? workspace.messages.position
      : null;
  const position = requestedPosition?.choosingChannel
    ? null
    : requestedPosition;
  const [confirmedThread, setConfirmedThread] =
    useState<TeamWorkspace["systemPost"]>();
  const [closedRequest, setClosedRequest] = useState<number | null>(null);
  const closeThread = useCallback(() => {
    publishedReading?.interrupt();
    position?.system?.stop("paused");
    setThread(null);
    setClosedRequest(position?.request.requestId ?? null);
  }, [position, publishedReading]);
  const [choiceFailed, setChoiceFailed] = useState<{
    exclude?: string;
  } | null>(null);
  const suppressLatest = useRef(Boolean(workspace.systemPost));
  if (!workspace.systemPost || position?.system) suppressLatest.current = false;
  const choice = useRef(0);
  const active = useRef<{ connection: typeof connection; teamId: string }>(
    null,
  );
  useLayoutEffect(() => {
    active.current = { connection, teamId: team.id };
    return () => {
      active.current = null;
      choice.current++;
    };
  }, [connection, team.id]);
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
  const directory = useWorkspaceRead(directoryScope, online, read, refresh);
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
  const directoryDenied = ["forbidden", "session", "unauthorized"].includes(
    status,
  );
  const publishedChannels = published?.data.channels;
  const publishedChannelIds = useMemo(
    () => new Set(publishedChannels?.map(({ id }) => id)),
    [publishedChannels],
  );
  const confirmedChannelIds = useMemo(
    () =>
      directoryDenied
        ? new Set<string>()
        : status === "ready"
          ? publishedChannelIds
          : undefined,
    [directoryDenied, status, publishedChannelIds],
  );
  const focusRequest = position?.request;
  const readingInbox = position?.readingReturn?.origin.inbox;
  const [handoff, setHandoff] = useState({ focusRequest, published, status });
  if (focusRequest !== handoff.focusRequest) {
    setHandoff({ focusRequest, published, status });
    if (focusRequest) setDirectoryOpen(false);
  }
  const snapshot =
    position &&
    (focusRequest !== handoff.focusRequest ||
      (handoff.published === published && handoff.status === status)) &&
    !["forbidden", "unauthorized", "session"].includes(status)
      ? position.sidebar
      : published;
  const requestedReturn = workspace.messages.savedReturn;
  const savedReturn =
    requestedReturn &&
    requestedReturn.rid === connection.rid &&
    requestedReturn.teamId === team.id
      ? requestedReturn
      : null;
  const excludedChannel =
    choiceFailed?.exclude ?? savedReturn?.unavailableChannel;
  const channel = useMemo(() => {
    if (!snapshot) return null;
    if (position && !readingInbox)
      return (
        snapshot.data.channels.find(
          (c) => c.id === position.request.post.channelId,
        ) ?? null
      );
    const sidebar = excludedChannel
      ? {
          ...snapshot,
          data: {
            ...snapshot.data,
            channels: snapshot.data.channels.filter(
              (c) => c.id !== excludedChannel,
            ),
          },
        }
      : snapshot;
    return (
      sidebar.data.channels.find(
        (c) =>
          c.id === (readingInbox ? readingInbox.channelId : selectedChannelId),
      ) ?? openingChannel(sidebar, language)
    );
  }, [
    snapshot,
    selectedChannelId,
    language,
    position,
    excludedChannel,
    readingInbox,
  ]);
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
  const historyAccessScope = useMemo(
    () => ({
      connection,
      teamId: team.id,
      channels: new Map<string, ChannelHistoryAccess>(),
    }),
    [connection, team.id],
  );
  const historyWindowScope = useMemo(
    () => ({
      account: historyAccessScope,
      collapsedThreads: settings?.collapsedThreads ?? null,
      windows: new Map<string, RetainedChannelWindow>(),
    }),
    [historyAccessScope, settings?.collapsedThreads],
  );
  const channelHistoryAccess = historyAccessScope.channels;
  const retainedChannels = historyWindowScope.windows;
  useLayoutEffect(() => () => retainedChannels.clear(), [retainedChannels]);
  const inbox = useWorkspaceThreadInbox(
    connection,
    workspace.threadReads,
    team.id,
    settings?.collapsedThreads === true &&
      !["forbidden", "session", "unauthorized"].includes(
        directory.state.status,
      ),
    online,
    sessionIssue,
  );
  const inboxRoute = useRef<number | undefined>(undefined);
  const inboxMain = useRef<
    Omit<NonNullable<PublishedReadingOrigin["inbox"]>, "list"> | undefined
  >(undefined);
  const inboxList = useRef<ThreadInboxPlace | undefined>(undefined);
  useLayoutEffect(() => {
    if (
      inbox.paused &&
      !readingReturn?.previous &&
      readingReturn?.notice === "unavailable"
    )
      inbox.close();
    const next = position?.request.requestId;
    if (next === undefined || next === inboxRoute.current) {
      inboxRoute.current = next;
      return;
    }
    const root = position?.readingReturn?.threadRoot;
    if (readingInbox && root && !inbox.model) return;
    inboxRoute.current = next;
    if (readingInbox && root) {
      if (inbox.resume(root, readingInbox.list)) {
        inboxMain.current = readingInbox;
        inboxList.current = readingInbox.list;
        restoreConversation(readingInbox.channelId, readingInbox.reading);
      }
    } else if (inbox.visible) {
      if (position?.system?.publishedFromTeam === team.id) inbox.pause();
      else inbox.close();
    } else if (
      inbox.paused &&
      !position?.system?.publishedFromTeam &&
      !position?.readingReturn
    )
      inbox.close();
  });
  const inboxText = threadInboxCopy[language];
  const counts = inbox.state?.totals.value;
  const inboxName = [
    inboxText.title,
    counts?.totalUnreadThreads &&
      `${inboxText.unreadDiscussions}: ${counts.totalUnreadThreads}`,
    counts?.totalUnreadMentions &&
      `${inboxText.mentions}: ${counts.totalUnreadMentions}`,
    counts?.totalUnreadUrgentMentions &&
      `${inboxText.urgent}: ${counts.totalUnreadUrgentMentions}`,
  ]
    .filter(Boolean)
    .join(", ");
  const inboxWasVisible = useRef(false);
  useLayoutEffect(() => {
    if (inboxWasVisible.current && !inbox.model) setPage("navigation");
    inboxWasVisible.current = inbox.visible;
  }, [inbox.visible, inbox.model]);
  const collectionReading = useRef<TimelinePlace | null>(null);
  const restoreVersion = useRef(0);
  const [restoredChannel, setRestoredChannel] = useState<{
    channelId: string;
    request: Extract<TimelineRequest, { kind: "restore" | "return" }>;
    place?: TimelinePlace;
    composerHeight?: number;
    owner?: typeof retainedChannels;
  } | null>(null);
  const appliedSavedReturn =
    useRef<TeamWorkspace["messages"]["savedReturn"]>(null);
  const waitingChannel = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (
      requestedPosition?.choosingChannel &&
      waitingChannel.current !== requestedPosition.request.requestId
    ) {
      const { request } = requestedPosition;
      waitingChannel.current = request.requestId;
      chooseChannel(request.post.channelId, (accepted) => {
        workspace.messages.completeChannelChoice(request.requestId, accepted);
      });
    }
    if (
      !savedReturn ||
      appliedSavedReturn.current === savedReturn ||
      position ||
      !savedButton.current
    )
      return;
    appliedSavedReturn.current = savedReturn;
    const place = savedReturn.place;
    collectionReading.current = null;
    if (place?.channelId)
      chooseChannel(place.channelId, (accepted) => {
        if (!accepted) return;
        restoreConversation(place.channelId, place.reading);
        collectionReading.current = place.reading;
      });
    collections.open({ kind: "all", returnRow: place }, savedButton.current);
  });
  const restoration =
    (!position || readingInbox) &&
    restoredChannel?.channelId === chosen &&
    (!restoredChannel.owner ||
      (restoredChannel.owner === retainedChannels &&
        !directoryDenied &&
        chosen &&
        publishedChannelIds.has(chosen)))
      ? restoredChannel
      : null;
  const returningComposerHeight = restoration?.composerHeight;
  const timeline = useChannelTimeline(
    connection,
    team.id,
    suppressLatest.current ? null : chosen,
    settings?.collapsedThreads ?? null,
    online,
    sessionIssue,
    (!readingInbox ? position?.request : undefined) ?? restoration?.request,
    chosen ? channelHistoryAccess.get(chosen) : undefined,
  );
  useLayoutEffect(() => {
    // The reader has taken this snapshot. Keep the route and coordinates,
    // without holding another copy of the messages in navigation state.
    if (restoration?.request.kind !== "return" || !restoration.request.window)
      return;
    const request = { ...restoration.request, window: undefined };
    setRestoredChannel((current) =>
      current === restoration ? { ...current, request } : current,
    );
  }, [restoration]);
  const current = useMemo(
    () =>
      snapshot
        ? {
            ...snapshot,
            selectedChannel: directoryOpen || inbox.visible ? null : chosen,
          }
        : null,
    [snapshot, chosen, directoryOpen, inbox.visible],
  );
  const search = useWorkspaceSearch(
    workspace,
    language,
    {
      channel: (id) => {
        const room = resultRooms.get(id);
        if (room?.title)
          return room.kind === "O" || room.kind === "P"
            ? `# ${room.title}`
            : room.title;
      },
      author: (id) => author(id)?.name,
      condition: (kind, value) => {
        if (kind === "channel") {
          return snapshot?.data.channels.find(
            (room) => room.name.toLowerCase() === value.toLowerCase(),
          )?.displayName;
        }
        const user = profiles.byUsername.get(value.toLowerCase());
        return user && settings
          ? teammateName(user, settings.nameFormat)
          : undefined;
      },
    },
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
  const mentionItems = collections.mentionState?.items;
  const resultItems = savedItems ?? mentionItems ?? search.rows;
  const resultChannelIds = useMemo(
    () =>
      new Set(resultItems?.map((row) => row.channelId).filter(isMattermostId)),
    [resultItems],
  );
  const channels = snapshot?.data.channels;
  const missingRooms = useMemo(() => {
    const ids = new Set(resultChannelIds);
    for (const room of channels ?? []) ids.delete(room.id);
    return ids;
  }, [resultChannelIds, channels]);
  const extraRooms = useResultChannelIdentities(
    connection,
    collections.view?.model ?? search.session,
    missingRooms,
    online,
    sessionIssue,
  );
  const profileQuery = useMemo(() => {
    const query = workspaceProfileQuery(
      userId,
      current,
      settings,
      timeline.page,
      resultChannelIds,
    );
    const ids = new Set(query.ids);
    if (inbox.visible) {
      for (const row of inbox.state?.page.rows ?? []) {
        if (!row.post) continue;
        ids.add(row.post.userId);
        for (const person of row.participantIds.slice(0, 3)) ids.add(person);
      }
    }
    for (const post of collections.state?.value?.items ?? [])
      if (isMattermostId(post.userId)) ids.add(post.userId);
    const usernames = new Set(query.usernames);
    for (const id of missingRooms) {
      const room = extraRooms.get(id);
      if (room?.kind === "D") {
        const peer = directPartnerId(room.name, userId);
        if (peer) ids.add(peer);
      }
      if (room?.kind === "G")
        for (const name of room.displayName.split(", "))
          if (name.trim()) usernames.add(name);
    }
    for (const post of resultItems ?? [])
      if (isMattermostId(post.userId)) ids.add(post.userId);
    return { ids: [...ids], usernames: [...usernames] };
  }, [
    userId,
    current,
    settings,
    timeline.page,
    inbox.visible,
    inbox.state?.page.rows,
    collections.state?.value,
    resultChannelIds,
    resultItems,
    missingRooms,
    extraRooms,
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
  const inboxRooms = useMemo(
    () =>
      inbox.visible && snapshot
        ? new Map(snapshot.data.channels.map((room) => [room.id, room]))
        : null,
    [inbox.visible, snapshot],
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
  const resultRooms = useMemo(() => {
    const result = new Map<
      string,
      { title: string; kind: string; team?: string }
    >();
    if (!resultChannelIds.size) return result;
    for (const room of [...extraRooms.values(), ...(channels ?? [])]) {
      if (!resultChannelIds.has(room.id)) continue;
      const title = conversationName(
        room,
        userId,
        profiles,
        settings?.nameFormat ?? "username",
        language,
      );
      const other =
        "teamId" in room && room.teamId && room.teamId !== team.id
          ? workspace.teamChoice.teams.find(({ id }) => id === room.teamId)
          : undefined;
      result.set(room.id, {
        title,
        kind: room.kind,
        ...(other && { team: other.displayName || other.name }),
      });
    }
    return result;
  }, [
    channels,
    extraRooms,
    resultChannelIds,
    userId,
    profiles,
    settings?.nameFormat,
    language,
    team.id,
    workspace.teamChoice.teams,
  ]);
  const selectedRow = sections
    .flatMap((section) => section.rows)
    .find((row) => row.id === chosen);
  const selectedLabel = selectedRow?.title;
  function inboxRoomName(id: string) {
    const room = inboxRooms?.get(id);
    if (!room || !settings) return undefined;
    const display = conversationName(
      room,
      userId,
      profiles,
      settings.nameFormat,
      language,
    );
    return (
      display &&
      (room.kind === "D" || room.kind === "G" ? display : `# ${display}`)
    );
  }
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
    const main = inbox.visible ? inboxMain.current : undefined;
    const switchingChannel = id !== chosen;
    const keepCurrentReading = !switchingChannel && !position && !inbox.visible;
    if (!returning && switchingChannel && !inbox.visible)
      rememberChannelReading();
    const { collapsedThreads } = historyWindowScope;
    const retained =
      !returning &&
      switchingChannel &&
      collapsedThreads !== null &&
      retainedChannels.has(id);
    inbox.close();
    setDirectoryOpen(false);
    search.abortPending();
    if (!returning) {
      collections.close(false);
      if (!retained && !keepCurrentReading)
        restoreConversation(id, main?.channelId === id ? main.reading : null);
    }
    setChannelMenuOpen(false);
    if (!returning && (position || search.origin)) search.dismiss();
    workspace.messages.clear();
    if (switchingChannel) closeThread();
    if (retained) {
      chooseChannel(
        id,
        (accepted) => {
          const window = retainedChannels.get(id);
          retainedChannels.delete(id);
          if (!accepted) return;
          setRestoredChannel(
            window
              ? {
                  channelId: id,
                  request: {
                    kind: "return",
                    requestId: ++restoreVersion.current,
                    rid: historyWindowScope.account.connection.rid,
                    teamId: historyWindowScope.account.teamId,
                    collapsedThreads,
                    window,
                  },
                  place: window.place,
                  composerHeight: window.composerHeight,
                  owner: retainedChannels,
                }
              : null,
          );
        },
        false,
      );
    } else chooseChannel(id);
  }
  function chooseChannel(
    id: string,
    outcome?: (accepted: boolean) => void,
    focusOnCommit = true,
  ) {
    const version = ++choice.current;
    const owner = active.current;
    if (!outcome) setSelected({ id, focus: true });
    setPage("conversation");
    setChoiceFailed(null);
    void workspace.messages.enqueue(async () => {
      if (!owner || active.current !== owner || version !== choice.current)
        return false;
      let accepted = false;
      try {
        accepted = await connection.selectSidebarChannel(team.id, id);
      } catch {
        /* The local choice is acknowledged only by SQLite. */
      }
      if (active.current === owner && version === choice.current) {
        if (!accepted) {
          setSelected(null);
          setChoiceFailed(outcome ? { exclude: id } : {});
          if (outcome) directory.retry();
        } else if (outcome) setSelected({ id, focus: focusOnCommit });
        outcome?.(accepted);
      }
      return accepted;
    });
  }
  function postingAccess(room: typeof channel | undefined) {
    return channelComposerAccess({
      channel: room ?? undefined,
      permission: permission(room ?? undefined, "create_post"),
      userId,
      profiles: profiles.byId,
      sharedChannelDMs: policy.server.value?.sharedChannelDMs,
    });
  }
  function closeChannel(opener: HTMLButtonElement) {
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
    else setAccountOverlay({ kind: "team", opener });
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
  const accountName = own
    ? teammateName(own, settings?.nameFormat ?? "full_name")
    : "";
  const serverAddress = workspace.serverUrl.slice(
    workspace.serverUrl.indexOf("://") + 3,
  );
  function author(id: string) {
    const profile = profiles.byId.get(id);
    return profile && settings
      ? {
          name: teammateName(profile, settings.nameFormat),
          isBot: profile.isBot,
        }
      : undefined;
  }
  function showCollection(
    source: Parameters<typeof collections.open>[0],
    opener: HTMLButtonElement,
  ) {
    inbox.close();
    setChannelMenuOpen(false);
    if (
      source.kind !== "pins" &&
      collections.view?.kind === source.kind &&
      !position
    ) {
      collections.close();
      return;
    }
    if (search.back || search.origin) search.dismiss();
    workspace.messages.clear();
    setDirectoryOpen(false);
    collectionReading.current = readChannelPlace();
    collections.open(source, opener);
  }
  function rememberChannelReading() {
    if (
      !chosen ||
      !settings ||
      position ||
      directoryOpen ||
      !timeline.page?.posts.length ||
      (timeline.status !== "ready" &&
        timeline.status !== "offline" &&
        !(
          timeline.status === "loading" &&
          restoration?.request.kind === "return"
        )) ||
      timeline.notice === "forbidden"
    )
      return;
    const pane = timeline.viewport.current;
    if (!pane?.clientHeight) return;
    retainedChannels.delete(chosen);
    retainedChannels.set(chosen, {
      page: timeline.page,
      place: measureTimeline(pane, timeline.latest),
      composerHeight: draftField.current
        ?.closest(".draft-wrap")
        ?.getBoundingClientRect().height,
    });
    if (retainedChannels.size > 4) {
      const oldest = retainedChannels.keys().next();
      if (!oldest.done) retainedChannels.delete(oldest.value);
    }
  }
  function rememberInboxChannel() {
    const feed = timeline.viewport.current;
    if (feed?.clientHeight)
      inboxMain.current = {
        channelId: chosen,
        reading: measureTimeline(feed, timeline.latest),
      };
    else if (inboxMain.current?.channelId !== chosen)
      inboxMain.current = { channelId: chosen, reading: null };
  }
  function readChannelPlace() {
    const pane = timeline.viewport.current;
    return !position && pane?.clientHeight
      ? measureTimeline(pane, timeline.latest)
      : null;
  }
  const collectionOrigin = collections.origin.current;
  const collectionIndex =
    position && !position.system && collectionOrigin
      ? collectionOrigin.ids.indexOf(position.request.post.id)
      : -1;
  const collectionDestination = collectionIndex >= 0 ? collections.view : null;
  const savedSource = position?.saved;
  const savedRevoked = position?.savedRevoked;
  const [savedReminder, setSavedReminder] = useState<{
    source: NonNullable<typeof savedSource>;
    sequence: number;
  }>();
  if (savedReminder && savedReminder.source !== savedSource)
    setSavedReminder(undefined);
  useEffect(() => {
    if (!savedReminder) return;
    const timer = window.setTimeout(() => setSavedReminder(undefined), 2600);
    return () => window.clearTimeout(timer);
  }, [savedReminder]);
  const [readRevocation, setReadRevocation] = useState<typeof savedRevoked>();
  const revocationActive = savedRevoked && savedRevoked !== readRevocation;
  useEffect(() => {
    if (!savedRevoked) return;
    const timeout = window.setTimeout(
      () => setReadRevocation(savedRevoked),
      2600,
    );
    return () => window.clearTimeout(timeout);
  }, [savedRevoked]);
  const revocationFocused = useRef<typeof savedRevoked>(undefined);
  useLayoutEffect(() => {
    if (
      !savedRevoked?.focusPost ||
      revocationFocused.current === savedRevoked ||
      !focusRequest
    )
      return;
    const post = visibleResult(focusRequest.post.id);
    if (!post) return;
    revocationFocused.current = savedRevoked;
    post.focus({ preventScroll: true });
  });
  function restoreConversation(
    channelId: string | null,
    reading: TimelinePlace | null,
  ) {
    const anchors = reading?.anchors
      .filter(({ published }) => published)
      .map(({ id }) => id);
    if (channelId && reading && anchors?.length) {
      setRestoredChannel({
        channelId,
        request: {
          kind: "restore",
          requestId: ++restoreVersion.current,
          position: anchors,
        },
        place: reading,
      });
    } else setRestoredChannel(null);
  }
  function returnToCollection() {
    if (!position) return;
    restoreCollection(position.request.post.id);
  }
  function restoreCollection(id: string) {
    collections.abort();
    const source = collections.restoreRow(id);
    restoreConversation(source?.channelId ?? null, source?.reading ?? null);
    if (source?.channelId) choose(source.channelId, true);
    else workspace.messages.clear();
  }
  function stepCollection(delta: -1 | 1, control: HTMLElement) {
    const postId = collectionOrigin?.ids[collectionIndex + delta];
    if (
      !online ||
      !collectionDestination ||
      !postId ||
      workspace.messages.dialogOpen
    )
      return;
    openCollectionPost(postId, control);
  }
  function openCollectionPost(id: string, control: HTMLElement) {
    const from = collections.origin.current;
    const saved =
      collections.view?.kind === "all" && from
        ? {
            teamId: team.id,
            teamName: team.displayName || team.name,
            channelId: from.channelId,
            index: from.ids.indexOf(id),
            scroll: from.scroll,
            offset: from.offset,
            reading: from.reading,
          }
        : undefined;
    void collections.activate(id, (signal) =>
      workspace.messages.open({ kind: "post", id }, signal, control, saved),
    );
  }
  function returnToSaved() {
    const control = host.current?.querySelector<HTMLElement>(
      "[data-cross-team] .collection-step-back",
    );
    void workspace.messages.returnToSaved(control ?? null);
  }
  function endCollection(control: HTMLButtonElement) {
    const visible = visibleResult(position?.request.post.id);
    const heading = control
      .closest(".channels-conversation, .channels-thread")
      ?.querySelector<HTMLElement>(".channels-pane-head :is(h1, h2)");
    collections.close(false);
    if (savedSource) workspace.messages.endSaved();
    (visible ?? heading)?.focus({ preventScroll: true });
  }
  function visibleResult(id?: string) {
    if (!id) return;
    const posts = host.current?.querySelectorAll<HTMLElement>(
      `[data-post-id="${CSS.escape(id)}"]`,
    );
    return (
      posts && Array.from(posts).find((row) => row.getClientRects().length)
    );
  }

  const notice = (message: string, retry?: () => void, alert = false) => (
    <Notice message={message} label={text.retry} retry={retry} alert={alert} />
  );
  const nav = (
    <>
      <div className="panel-navigation">
        {inbox.model && (
          <button
            type="button"
            className="workspace-row panel-navigation__item inbox-trigger"
            aria-label={inboxName}
            data-surface={inbox.visible ? "selected-navigation" : undefined}
            aria-current={inbox.visible ? "page" : undefined}
            onClick={() => {
              if (inbox.visible) {
                setPage("conversation");
                return;
              }
              search.dismiss();
              workspace.messages.clear();
              collections.close(false);
              setDirectoryOpen(false);
              closeThread();
              inboxList.current = undefined;
              rememberInboxChannel();
              setPage("conversation");
              inbox.show();
            }}
          >
            <ThreadMark />
            <span className="panel-navigation__label">{inboxText.title}</span>
            {counts && counts.totalUnreadMentions > 0 ? (
              <span className="workspace-count" aria-hidden="true">
                {counts.totalUnreadUrgentMentions > 0 ? "!" : ""}
                {counts.totalUnreadMentions}
              </span>
            ) : counts && counts.totalUnreadThreads > 0 ? (
              <span className="workspace-unread" aria-hidden="true" />
            ) : null}
          </button>
        )}
        <button
          type="button"
          className="workspace-row panel-navigation__item directory-trigger"
          ref={directoryButton}
          aria-current={directoryOpen ? "page" : undefined}
          data-surface={directoryOpen ? "selected-navigation" : undefined}
          onClick={(event) => {
            if (directoryOpen) return;
            restoreDirectoryControl.current = event.detail === 0;
            search.dismiss();
            workspace.messages.clear();
            collections.close(false);
            setChannelMenuOpen(false);
            closeThread();
            inbox.close();
            setDirectoryOpen(true);
            setPage("conversation");
          }}
        >
          <DirectoryCompass />
          <span className="panel-navigation__label">{directoryTitle}</span>
        </button>
      </div>
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
    accountOverlayReturn.current = accountButton.current;
    setAccountOverlay(null);
  };
  function closeTeamChoice() {
    if (accountOverlay?.kind !== "team") return closed();
    accountOverlayReturn.current = accountOverlay.opener;
    setAccountOverlay(null);
  }
  const historyIssue =
    error(timeline.status) ||
    (timeline.notice
      ? (error(timeline.notice) ??
        (timeline.notice === "offline" ? text.offlineEmpty : text.edge))
      : null);
  const historyDenied =
    timeline.notice === "forbidden" ||
    ["forbidden", "session", "unauthorized"].includes(timeline.status);
  const channelHistoryForbidden =
    timeline.status === "forbidden" || timeline.notice === "forbidden";
  const { invalidateChannel } = inbox;
  useLayoutEffect(() => {
    if (chosen && channelHistoryForbidden) invalidateChannel(chosen);
  }, [chosen, channelHistoryForbidden, invalidateChannel]);
  useLayoutEffect(() => {
    if (directoryDenied) return;
    if (chosen && (historyDenied || timeline.status === "inaccessible")) {
      retainedChannels.delete(chosen);
      setRestoredChannel((current) =>
        current?.owner === retainedChannels &&
        current.channelId === chosen &&
        current.place
          ? { ...current, place: undefined, composerHeight: undefined }
          : current,
      );
    }
    if (chosen) {
      const previous = channelHistoryAccess.get(chosen);
      const cutoff = Math.max(
        previous?.cutoff ?? 0,
        timeline.firstInaccessiblePostTime,
      );
      const revoked =
        historyDenied ||
        (previous?.revoked === true && timeline.status !== "ready");
      if (revoked || cutoff)
        channelHistoryAccess.set(chosen, { revoked, cutoff });
      else if (previous) channelHistoryAccess.delete(chosen);
    }
  }, [
    chosen,
    historyDenied,
    channelHistoryAccess,
    directoryDenied,
    retainedChannels,
    timeline.firstInaccessiblePostTime,
    timeline.status,
  ]);
  useLayoutEffect(() => {
    if (!confirmedChannelIds) return;
    for (const id of retainedChannels.keys())
      if (!confirmedChannelIds.has(id)) retainedChannels.delete(id);
    for (const id of channelHistoryAccess.keys())
      if (!confirmedChannelIds.has(id)) channelHistoryAccess.delete(id);
  }, [confirmedChannelIds, retainedChannels, channelHistoryAccess]);
  const notificationKind =
    !historyDenied &&
    channel?.deleteAt === 0 &&
    (channel.kind === "O" || channel.kind === "P" || channel.kind === "G")
      ? channel.kind
      : null;
  if (notificationRoom && (notificationRoom !== chosen || !notificationKind))
    setNotificationRoom(null);
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
  const selection = inbox.selection;
  const selectionRow = selection?.row;
  const panePost = selection ? selection.post : activeThread;
  const paneId = selection?.id ?? activeThread?.id;
  function closeInboxThread() {
    publishedReading?.interrupt();
    position?.readingReturn?.thread?.close();
    setClosedRequest(position?.request.requestId ?? null);
    inbox.closeThread();
  }
  const pinsSource =
    collections.view?.kind === "pins" ? collections.view.channelId : null;
  const pinsRoom = pinsSource
    ? channels?.find((room) => room.id === pinsSource)
    : undefined;
  const pinsAvailable =
    !pinsSource ||
    (!directoryDenied &&
      !(chosen === pinsSource && historyDenied) &&
      pinsRoom !== undefined);
  const deniedPinsChannel = historyDenied ? chosen : null;
  const { retainPins, close: closeCollection } = collections;
  useLayoutEffect(() => {
    retainPins(confirmedChannelIds, deniedPinsChannel);
  }, [retainPins, confirmedChannelIds, deniedPinsChannel]);
  useLayoutEffect(() => {
    if (!pinsAvailable) closeCollection(false);
  }, [pinsAvailable, closeCollection]);
  const mentionPolicyChanged =
    collections.view?.kind === "mentions" &&
    collections.view.archivedChannels !== archivePolicy;
  function openCollectionRow(
    id: string,
    origin: HTMLButtonElement,
    scroll: number,
    offset?: number,
  ) {
    const view = collections.view;
    if (!view) return;
    const ids =
      view.kind === "mentions"
        ? (collections.mentionState?.items.map((row) => row.id) ?? [])
        : view.kind === "all"
          ? newestCollectionItems(collections.state?.value?.items ?? []).map(
              (row) => row.id,
            )
          : [id];
    collections.origin.current = {
      id,
      channelId: chosen,
      scroll,
      offset: view.kind === "all" ? offset : undefined,
      ids,
      partial:
        view.kind === "mentions"
          ? collections.mentionState?.nextPage != null
          : view.kind === "all" && collections.state?.continuation !== "none",
      reading:
        view.kind === "pins"
          ? null
          : (readChannelPlace() ?? collectionReading.current),
    };
    openCollectionPost(id, origin);
  }
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
  const readingBackVisible =
    page === "conversation" &&
    !directoryOpen &&
    Boolean(readingReturn?.previous);
  function workspaceBack() {
    if (appearanceOpen) return () => setAppearanceOpen(false);
    if (channelMenuOpen)
      return () => {
        setChannelMenuOpen(false);
        channelMenuButton.current?.focus();
      };
    if (
      search.dialog ||
      ((directoryOpen || inbox.visible) && visibleSearchPanel)
    )
      return search.back;
    if (directoryOpen)
      return () => {
        restoreDirectoryFocus.current = true;
        setDirectoryOpen(false);
        if (compact || !chosen) setPage("navigation");
      };
    if (selection) return closeInboxThread;
    if (inbox.visible && compact && page !== "navigation")
      return () => setPage("navigation");
    if (readingBackVisible && !activeThread) return null;
    if (readingBackVisible) return closeThread;
    if (manualThread) return closeThread;
    if (savedSource) return returnToSaved;
    if (collectionDestination) return returnToCollection;
    if (collections.view && !position) return () => collections.close();
    if (canReturnToResults) return returnToResults;
    if (visibleSearchPanel) return search.back;
    return activeThread ? closeThread : null;
  }
  function knownRoomName(room: NonNullable<typeof channel>) {
    return conversationName(
      room,
      userId,
      profiles,
      settings?.nameFormat ?? "username",
      language,
    );
  }
  const currentRoomName = channel
    ? (selectedRow?.displayName ?? knownRoomName(channel))
    : "";
  const channelTitle = channel
    ? selectedLabel ||
      currentRoomName ||
      (channel.kind === "D" ? text.conversation.D : text.nav)
    : text.choose;
  let channelDescription = "";
  if (channel) {
    const { kind } = channel;
    if (channel.deleteAt > 0) channelDescription = text.conversation.archived;
    else {
      channelDescription = channel.header
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" · ");
      if (!channelDescription) {
        if (kind === "D" && directPartnerId(channel.name, userId) === userId)
          channelDescription = text.conversation.self;
        else if (kind === "O" || kind === "P" || kind === "D" || kind === "G")
          channelDescription = text.conversation[kind];
      }
    }
  }
  const roomTitle = roomHeading(channelTitle, channel?.kind);
  const pinsInCurrentRoom = pinsSource === channel?.id;
  const pinsName = pinsRoom
    ? pinsInCurrentRoom
      ? currentRoomName
      : knownRoomName(pinsRoom)
    : "";
  const pinsTitle =
    pinsRoom && pinsName.trim()
      ? pinsInCurrentRoom
        ? roomTitle
        : roomHeading(pinsName, pinsRoom.kind)
      : undefined;
  const inboxRoom = selection?.post
    ? inboxRooms?.get(selection.post.channelId)
    : undefined;
  const displayedRoom = inbox.visible ? inboxRoom : channel;
  const displayedTitle = inbox.visible
    ? (inboxRoom && inboxRoomName(inboxRoom.id)) || ""
    : roomTitle;
  const presentationScope = JSON.stringify([
    connection.rid,
    team.id,
    chosen,
    paneId,
    selection?.post?.id,
    inbox.visible,
    position?.request.requestId,
    page,
    directoryOpen,
    historyDenied,
    collections.view?.key,
    Boolean(search.panel),
  ]);
  const attachments = useAttachmentWindow(
    workspace,
    presentationScope,
    displayedTitle,
  );
  const reader = usePublishedReaderWindow(
    presentationScope,
    inbox.visible || channel ? displayedTitle : (selectedLabel ?? ""),
  );
  const actions = usePostActionScope(
    presentationScope,
    workspace.serverUrl,
    team.name,
    userId,
    language,
    postingAccess(displayedRoom) === "writable",
    connection,
    online,
    sessionIssue,
  );
  const overlayOpen =
    accountOverlay !== null ||
    notificationRoom !== null ||
    workspace.messages.dialogOpen ||
    Boolean(attachments.selected) ||
    Boolean(reader.opening) ||
    Boolean(actions.anchor);
  const readingBlocked = overlayOpen || Boolean(workspace.systemPost);
  function backToReading() {
    if (settings && !readingBlocked)
      readingReturn?.back(settings.collapsedThreads);
  }
  const backWorkspace = workspaceBack();
  useWorkspaceBack(
    overlayOpen,
    backWorkspace,
    readingBackVisible && !appearanceOpen && !channelMenuOpen && !search.dialog
      ? backToReading
      : backWorkspace,
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
      );
      return;
    }
    if (
      ["offline", "network", "storage", "superseded", "positionLost"].includes(
        timeline.status,
      )
    ) {
      request.stop("failed");
      return;
    }
    const scene = host.current;
    if (
      !timeline.focus ||
      !scene ||
      (timeline.focus.focusedReply && confirmedThread !== request)
    )
      return;
    const inThread = Boolean(timeline.focus.focusedReply);
    const check = () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement)
        confirmVisiblePost(request, scene, focused, inThread);
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
  const threadRootId = panePost?.rootId ?? panePost?.id ?? null;
  const threadRoom = snapshot?.data.channels.find(
    (room) => room.id === panePost?.channelId,
  );
  const threadLabel =
    threadRoom && (selection ? inboxRoomName(threadRoom.id) : roomTitle);
  const linkNavigation = useMemo(() => {
    if (!publishedLinks || !publishedReading) return publishedLinks;
    return {
      serverUrl: publishedLinks.serverUrl,
      open(href: string, anchor: HTMLAnchorElement) {
        const scene = host.current;
        const request = position?.system;
        if (
          scene &&
          request?.publishedFromTeam &&
          timeline.focus &&
          (!timeline.focus.focusedReply || confirmedThread === request)
        )
          confirmVisiblePost(
            request,
            scene,
            anchor,
            Boolean(timeline.focus.focusedReply),
          );
        let collection: PublishedReadingOrigin["collection"];
        if (position?.saved) {
          collection = {
            kind: "saved-team",
            postId: position.request.post.id,
            source: position.saved,
          };
        } else if (collectionDestination && collectionOrigin) {
          const source = collectionDestination;
          collection = {
            kind: "workspace",
            row: {
              ...collectionOrigin,
              id: position?.request.post.id ?? collectionOrigin.id,
            },
            source:
              source.kind === "all"
                ? { kind: "all" }
                : source.kind === "pins"
                  ? { kind: "pins", channelId: source.channelId }
                  : {
                      kind: "mentions",
                      archivedChannels: source.archivedChannels,
                      standalone: source.standalone,
                    },
          };
        }
        const origin = scene?.contains(anchor)
          ? capturePublishedReadingOrigin(anchor, {
              teamId: team.id,
              channelId: chosen ?? undefined,
              threadRootId,
              threadChannelId: panePost?.channelId,
              label: roomTitle,
              threadLabel,
              collection,
              inbox:
                selection && inboxMain.current && inboxList.current
                  ? { ...inboxMain.current, list: inboxList.current }
                  : undefined,
            })
          : null;
        publishedLinks.open(
          href,
          anchor,
          origin
            ? publishedReading.capture(origin, { serverUrl, userId })
            : undefined,
        );
      },
    };
  }, [
    publishedLinks,
    publishedReading,
    chosen,
    team.id,
    threadRootId,
    panePost?.channelId,
    selection,
    roomTitle,
    threadLabel,
    position,
    timeline.focus,
    confirmedThread,
    collectionDestination,
    collectionOrigin,
    serverUrl,
    userId,
  ]);
  const landedReading = useRef<number | undefined>(undefined);
  const linkPlacement = position?.readingReturn;
  const visibleLinkPlacement =
    focusRequest?.requestId !== closedRequest &&
    linkPlacement?.threadRoot?.id === threadRootId
      ? linkPlacement
      : undefined;
  const readingReady = readingInbox
    ? inbox.visible && selection?.post?.id === linkPlacement?.origin.rootId
    : timeline.focus?.requestId === focusRequest?.requestId;
  const reportReadingLanding = useEffectEvent(
    (id: number, notice?: PublishedLinkLanding) =>
      readingReturn?.landed(id, notice),
  );
  useLayoutEffect(() => {
    if (
      !linkPlacement ||
      !focusRequest ||
      !readingReady ||
      landedReading.current === focusRequest.requestId
    )
      return;
    const id = focusRequest.requestId;
    const origin = linkPlacement.origin;
    let frame: number;
    let revealed = false;
    let checkedResize = false;
    let clear: (() => void) | undefined;
    const focus = () => {
      const pane = host.current?.querySelector<HTMLElement>(
        origin.rootId
          ? ".thread-feed"
          : ".channels-conversation .timeline-scroll",
      );
      const row = pane?.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(origin.postId)}"]`,
      );
      if (!pane || !row || row.closest("[inert], [hidden]")) return;
      const destination = publishedOriginLink(row, origin.link);
      const link = "link" in destination ? destination.link : undefined;
      const disclosure =
        !revealed &&
        link &&
        (origin.link.expanded ||
          link.closest(
            "[data-post-disclosure-clipped], [data-card-disclosure-clipped]",
          )) &&
        link
          .closest("[data-published-disclosure]")
          ?.querySelector<HTMLButtonElement>(
            "[data-published-disclosure-action][aria-expanded=false]",
          );
      if (disclosure) {
        revealed = true;
        disclosure.click();
        frame = requestAnimationFrame(focus);
        return;
      }
      const offset = origin.reading.anchors[0]?.offset;
      if (offset !== undefined)
        pane.scrollTop +=
          row.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          offset;
      const visibleLink =
        link && !link.closest("[inert], [hidden]") ? link : null;
      if (visibleLink) {
        const linkBounds = visibleLink.getBoundingClientRect();
        const paneBounds = pane.getBoundingClientRect();
        const shift =
          origin.link.offsetInPost === undefined
            ? 0
            : linkBounds.top -
              row.getBoundingClientRect().top -
              origin.link.offsetInPost;
        // The thread viewport is clipped by its frame while its ResizeObserver
        // is still applying the new height after the return bar changes.
        const frameBounds = pane
          .closest(".timeline-frame")
          ?.getBoundingClientRect();
        const top = Math.max(
          paneBounds.top,
          frameBounds?.top ?? paneBounds.top,
        );
        const bottom = Math.min(
          paneBounds.bottom,
          frameBounds?.bottom ?? paneBounds.bottom,
        );
        const outside = linkBounds.bottom <= top || linkBounds.top >= bottom;
        const partlyHidden = linkBounds.top < top || linkBounds.bottom > bottom;
        if (outside || (partlyHidden && Math.abs(shift) > 1)) {
          const targetTop =
            pane.scrollTop +
            (linkBounds.top < top
              ? Math.floor(linkBounds.top - top)
              : Math.ceil(linkBounds.bottom - bottom));
          pane.scrollTop = targetTop;
          if (
            !checkedResize &&
            paneBounds.bottom > bottom + 1 &&
            pane.scrollTop < targetTop - 1
          ) {
            // At the end of a thread, the previous feed height can still limit
            // the scroll range. Give its size observer one rendering step.
            checkedResize = true;
            frame = requestAnimationFrame(focus);
            return;
          }
        }
      } else {
        row.tabIndex = -1;
      }
      (visibleLink ?? row).focus({ preventScroll: true });
      landedReading.current = id;
      clear = showPostArrival(row);
      reportReadingLanding(
        id,
        "notice" in destination
          ? destination.notice
          : visibleLink
            ? undefined
            : "unmatchedLink",
      );
    };
    frame = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(frame);
      clear?.();
    };
  }, [focusRequest, linkPlacement, readingReady]);
  const restoredReadingCollection = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (
      !linkPlacement ||
      !focusRequest ||
      restoredReadingCollection.current === focusRequest.requestId
    )
      return;
    restoredReadingCollection.current = focusRequest.requestId;
    setPage("conversation");
    const collection = linkPlacement.origin.collection;
    if (collection?.kind !== "workspace" || !savedButton.current) return;
    if (collections.view?.kind !== collection.source.kind)
      collections.open(collection.source, savedButton.current);
    collections.origin.current = collection.row;
  });
  const lastReadingNotice = useRef(readingReturn?.notice);
  useLayoutEffect(() => {
    const notice = readingReturn?.notice;
    if (lastReadingNotice.current === notice) return;
    lastReadingNotice.current = notice;
    if (notice !== "offline" && notice !== "failed" && notice !== "unavailable")
      return;
    const root = host.current;
    (
      root?.querySelector<HTMLElement>(".published-reading-back") ??
      root?.querySelector<HTMLElement>(".published-reading-status")
    )?.focus({ preventScroll: true });
  }, [readingReturn?.notice]);
  function composer(
    rootId?: string,
    reader?: ReactionThread,
    acceptedReply?: () => void,
  ) {
    const target = rootId && selection ? inboxRoom : channel;
    if ((!selection || !rootId) && historyDenied) return null;
    const access = postingAccess(target);
    if (access !== "writable" || !target) {
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
        channelId={target.id}
        rootId={rootId}
        conversation={{
          name:
            (target.id === chosen ? selectedLabel : knownRoomName(target)) ||
            target.displayName ||
            target.name,
          direct: target.kind === "D" || target.kind === "G",
        }}
        keys={policy.user?.composerKeys}
        sendContext={channelDraftActions(
          workspace,
          target,
          permission,
          settings?.collapsedThreads ?? null,
          search.fromCommand,
          reader,
          acceptedReply,
        )}
        label={rootId ? draftText.reply : draftLabel()}
        language={language}
        online={online}
        sessionIssue={sessionIssue}
        fieldRef={rootId ? replyField : draftField}
      />
    );
  }
  const readingShown = Boolean(
    (readingReturn?.previous || readingReturn?.notice) &&
      !directoryOpen &&
      page === "conversation",
  );
  const readingSource = readingReturn?.previous;
  const readingLabel =
    readingSource &&
    readingSource.teamId === team.id &&
    snapshot?.data.channels.some(({ id }) => id === readingSource.channelId)
      ? readingSource.label
      : undefined;
  const statusInCollection =
    readingShown &&
    !readingSource &&
    (savedSource ||
      (collectionOrigin &&
        collectionDestination &&
        collectionDestination.kind !== "pins"));
  const collectionReadingStatus = statusInCollection && (
    <PublishedReadingStatus
      notice={readingReturn?.notice}
      language={language}
    />
  );
  const savedLinkReturn = readingSource && readingReturn?.saved;
  const readingInThread = readingShown && Boolean(panePost);
  const savedLinkButton = savedLinkReturn && (
    <button
      type="button"
      className="collection-step-back"
      onClick={(event) => {
        if (
          savedLinkReturn.source.teamId === team.id &&
          collections.view?.kind === "all" &&
          collections.origin.current
        )
          restoreCollection(savedLinkReturn.postId);
        else void workspace.messages.returnToSaved(event.currentTarget);
      }}
    >
      {collectionLabels.savedBack}
    </button>
  );
  const readingBar = readingShown && !statusInCollection && (
    <PublishedReadingReturn
      previous={Boolean(readingSource)}
      source={readingLabel}
      notice={readingReturn?.notice}
      language={language}
      blocked={readingBlocked || !settings}
      back={backToReading}
    >
      {(!readingInThread || compact) && savedLinkButton}
    </PublishedReadingReturn>
  );
  const readingMainBar =
    readingInThread && !compact && savedLinkButton ? (
      <div className="collection-result-steps">
        <span className="collection-step-source" aria-hidden="true">
          <CollectionMark kind="all" />
          <span>{collectionLabels.saved}</span>
        </span>
        {savedLinkButton}
      </div>
    ) : null;
  const content = (
    <div ref={host} className="workspace-window">
      <ChannelsFrame
        language={language}
        standalonePanel={
          collections.view?.kind === "mentions" &&
          collections.mentionState !== null &&
          !mentionPolicyChanged &&
          collections.view.standalone
        }
        labels={{
          navigation: text.nav,
          account: text.account,
          chooseTeam: text.switchTeam,
          closeThread: text.closeThread,
        }}
        searchTrigger={search.trigger}
        toolbar={
          <>
            <button
              type="button"
              className="channels-icon-action mentions-trigger"
              aria-label={mentionLabels.title}
              title={mentionLabels.title}
              disabled={archivePolicy === undefined}
              onClick={(event) => {
                if (archivePolicy !== undefined)
                  showCollection(
                    {
                      kind: "mentions",
                      archivedChannels: archivePolicy,
                      standalone: !chosen,
                    },
                    event.currentTarget,
                  );
              }}
            >
              <MentionMark />
            </button>
            <button
              type="button"
              className="channels-icon-action collection-saved-trigger"
              ref={savedButton}
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
            <button
              ref={appearanceButton}
              type="button"
              className="channels-icon-action appearance-trigger"
              title={appearanceLabel}
              aria-label={appearanceLabel}
              aria-haspopup="dialog"
              onClick={() => {
                setAppearanceNotice("");
                setAppearanceOpen(true);
              }}
            >
              <AppearanceMark name="palette" />
            </button>
          </>
        }
        channelHeading={
          inbox.visible
            ? (id, ref) => (
                <div className="inbox-heading panel-heading">
                  <div>
                    <ThreadMark />
                    <h1
                      className="panel-heading__title"
                      id={id}
                      ref={ref}
                      tabIndex={-1}
                    >
                      {inboxText.title}
                    </h1>
                  </div>
                  <span className="panel-heading__detail">
                    {inboxText.description}
                  </span>
                </div>
              )
            : !directoryOpen && channel && !historyDenied
              ? (id, ref) => (
                  <CollectionChannelMenu
                    headingId={id}
                    headingRef={ref}
                    title={channelTitle}
                    description={channelDescription}
                    kind={channel.kind}
                    archived={channel.deleteAt > 0}
                    language={language}
                    compact={compact}
                    trigger={channelMenuButton}
                    open={channelMenuOpen}
                    setOpen={setChannelMenuOpen}
                    onNotifications={
                      notificationKind
                        ? () => {
                            setChannelMenuOpen(false);
                            setNotificationRoom(channel.id);
                          }
                        : undefined
                    }
                    onPins={(opener) =>
                      showCollection(
                        { kind: "pins", channelId: channel.id },
                        opener,
                      )
                    }
                  />
                )
              : directoryOpen
                ? (id, ref) => (
                    <DirectoryHeading
                      id={id}
                      heading={ref}
                      title={directoryTitle}
                      teamName={teamName}
                    />
                  )
                : undefined
        }
        navigationIcon={directoryOpen ? <DirectoryNavigationIcon /> : undefined}
        sidePanel={
          position ? null : collections.view &&
            collections.mentionState &&
            !mentionPolicyChanged &&
            collections.view.kind === "mentions" ? (
            <MentionsPane
              compact={compact}
              key={collections.view.key}
              state={collections.mentionState}
              model={collections.view.model}
              language={language}
              team={team.displayName || team.name}
              online={online}
              standalone={collections.view.standalone}
              authorName={(id) => author(id)?.name}
              channelName={(id) => {
                const room = resultRooms.get(id);
                if (!room) return undefined;
                return room.kind === "O" || room.kind === "P"
                  ? `# ${room.title}`
                  : room.title;
              }}
              openRow={openCollectionRow}
              restore={collections.restore}
              close={() => collections.close()}
            />
          ) : collections.view &&
            collections.view.kind !== "mentions" &&
            collections.state &&
            pinsAvailable ? (
            <PostCollectionPane
              compact={compact}
              key={collections.view.key}
              model={collections.view.model}
              state={collections.state}
              kind={collections.view.kind}
              roomTitle={pinsTitle}
              language={language}
              online={online}
              canRemove={
                collections.view.kind === "all" ||
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
              channelInfo={(id) => resultRooms.get(id)}
              authorName={(id) => author(id)?.name}
              savedIds={knownSaves.ids}
              restore={collections.restore}
              pinnedReading={collections.pinnedReading}
              openRow={openCollectionRow}
              close={() => collections.close()}
            />
          ) : (
            search.panel
          )
        }
        threadReturn={readingInThread ? readingBar : undefined}
        resultReturn={
          readingShown && !statusInCollection
            ? readingInThread
              ? readingMainBar
              : readingBar
            : position && (
                <>
                  {position.membership && (
                    <span className="search-membership" role="status">
                      {position.membership}
                    </span>
                  )}
                  {savedSource && (
                    <CollectionResultSteps
                      name={collectionLabels.saved}
                      icon={<CollectionMark kind="all" />}
                      backLabel={collectionLabels.savedBack}
                      language={language}
                      sourceTeam={savedSource.teamName}
                      remind={() =>
                        setSavedReminder((previous) => ({
                          source: savedSource,
                          sequence: (previous?.sequence ?? 0) + 1,
                        }))
                      }
                      blocked={!online || workspace.messages.dialogOpen}
                      back={returnToSaved}
                      end={endCollection}
                    >
                      {collectionReadingStatus}
                    </CollectionResultSteps>
                  )}
                  {collectionOrigin &&
                    collectionDestination &&
                    (collectionDestination.kind === "pins" ? (
                      <button
                        type="button"
                        className="search-return"
                        onClick={returnToCollection}
                      >
                        {collectionLabels.pinsBack}
                      </button>
                    ) : (
                      <CollectionResultSteps
                        name={
                          collectionDestination.kind === "mentions"
                            ? mentionLabels.title
                            : collectionLabels.saved
                        }
                        icon={
                          collectionDestination.kind === "mentions" ? (
                            <MentionMark />
                          ) : (
                            <CollectionMark kind="all" />
                          )
                        }
                        backLabel={
                          collectionDestination.kind === "mentions"
                            ? mentionLabels.back
                            : collectionLabels.savedBack
                        }
                        language={language}
                        steps={{
                          index: collectionIndex,
                          count: collectionOrigin.ids.length,
                          partial: collectionOrigin.partial,
                          open: stepCollection,
                        }}
                        blocked={
                          !online ||
                          workspace.messages.dialogOpen ||
                          Boolean(attachments.selected) ||
                          Boolean(reader.opening) ||
                          Boolean(actions.anchor)
                        }
                        back={returnToCollection}
                        end={endCollection}
                      >
                        {collectionReadingStatus}
                      </CollectionResultSteps>
                    ))}
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
        draftRef={inbox.visible || directoryOpen ? undefined : draftField}
        focusConversation={directoryOpen ? focusDirectory : undefined}
        focusChannelChange={
          selected?.id !== chosen || selected?.focus !== false
        }
        accountName={accountName}
        accountDescription={
          accountName ? undefined : teamChoiceText[language].profilePending
        }
        teamName={teamName}
        channel={
          inbox.visible
            ? { id: "team-threads", title: inboxText.title }
            : directoryOpen
              ? { id: "team-directory", title: directoryTitle }
              : channel
                ? {
                    id: channel.id,
                    title: historyDenied ? text.forbidden : channelTitle,
                  }
                : null
        }
        emptyTitle={
          canReturnToResults
            ? (directoryIssue ?? (snapshot ? text.forbidden : text.noCache))
            : text.choose
        }
        page={
          collectionDestination
            ? "conversation"
            : inbox.visible || chosen || directoryOpen || canReturnToResults
              ? page
              : "navigation"
        }
        onNavigation={() => {
          if (!inbox.visible && !inbox.paused) {
            rememberChannelReading();
            rememberInboxChannel();
          }
          publishedReading?.interrupt();
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
          setAccountOverlay({ kind: "account" });
        }}
        onTeam={(opener) => setAccountOverlay({ kind: "team", opener })}
        navigation={nav}
        inboxPlaceholder={
          inbox.visible
            ? {
                title: inboxText.discussion,
                message: inboxText.pick,
              }
            : undefined
        }
        thread={
          paneId && settings
            ? {
                id: paneId,
                title: text.thread,
                subtitle: inbox.slow
                  ? inboxText.refreshingWindow
                  : selection?.post
                    ? inboxRoomName(selection.post.channelId)
                    : channel?.id === panePost?.channelId
                      ? roomTitle
                      : undefined,
                unavailable:
                  selection?.issue === "forbidden" ||
                  selection?.issue === "limited",
                retainOpener: Boolean(selection),
                close: selection ? closeInboxThread : closeThread,
                replyRef:
                  selection || panePost?.rootId || isMobile
                    ? undefined
                    : replyField,
                controlsRef:
                  settings.collapsedThreads && panePost
                    ? setThreadControls
                    : undefined,
                content: panePost ? (
                  <ThreadPane
                    key={JSON.stringify([
                      connection.rid,
                      panePost.channelId,
                      panePost.id,
                      position?.system ? position.request.requestId : null,
                      settings.collapsedThreads,
                    ])}
                    connection={connection}
                    userId={userId}
                    post={panePost}
                    teamId={team.id}
                    controlsHost={threadControls}
                    confirmFollowing={inbox.confirmFollowing}
                    prepared={visibleLinkPlacement?.thread}
                    preparedRoot={visibleLinkPlacement?.threadRoot}
                    returningToLink={Boolean(visibleLinkPlacement)}
                    arrivalRequest={
                      timeline.focus?.focusedReply === panePost &&
                      closedRequest !== timeline.focus.requestId
                        ? timeline.focus.requestId
                        : undefined
                    }
                    collapsedThreads={settings.collapsedThreads}
                    locale={language}
                    nameFormat={settings.nameFormat}
                    author={author}
                    online={online}
                    sessionIssue={sessionIssue}
                    inboxWindow={
                      selection
                        ? {
                            confirmedRoot: selection.confirmedRoot,
                            opening: selection.opening,
                            retained: selection.parked,
                            restoreFocus: selection.restoreFocus,
                            park: inbox.model?.parkWindow,
                            register: inbox.registerWindow,
                          }
                        : undefined
                    }
                    lastViewedAt={
                      selectionRow && selectionRow.unreadReplies > 0
                        ? selectionRow.lastViewedAt
                        : undefined
                    }
                    confirmView={
                      selectionRow &&
                      selectionRow.unreadReplies > 0 &&
                      selection?.confirmedRoot &&
                      !visibleLinkPlacement &&
                      !overlayOpen &&
                      !appearanceOpen &&
                      !channelMenuOpen &&
                      !search.dialog &&
                      !visibleSearchPanel &&
                      !collections.view
                        ? inbox.confirmView
                        : undefined
                    }
                    readVisit={
                      selection?.confirmedRoot ? selection.visit : undefined
                    }
                    checkView={
                      selection?.confirmedRoot && selection.visit
                        ? inbox.checkView
                        : undefined
                    }
                    onOpened={
                      selection
                        ? () => inbox.finishOpening(selection.id)
                        : position?.system
                          ? () => setConfirmedThread(position.system)
                          : undefined
                    }
                    onUnavailable={
                      selection
                        ? (reason) => {
                            inbox.finishOpening(selection.id);
                            if (reason !== "failed")
                              inbox.hideRoot(selection.id, reason);
                          }
                        : position?.system
                          ? (reason) =>
                              position.system?.stop(
                                reason === "limited"
                                  ? "archived"
                                  : reason === "failed"
                                    ? "failed"
                                    : "unavailable",
                              )
                          : undefined
                    }
                    renderComposer={composer}
                  />
                ) : (
                  <div
                    className="inbox-status"
                    role={selection?.issue ? "alert" : "status"}
                  >
                    {selection?.issue === "limited"
                      ? inboxText.limited
                      : selection?.retainedAccessRevoked &&
                          selection.issue === "forbidden"
                        ? inboxText.accessRevoked
                        : selection?.issue &&
                            selection.issue !== "network" &&
                            selection.issue !== "storage"
                          ? inboxText.unavailable
                          : selection?.issue === "storage"
                            ? text.storage
                            : selection?.issue
                              ? text.network
                              : inboxText.opening}
                    {selectionRow &&
                      (selection?.issue === "network" ||
                        selection?.issue === "storage") && (
                        <button
                          type="button"
                          onClick={() => void inbox.choose(selectionRow)}
                        >
                          {text.retry}
                        </button>
                      )}
                  </div>
                ),
              }
            : undefined
        }
        composer={
          <div
            className="workspace-conversation-route channel-composer"
            hidden={directoryOpen || inbox.visible}
            style={
              returningComposerHeight
                ? ({
                    "--retained-channel-composer-height": `${returningComposerHeight}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {composer()}
          </div>
        }
      >
        {(inbox.visible || inbox.paused) && inbox.model && inbox.state && (
          <div hidden={!inbox.visible} className="workspace-conversation-route">
            <ThreadInboxPane
              online={online}
              model={inbox.model}
              state={inbox.state}
              selected={inbox.selectedId}
              restoring={inbox.restoring}
              choose={inbox.choose}
              place={readingInbox?.list}
              capture={(place) => {
                inboxList.current = place;
              }}
              locale={language}
              author={author}
              channel={inboxRoomName}
            />
          </div>
        )}
        <div hidden={!directoryOpen} className="workspace-conversation-route">
          <TeamChannelDirectory
            key={directoryScope}
            ref={directoryReturn}
            visible={directoryOpen}
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
        </div>
        <div
          className="workspace-conversation-route"
          hidden={directoryOpen || inbox.visible}
        >
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
                restoredPosition={
                  restoration?.place && timeline.page
                    ? {
                        requestId: restoration.request.requestId,
                        place: restoration.place,
                      }
                    : undefined
                }
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
                  !linkPlacement &&
                  timeline.focus &&
                  !timeline.focus.focusedReply
                    ? timeline.focus
                    : undefined
                }
                onOpenThread={(post) => {
                  publishedReading?.interrupt();
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
      {notificationRoom && notificationRoom === chosen && notificationKind && (
        <ChannelNotificationsDialog
          account={connection}
          channelId={notificationRoom}
          kind={notificationKind}
          name={channelTitle}
          language={language}
          online={online}
          collapsed={settings?.collapsedThreads === true}
          saved={directory.retry}
          sessionIssue={sessionIssue}
          back={() => {
            setNotificationRoom(null);
            setChannelMenuOpen(true);
          }}
          dismiss={() => {
            restoreChannelTitle.current = true;
            setNotificationRoom(null);
          }}
        />
      )}
      {appearanceOpen && (
        <Suspense fallback={null}>
          <AppearanceDialog
            language={language}
            close={() => setAppearanceOpen(false)}
            opener={appearanceButton}
            applied={setAppearanceNotice}
          />
        </Suspense>
      )}
      {appearanceNotice && (
        <div className="appearance-notice" role="status">
          <AppearanceMark name="check" />
          {appearanceNotice}
        </div>
      )}
      {accountOverlay?.kind === "account" && (
        <AccountSessionWindow
          workspace={workspace}
          language={language}
          accountName={accountName}
          address={serverAddress}
          focusTeamChoice={accountOverlay.focusTeamChoice}
          onTeamChoice={() => setAccountOverlay({ kind: "team-from-account" })}
          onDismiss={closed}
        />
      )}
      {accountOverlay && accountOverlay.kind !== "account" && (
        <TeamSwitchDialog
          workspace={workspace}
          language={language}
          address={serverAddress}
          accountName={accountName}
          onBack={
            accountOverlay.kind === "team-from-account"
              ? () =>
                  setAccountOverlay({ kind: "account", focusTeamChoice: true })
              : undefined
          }
          onClose={closeTeamChoice}
        />
      )}
      {actions.notice && !revocationActive && (
        <div className="post-action-notice" role="status">
          {actions.notice.message}
        </div>
      )}
      {(savedSource || savedRevoked) && (
        <div role="status">
          {savedReminder && savedReminder.source === savedSource && (
            <span
              key={savedReminder.sequence}
              className="post-action-notice saved-return-notice"
            >
              {collectionLabels.savedIn(savedReminder.source.teamName)}
            </span>
          )}
          {revocationActive && (
            <span className="post-action-notice saved-return-notice">
              {collectionLabels.revokedSource(savedRevoked.name)}
            </span>
          )}
        </div>
      )}
    </div>
  );
  return (
    <PublishedLinkNavigation.Provider value={linkNavigation}>
      <AttachmentWindow value={attachments}>
        <PublishedReaderWindow value={reader.value}>
          <PostActionScope value={actions}>{content}</PostActionScope>
          <PublishedTableScreen reader={reader} />
          <PublishedCodeReader reader={reader} />
        </PublishedReaderWindow>
      </AttachmentWindow>
    </PublishedLinkNavigation.Provider>
  );
}
