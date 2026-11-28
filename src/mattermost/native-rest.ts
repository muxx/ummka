import { invoke } from "@tauri-apps/api/core";
import {
  type ChannelNotifyProps,
  ChannelsApi,
  CommandsApi,
  Configuration,
  FilesApi,
  PostsApi,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { isAndroid } from "../build-platform.ts";
import { accountBookmarkChanges } from "./account-bookmark-changes.ts";
import { accountChannelReadState } from "./account-channel-read-state.ts";
import { readCustomEmoji } from "./account-custom-emoji.ts";
import { accountDelivery } from "./account-delivery.ts";
import { atDirectoryStep } from "./account-directory-error.ts";
import { accountFollowedThreads } from "./account-followed-threads.ts";
import { accountPostCollections } from "./account-post-collections.ts";
import { accountPostReactions } from "./account-post-reactions.ts";
import {
  type ProfileImageIdentity,
  readProfileImage,
} from "./account-profile-image.ts";
import { accountSearch } from "./account-search.ts";
import { accountChannelAudience } from "./channel-audience.ts";
import { readChannelBookmarks } from "./channel-bookmarks.ts";
import {
  type DirectoryPageQuery,
  readChannelDirectoryPage,
  searchChannelDirectory,
} from "./channel-directory-page.ts";
import { createChannelHistoryChanges } from "./channel-history-changes.ts";
import {
  type ChannelRefreshRequest,
  type ChannelRefreshResult,
  refreshChannelHistory,
} from "./channel-history-refresh.ts";
import { readChannelIdentity } from "./channel-identity.ts";
import {
  type ChannelMemberQuery,
  readChannelMemberDirectory,
} from "./channel-member-directory.ts";
import {
  readChannelNotifications,
  updateChannelNotifications,
} from "./channel-notifications.ts";
import {
  fetchTeamRoleSnapshot,
  type TeamRoleSnapshot,
} from "./channel-permissions.ts";
import { channelPostChange } from "./channel-post-records.ts";
import type { ChannelProfile } from "./channel-profiles.ts";
import type { ChannelsTarget } from "./channels-link.ts";
import {
  type KnownChannelName,
  resolveConversationIdentifier,
} from "./conversation-link-identifier.ts";
import {
  type RecipientPage,
  type RecipientQuery,
  readConversationRecipients,
} from "./conversation-recipients.ts";
import { executeAccountCommand } from "./execute-account-command.ts";
import {
  type CommandIntent,
  executeSavedCommand,
} from "./execute-saved-command.ts";
import type {
  CardRevision,
  CardSnapshot,
  IntegrationCard,
} from "./integration-cards.ts";
import { type JoinedTeams, projectJoinedTeams } from "./joined-teams.ts";
import { reopenKnownConversation } from "./known-conversation-visibility.ts";
import {
  type ConversationRecipientTarget,
  readConversationRecipient,
} from "./link-recipient.ts";
import type {
  ChannelWindowQuery,
  LocalChannelWindow,
  LocalPost,
} from "./local-history.ts";
import { accountMentionGroups } from "./mention-group-reads.ts";
import {
  PostObservationSuperseded,
  readChannelFile,
  readFileAnchor,
  readPostAnchor,
} from "./message-anchors.ts";
import { isMattermostId } from "./model-fields.ts";
import { readNamedChannelDestination } from "./named-channel-destination.ts";
import { nativeFetch } from "./native-fetch.ts";
import { loadAccountDirectory, loadTeamDirectory } from "./navigation-data.ts";
import { refreshNavigation } from "./navigation-refresh.ts";
import { readOwnChannelMembership } from "./own-channel-membership.ts";
import {
  changeOwnMembership,
  type MembershipChange,
  type MembershipTarget,
} from "./own-membership.ts";
import {
  deleteOwnPost,
  editOwnPostMessage,
  type OwnPostTarget,
} from "./own-post.ts";
import { createPostActivity } from "./post-activity.ts";
import { readPostFiles } from "./post-attachments.ts";
import { accountCollectionActions } from "./post-collection-actions.ts";
import { readPostDestination } from "./post-destination.ts";
import { readPostEditHistory } from "./post-edit-history.ts";
import { openRecentMentions } from "./recent-mentions.ts";
import { openRecipientConversation } from "./recipient-conversation.ts";
import { createRestTransport } from "./rest-transport.ts";
import {
  createSavedPostState,
  projectSavedPostMembership,
  type SavedPostMembership,
} from "./saved-post-state.ts";
import { readSearchTimezone } from "./search-timezone.ts";
import { canonicalServerUrl } from "./server-url.ts";
import { projectTeamSidebar, type TeamSidebar } from "./team-sidebar.ts";
import { readThreadPage, type ThreadPageRequest } from "./thread-page.ts";
import {
  loadVisibleProfiles,
  type VisibleProfileQuery,
} from "./visible-profiles.ts";

import {
  type SavedWorkspaceSettings,
  type ServerPolicy,
  sidebarPreferences,
} from "./workspace-preferences.ts";
import {
  type AccountEventRoute,
  loadWorkspaceConfiguration,
} from "./workspace-server.ts";

export async function getCurrentAccountId(
  serverUrl: string,
): Promise<string | null> {
  return invoke<string | null>("get_current_account_id", {
    serverUrl: canonicalServerUrl(serverUrl),
  });
}

export async function listAccountIds(serverUrl: string): Promise<string[]> {
  return invoke<string[]>("list_account_ids", {
    serverUrl: canonicalServerUrl(serverUrl),
  });
}

export async function forgetLocalAccount(
  serverUrl: string,
  userId: string,
): Promise<void> {
  return invoke<void>("forget_local_account", {
    serverUrl: canonicalServerUrl(serverUrl),
    userId,
  });
}

export function openNativeRestConnection(serverUrl: string) {
  return openConnection(serverUrl);
}

export type SavedProfiles = {
  profiles: Record<string, ChannelProfile>;
  usernames: Record<string, string>;
};

export type DraftLocation = { channelId: string; rootId?: string };
export type ComposerDraft = {
  message: string;
  revision: string | null;
  /** Present only when the cause of this empty revision is known. */
  clearedBySubmission?: boolean;
  /** The server may already have received the command from this revision. */
  commandPending?: true;
};
export type DraftSave = { kind: "saved" | "conflict"; draft: ComposerDraft };

export type AccountSignOut =
  | { status: "signed_out" }
  | { status: "unconfirmed" }
  | { status: "superseded" }
  | { status: "server_confirmed_local_removal_failed"; cause: string };

export async function openAccountRestConnection(
  serverUrl: string,
  userId: string,
) {
  if (typeof userId !== "string") {
    throw new TypeError("Missing Mattermost account ID");
  }
  const connection = await openConnection(serverUrl, userId);
  const { rid } = connection;
  const config = new Configuration(connection);
  const posts = new PostsApi(config);
  const channels = new ChannelsApi(config);
  const files = new FilesApi(config);
  const activity = createPostActivity();
  const historyChanges = createChannelHistoryChanges();
  const savedPosts = createSavedPostState();
  const accountLifetime = new AbortController();
  let retired:
    | "unknown_connection"
    | "cancelled"
    | "session_unavailable"
    | undefined;
  function retire(reason: NonNullable<typeof retired>) {
    retired = reason;
    accountLifetime.abort("cancelled");
    activity.close();
    historyChanges.close();
    savedPosts.close();
  }
  async function readWhileOpen<T>(
    read: () => Promise<T>,
    signal?: AbortSignal,
  ) {
    if (retired) throw retired;
    const result = await read();
    if (retired) throw "cancelled";
    signal?.throwIfAborted();
    return result;
  }
  function withAccountLifetime<T>(
    read: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    const active = signal
      ? AbortSignal.any([signal, accountLifetime.signal])
      : accountLifetime.signal;
    return readWhileOpen(() => read(active), active);
  }
  const readTeamSidebar = (teamId: string) =>
    invoke<TeamSidebar | null>("read_team_sidebar", { rid, teamId });
  const readWorkspaceSettings = () =>
    invoke<SavedWorkspaceSettings>("read_workspace_settings", { rid });
  const delivery = accountDelivery(rid, readWhileOpen, posts, userId, activity);
  const commands = new CommandsApi(config);
  const search = accountSearch(config, readWhileOpen);
  const historyWriter = {
    begin: (channelId: string) =>
      invoke<number>("begin_channel_history_load", { rid, channelId }),
    store: <Result = ChannelRefreshResult>(load: number, page: object) =>
      invoke<Result>("store_channel_history_page", {
        rid,
        load,
        page,
      }),
    cancel: async (load: number) => {
      try {
        await invoke<void>("cancel_channel_history_load", { rid, load });
      } catch (error) {
        // A closed resource has already discarded all its pending loads.
        if (error !== "unknown_connection" && error !== "cancelled")
          throw error;
      }
    },
  };
  let latestPolicyRead: symbol | undefined;
  let liveFileUpload: ServerPolicy["fileUpload"];
  function readSavedProfiles(query: VisibleProfileQuery) {
    return readWhileOpen(() =>
      invoke<SavedProfiles>("read_saved_profiles", { rid, query }),
    );
  }
  return {
    ...connection,
    resolveConversationIdentifier(
      target: Extract<ChannelsTarget, { kind: "conversation" }>,
      known?: KnownChannelName,
      signal?: AbortSignal,
    ) {
      return readWhileOpen(
        () =>
          resolveConversationIdentifier(config, userId, target, known, signal),
        signal,
      );
    },
    ...accountFollowedThreads(config, readWhileOpen),
    ...accountPostCollections(config, userId, readWhileOpen, savedPosts),
    ...accountCollectionActions(config, userId, readWhileOpen, savedPosts),
    getSavedPostPresentation: savedPosts.getPresentation,
    isSavedPostPending: savedPosts.isPending,
    subscribeToSavedPostState: savedPosts.subscribe,
    ...accountBookmarkChanges(config, userId, withAccountLifetime),
    ...accountPostReactions(config, userId, readWhileOpen),
    ...search,
    openRecentMentions(includeDeletedChannels: boolean, signal?: AbortSignal) {
      return readWhileOpen(
        () =>
          openRecentMentions(
            config,
            userId,
            search,
            includeDeletedChannels,
            signal,
          ),
        signal,
      );
    },
    async editOwnPostMessage(
      target: OwnPostTarget,
      message: string,
      signal?: AbortSignal,
    ) {
      const change = await readWhileOpen(
        () => editOwnPostMessage(posts, userId, target, message, signal),
        signal,
      );
      historyChanges.notify(change.channelId, signal, [change]);
      return change;
    },
    async deleteOwnPost(target: OwnPostTarget, signal?: AbortSignal) {
      const { channelId, id } = target;
      await readWhileOpen(
        () => deleteOwnPost(posts, userId, target, signal),
        signal,
      );
      historyChanges.notify(channelId, signal, [
        { kind: "remove", channelId, id },
      ]);
    },
    readPostEditHistory(target: OwnPostTarget, signal?: AbortSignal) {
      return readWhileOpen(
        () => readPostEditHistory(posts, userId, target, signal),
        signal,
      );
    },
    readThreadPage(query: ThreadPageRequest, signal?: AbortSignal) {
      return readWhileOpen(async () => {
        signal?.throwIfAborted();
        const { channelId, rootId } = query;
        const load = await historyWriter.begin(channelId);
        let page: Awaited<ReturnType<typeof readThreadPage>>;
        let changes: ReturnType<typeof channelPostChange>[] = [];
        try {
          if (retired) throw "cancelled";
          page = await readThreadPage(posts, query, signal);
          signal?.throwIfAborted();
          if (page.kind === "page") {
            changes = [page.root, ...page.replies].map((post) =>
              channelPostChange(channelId, post.id, post),
            );
          }
        } catch (error) {
          await historyWriter.cancel(load);
          throw error;
        }
        if (page.kind !== "page") {
          await historyWriter.cancel(load);
          return page;
        }
        const stored = await historyWriter.store<
          | { kind: "thread"; cards: (CardSnapshot | null)[] }
          | { kind: "superseded" }
        >(load, {
          channelId,
          collapsedThreads: false,
          source: { kind: "thread", rootId },
          order: [],
          changes,
        });
        if (stored.kind !== "thread") throw "cancelled";
        if (stored.cards.length !== changes.length)
          throw new TypeError("Incomplete cached thread observations.");
        const attachCards = (
          post: typeof page.root,
          index: number,
        ): typeof post & {
          cards?: readonly IntegrationCard[];
          cardRevision?: CardRevision;
        } => {
          const snapshot = stored.cards[index];
          return {
            ...post,
            cards: snapshot?.cards,
            cardRevision: snapshot
              ? {
                  updateAt: snapshot.updateAt,
                  dispatch: snapshot.dispatch,
                }
              : undefined,
          };
        };
        historyChanges.notify(channelId, signal, changes);
        return {
          ...page,
          root: attachCards(page.root, 0),
          replies: page.replies.map((post, index) =>
            attachCards(post, index + 1),
          ),
        };
      }, signal);
    },
    readSearchTimezone(signal?: AbortSignal) {
      return readWhileOpen(
        () => readSearchTimezone(config, userId, signal),
        signal,
      );
    },
    readChannelIdentity(channelId: string, signal?: AbortSignal) {
      return readWhileOpen(
        () => readChannelIdentity(new ChannelsApi(config), channelId, signal),
        signal,
      );
    },
    readPostAnchor(postId: string, signal?: AbortSignal) {
      return readWhileOpen(async () => {
        signal?.throwIfAborted();
        if (!isMattermostId(postId))
          throw new TypeError("Invalid Mattermost post ID.");
        const load = await invoke<number>("begin_cached_post_observation", {
          rid,
          postId,
        });
        let anchor: Awaited<ReturnType<typeof readPostAnchor>>;
        try {
          if (retired) throw "cancelled";
          anchor = await readPostAnchor(posts, postId, signal);
          if (retired) throw "cancelled";
          signal?.throwIfAborted();
        } catch (error) {
          if (!retired) {
            try {
              await invoke("finish_cached_post_observation", {
                rid,
                load,
                observation: null,
              });
            } catch (cause) {
              if (cause !== "unknown_connection" && cause !== "cancelled")
                throw cause;
            }
          }
          throw error;
        }
        const { channelId, post } = anchor;
        if (!post) {
          await invoke("finish_cached_post_observation", {
            rid,
            load,
            observation: null,
          });
          return anchor;
        }
        const accepted = await invoke<
          | { kind: "uncached" }
          | { kind: "unavailable" }
          | { kind: "superseded" }
          | { kind: "cached"; changed: boolean; cards: CardSnapshot | null }
        >("finish_cached_post_observation", {
          rid,
          load,
          observation: {
            channelId,
            updateAt: post.updateAt,
            displayPriority: post.displayPriority,
            aiAttribution: post.aiAttribution,
            cards: post.cards,
          },
        });
        switch (accepted.kind) {
          case "uncached":
            return anchor;
          case "unavailable":
            return { postId, channelId, post: null };
          case "superseded":
            throw new PostObservationSuperseded();
          case "cached":
            if (accepted.changed) historyChanges.notify(channelId, signal);
            return {
              ...anchor,
              post: { ...post, cards: accepted.cards?.cards },
            };
        }
      }, signal);
    },
    readPostFiles(channelId: string, postId: string, signal?: AbortSignal) {
      return readWhileOpen(
        () => readPostFiles(posts, channelId, postId, signal),
        signal,
      );
    },
    readChannelFile(channelId: string, fileId: string, signal?: AbortSignal) {
      return readWhileOpen(
        () => readChannelFile(files, channelId, fileId, signal),
        signal,
      );
    },
    readFileAnchor(fileId: string, signal?: AbortSignal) {
      return readWhileOpen(() => readFileAnchor(files, fileId, signal), signal);
    },
    searchChannelDirectory(teamId: string, name: string, signal?: AbortSignal) {
      return readWhileOpen(
        () => searchChannelDirectory(channels, teamId, name, signal),
        signal,
      );
    },
    readChannelDirectoryPage(query: DirectoryPageQuery, signal?: AbortSignal) {
      return readWhileOpen(
        () => readChannelDirectoryPage(channels, query, signal),
        signal,
      );
    },
    ...accountChannelAudience(config, readWhileOpen),
    readChannelBookmarks(channelId: string, signal?: AbortSignal) {
      return readWhileOpen(
        () => readChannelBookmarks(config, channelId, signal),
        signal,
      );
    },
    readChannelMemberDirectory(
      channelId: string,
      query: ChannelMemberQuery,
      signal?: AbortSignal,
    ) {
      return readWhileOpen(
        () => readChannelMemberDirectory(config, channelId, query, signal),
        signal,
      );
    },
    ...accountChannelReadState(config, userId, readWhileOpen),
    readChannelNotifications(channelId: string, signal?: AbortSignal) {
      return readWhileOpen(
        () => readChannelNotifications(config, userId, channelId, signal),
        signal,
      );
    },
    updateChannelNotifications(
      channelId: string,
      changes: ChannelNotifyProps,
      signal?: AbortSignal,
    ) {
      return readWhileOpen(
        () => updateChannelNotifications(config, channelId, changes, signal),
        signal,
      );
    },
    ...accountMentionGroups(config, readWhileOpen),
    readSavedProfiles,
    readConversationRecipient(
      target: ConversationRecipientTarget,
      signal?: AbortSignal,
    ) {
      return withAccountLifetime(
        (active) =>
          readConversationRecipient(
            new UsersApi(config),
            target,
            readSavedProfiles,
            active,
          ),
        signal,
      );
    },
    refreshSavedProfiles(query: VisibleProfileQuery, signal?: AbortSignal) {
      return readWhileOpen(async () => {
        const profiles = await loadVisibleProfiles(config, query, signal);
        signal?.throwIfAborted();
        if (retired) throw "cancelled";
        if (profiles.length)
          await invoke<void>("store_channel_profiles", { rid, profiles });
        signal?.throwIfAborted();
      });
    },
    readProfileImage(profile: ProfileImageIdentity, signal?: AbortSignal) {
      return readWhileOpen(
        () => readProfileImage(config, profile, signal),
        signal,
      );
    },
    readVisibleProfiles(query: VisibleProfileQuery, signal?: AbortSignal) {
      return readWhileOpen(() => loadVisibleProfiles(config, query, signal));
    },
    readCustomEmoji(emojiName: string, signal?: AbortSignal) {
      return readWhileOpen(() => readCustomEmoji(config, emojiName, signal));
    },
    openRecipientConversation(
      recipientIds: readonly string[],
      signal?: AbortSignal,
    ) {
      return withAccountLifetime(
        (active) =>
          openRecipientConversation(config, userId, recipientIds, active),
        signal,
      );
    },
    readOwnChannelMembership(
      teamId: string,
      channelId: string,
      signal?: AbortSignal,
    ) {
      return readWhileOpen(
        () =>
          readOwnChannelMembership(config, userId, teamId, channelId, signal),
        signal,
      );
    },
    changeOwnMembership(target: MembershipTarget, change: MembershipChange) {
      return readWhileOpen(() =>
        changeOwnMembership(config, userId, target, change),
      );
    },
    readNamedChannelDestination(
      teamName: string,
      channelName: string,
      signal?: AbortSignal,
    ) {
      return withAccountLifetime(
        (active) =>
          readNamedChannelDestination(
            config,
            userId,
            teamName,
            channelName,
            active,
          ),
        signal,
      );
    },
    readPostDestination(postId: string, signal?: AbortSignal) {
      return readWhileOpen(() => readPostDestination(posts, postId, signal));
    },
    async readAccountDirectory(signal?: AbortSignal) {
      signal?.throwIfAborted();
      const ticket = savedPosts.beginRead();
      try {
        const directory = await readWhileOpen(
          () => loadAccountDirectory(config, userId, signal),
          signal,
        );
        if (!signal?.aborted)
          savedPosts.publish(
            ticket,
            projectSavedPostMembership(userId, directory.preferences),
          );
        return directory;
      } catch (error) {
        if (!signal?.aborted) savedPosts.finishRead(ticket, error);
        throw error;
      } finally {
        savedPosts.finishRead(ticket);
      }
    },
    readJoinedTeams() {
      return readWhileOpen(() =>
        invoke<JoinedTeams | null>("read_joined_teams", { rid }),
      );
    },
    readRecentTeamSearches(teamId: string) {
      return readWhileOpen(() =>
        invoke<string[]>("read_recent_team_searches", { rid, teamId }),
      );
    },
    rememberTeamSearch(teamId: string, term: string) {
      return readWhileOpen(() =>
        invoke<boolean>("remember_team_search", { rid, teamId, term }),
      );
    },
    forgetTeamSearch(teamId: string, term: string) {
      return readWhileOpen(() =>
        invoke<void>("forget_team_search", { rid, teamId, term }),
      );
    },
    selectJoinedTeam(teamId: string) {
      return readWhileOpen(() =>
        invoke<boolean>("select_joined_team", { rid, teamId }),
      );
    },
    async refreshJoinedTeams(signal?: AbortSignal) {
      let ticket: number | undefined;
      let membership: SavedPostMembership | undefined;
      try {
        const accepted = await readWhileOpen(() =>
          refreshNavigation(
            signal,
            () =>
              atDirectoryStep("begin", () =>
                invoke<number>("begin_team_directory_load", { rid }),
              ),
            async () => {
              ticket = savedPosts.beginRead();
              const directory = await loadAccountDirectory(
                config,
                userId,
                signal,
                atDirectoryStep,
              );
              membership = projectSavedPostMembership(
                userId,
                directory.preferences,
              );
              return {
                teams: projectJoinedTeams(directory),
                preferences: await atDirectoryStep("sidebar", () =>
                  sidebarPreferences(userId, directory.preferences),
                ),
              };
            },
            (load, data) =>
              atDirectoryStep("publish", () =>
                invoke<boolean>("store_team_directory", { rid, load, ...data }),
              ),
            (load) => invoke<void>("cancel_team_directory_load", { rid, load }),
          ),
        );
        if (accepted && ticket !== undefined && membership && !signal?.aborted)
          savedPosts.publish(ticket, membership);
        return accepted;
      } catch (error) {
        if (ticket !== undefined && !signal?.aborted)
          savedPosts.finishRead(ticket, error);
        throw error;
      } finally {
        if (ticket !== undefined) savedPosts.finishRead(ticket);
      }
    },
    ...delivery,
    submitDraftCommand(
      location: DraftLocation & { teamId: string },
      revision: string,
      intent?: CommandIntent,
    ) {
      return readWhileOpen(() =>
        executeSavedCommand(
          commands,
          delivery.transitionDraftCommand,
          location,
          revision,
          intent,
        ),
      );
    },
    executeServerCommand(
      location: DraftLocation & { teamId: string },
      text: string,
    ) {
      return readWhileOpen(() =>
        executeAccountCommand(commands, location, text),
      );
    },
    readWorkspaceSettings() {
      return readWhileOpen(async (): Promise<SavedWorkspaceSettings> => {
        const saved = await readWorkspaceSettings();
        return saved.server && liveFileUpload
          ? {
              ...saved,
              server: { ...saved.server, fileUpload: liveFileUpload },
            }
          : saved;
      });
    },
    readConversationRecipients(
      teamId: string,
      query: RecipientQuery,
      signal?: AbortSignal,
      onLocalPage?: (page: RecipientPage) => void,
    ) {
      return withAccountLifetime(
        (active) =>
          readConversationRecipients(
            config,
            userId,
            teamId,
            query,
            async () =>
              (await readWhileOpen(readWorkspaceSettings, active)).server ??
              undefined,
            active,
            onLocalPage,
          ),
        signal,
      );
    },
    async refreshWorkspaceServerPolicy(
      signal?: AbortSignal,
      onEventRoute?: (route: AccountEventRoute) => void,
    ) {
      signal?.throwIfAborted();
      const read = Symbol();
      latestPolicyRead = read;
      const published = await readWhileOpen(
        () =>
          refreshNavigation(
            signal,
            () => invoke<number>("begin_workspace_policy_load", { rid }),
            () =>
              loadWorkspaceConfiguration(
                config,
                signal,
                isAndroid ? "android" : "desktop",
              ),
            async (
              load,
              { server: { fileUpload, ...server }, eventAddress },
            ) => {
              // Upload uses live settings. Keep the saved JSON readable by older clients.
              const route = await invoke<AccountEventRoute | null>(
                "store_workspace_policy",
                {
                  rid,
                  load,
                  server,
                  eventAddress,
                },
              );
              return route && { route, fileUpload };
            },
            (load) =>
              invoke<void>("cancel_workspace_policy_load", { rid, load }),
          ),
        signal,
      );
      if (!published) return false;
      if (!retired && latestPolicyRead === read && !signal?.aborted) {
        liveFileUpload = published.fileUpload;
        onEventRoute?.(published.route);
      }
      return true;
    },
    readTeamSidebar(teamId: string) {
      return readWhileOpen(() => readTeamSidebar(teamId));
    },
    async reopenKnownConversation(
      teamId: string,
      channelId: string,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted();
      if (![userId, teamId, channelId].every(isMattermostId))
        throw new TypeError("Invalid Mattermost conversation identity.");
      const [sidebar, settings] = await readWhileOpen(
        () => Promise.all([readTeamSidebar(teamId), readWorkspaceSettings()]),
        signal,
      );
      return readWhileOpen(
        () =>
          reopenKnownConversation(
            config,
            userId,
            channelId,
            sidebar?.data,
            settings.preferences,
            signal,
          ),
        signal,
      );
    },
    selectSidebarChannel(teamId: string, channelId: string) {
      return readWhileOpen(() =>
        invoke<boolean>("select_sidebar_channel", { rid, teamId, channelId }),
      );
    },
    refreshTeamSidebar(teamId: string, signal?: AbortSignal) {
      return readWhileOpen(() =>
        refreshNavigation(
          signal,
          () => invoke<number | null>("begin_sidebar_load", { rid, teamId }),
          async () =>
            projectTeamSidebar(
              await loadTeamDirectory(config, userId, teamId, signal),
            ),
          (load, data) =>
            invoke<boolean>("store_team_sidebar", { rid, load, data }),
          (load) => invoke<void>("cancel_sidebar_load", { rid, load }),
        ),
      );
    },
    refreshTeamRoles(teamId: string, signal?: AbortSignal) {
      return readWhileOpen(() =>
        refreshNavigation(
          signal,
          () =>
            invoke<{ load: number; roleNames: string[] } | null>(
              "begin_team_role_load",
              { rid, teamId },
            ),
          ({ roleNames }) =>
            fetchTeamRoleSnapshot(config, userId, roleNames, signal),
          ({ load }, data) =>
            invoke<boolean>("store_team_roles", { rid, load, data }),
          ({ load }) => invoke<void>("cancel_team_role_load", { rid, load }),
        ),
      );
    },
    readSavedTeamRoles(teamId: string) {
      return readWhileOpen(() =>
        invoke<TeamRoleSnapshot | null>("read_team_roles", { rid, teamId }),
      );
    },
    readTeamDirectory(teamId: string, signal?: AbortSignal) {
      return readWhileOpen(() =>
        loadTeamDirectory(config, userId, teamId, signal),
      );
    },
    subscribeToChannelHistory: historyChanges.subscribe,
    notifyChannelHistoryChanged(channelId: string) {
      historyChanges.notify(channelId);
    },
    async refreshChannelHistory(
      query: ChannelRefreshRequest,
      signal?: AbortSignal,
    ) {
      if (retired) return Promise.reject<ChannelRefreshResult>(retired);
      const { channelId } = query;
      return refreshChannelHistory(
        posts,
        historyWriter,
        query,
        signal,
        (changes) => historyChanges.notify(channelId, signal, changes),
      );
    },
    close() {
      retire("unknown_connection");
      return connection.close();
    },
    readSavedPost(channelId: string, postId: string) {
      return readWhileOpen(() =>
        invoke<LocalPost | null>("read_saved_post", { rid, channelId, postId }),
      );
    },
    readChannelWindow(query: ChannelWindowQuery) {
      return readWhileOpen(() =>
        invoke<LocalChannelWindow | null>("read_channel_window", {
          rid,
          query,
        }),
      );
    },
    async signOut() {
      const result = await invoke<AccountSignOut>("sign_out_account", { rid });
      if (result.status === "server_confirmed_local_removal_failed") {
        // The server ended this session. Keep the native handle for retrying device cleanup.
        retire(retired ?? "session_unavailable");
      } else if (result.status !== "unconfirmed") {
        retire(retired === "unknown_connection" ? retired : "cancelled");
      }
      return result;
    },
    async signOutOnDevice() {
      const result = await invoke<"removed" | "superseded">(
        "sign_out_on_device",
        { rid },
      );
      retire(retired === "unknown_connection" ? retired : "cancelled");
      return result;
    },
  };
}

async function openConnection(serverUrl: string, userId?: string) {
  const transport = createRestTransport(serverUrl, (input, init) =>
    nativeFetch(rid, input, init),
  );
  const rid = await invoke<number>("open_rest_connection", {
    basePath: transport.basePath,
    userId,
  });
  return {
    ...transport,
    rid,
    close: () => invoke<void>("close_rest_connection", { rid }),
  };
}
