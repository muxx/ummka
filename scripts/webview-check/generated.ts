import { invoke } from "@tauri-apps/api/core";
import { composerPostMentions } from "../../src/channels/composer-mentions.ts";
import { resolveComposerSubmission } from "../../src/channels/composer-submission.ts";
import { readGroupMentionAudience } from "../../src/channels/group-mention-audience.ts";
import { readPostMentionDecision } from "../../src/channels/post-mention-decision.ts";
import { openPostNavigation } from "../../src/channels/post-navigation.ts";
import { inspectInstallation } from "../../src/mattermost/inspect-installation.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { sidebarPreferences } from "../../src/mattermost/workspace-preferences.ts";
import {
  ChannelsApi,
  Configuration,
  FetchError,
  FilesApi,
  type InitOverrideFunction,
  ResponseError,
  StatusApi,
  SystemApi,
  ThreadsApi,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { checkAccountResponses } from "./account.ts";
import { checkAccountThreadReadState } from "./account-thread-read-state.ts";
import { checkChannelFormatting } from "./channel-formatting.tsx";
import { checkChannelRefresh } from "./channel-refresh.ts";
import { checkCollectionWindow } from "./collection-window.tsx";
import { checkDraftWrites } from "./composer-drafts.ts";
import { checkConnectServer } from "./connect-server.tsx";
import { checkChannelHistory } from "./history.ts";
import { prepareHistoryLoads } from "./history-loads.ts";
import { checkUnavailableHistoryServer } from "./local-history.ts";
import { checkOpenTimelineCommits } from "./open-timeline-commits.tsx";
import { checkCollectionRemoval } from "./post-collections.ts";
import { checkPostContext } from "./post-context.ts";
import { checkPostMutations } from "./post-mutations.ts";
import { checkPostReactions } from "./post-reactions.ts";
import { checkSubmissions } from "./submission.ts";
import { checkTeamReads } from "./team-reads.ts";
import { checkRoleStorage } from "./team-role-storage.ts";
import { checkAccountThreadList, checkThreadList } from "./thread-list.ts";
import { checkUnreadThread } from "./unread-thread.ts";
import { checkWorkspaceSettings } from "./workspace-settings.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

async function rejected(action: Promise<unknown>) {
  try {
    await action;
  } catch (error) {
    return error;
  }
  throw Error("generated request unexpectedly succeeded");
}

async function checkTeamLoadOwnership(rid: number, other: number) {
  const begin = () => invoke<number>("begin_team_directory_load", { rid });
  const store = (handle: number, load: number, teams: unknown) =>
    invoke<boolean>("store_team_directory", {
      rid: handle,
      load,
      teams,
      preferences: sidebarPreferences("u".repeat(26), []),
    });
  const older = await begin();
  const current = await begin();
  check(!(await store(rid, older, [])), "replaced-team-directory-load");
  check(
    (await rejected(store(other, current, []))) === "unknown_directory_load",
    "foreign-team-directory-load",
  );
  check(
    (await rejected(store(rid, current, [{}]))) === "invalid_directory",
    "invalid-team-directory",
  );
  check(
    (await rejected(store(rid, current, []))) === "unknown_directory_load",
    "consumed-invalid-directory-load",
  );
}

export async function checkGeneratedRequests(ports: string[]) {
  const origin = `https://127.0.0.1:${ports[0]}`;
  await checkCollectionWindow(`${origin}/collection-window`, ports[1]);
  await checkUnavailableHistoryServer(origin);
  await prepareHistoryLoads(origin);
  const root = await openNativeRestConnection(origin);
  const prefixed = await openNativeRestConnection(`${origin}/team/chat///`);
  const control = await openNativeRestConnection(
    `https://127.0.0.1:${ports[1]}`,
  );
  const foreign = await openNativeRestConnection(
    `https://127.0.0.1:${ports[2]}`,
  );
  const userId = "Abc01234567890123456789012";
  const accountRoot = await openAccountRestConnection(origin, userId);
  const accountPrefix = await openAccountRestConnection(
    prefixed.basePath,
    userId,
  );
  const query = { useRestSemantics: true };
  const api = new SystemApi(new Configuration(prefixed));
  function scenario(name: string, signal?: AbortSignal): InitOverrideFunction {
    return async ({ init }) => {
      const headers = new Headers(init.headers);
      headers.set("X-Test-Case", name);
      return { headers, signal };
    };
  }
  async function observed(step: string, name: string) {
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${step}&case=${name}`,
    );
    check(
      response.status === 204 && response.body === null,
      "generated-control",
    );
  }
  async function checkAbort(
    name: string,
    send: (overrides: InitOverrideFunction) => Promise<{ raw: Response }>,
  ) {
    const beforeHeaders = new AbortController();
    const pending = rejected(send(scenario("headers", beforeHeaders.signal)));
    await Promise.race([
      observed("received", `${name}-headers`),
      pending.then(() => {
        throw Error(`${name}-ended-before-server-received`);
      }),
    ]);
    const reason = new Error("fixture cancelled");
    beforeHeaders.abort(reason);
    const stopped = await pending;
    check(
      stopped instanceof FetchError && stopped.cause === reason,
      `${name}-abort-headers`,
    );
    await observed("closed", `${name}-headers`);

    const duringBody = new AbortController();
    const { raw } = await send(scenario("body", duringBody.signal));
    check(raw.body, `${name}-missing-body`);
    const reader = raw.body.getReader();
    check(
      new TextDecoder().decode((await reader.read()).value) === "A",
      `${name}-first-byte`,
    );
    const tail = rejected(reader.read());
    duringBody.abort(reason);
    check((await tail) === reason, `${name}-abort-body`);
    await observed("closed", `${name}-body`);
  }
  try {
    await observed(
      "format-times",
      encodeURIComponent(
        JSON.stringify(
          await checkChannelFormatting(() => observed("format-right", "")),
        ),
      ),
    );
    const atRoot = await new SystemApi(new Configuration(root)).getPing(query);
    check(atRoot.status === "OK", "generated-root");
    const first = await api.getPing(query);
    const second = await api.getPing(query);
    check(first.status === "OK" && second.status === "OK", "generated-prefix");
    const anonymousUser = new UsersApi(new Configuration(root));
    const unauthenticated = await rejected(
      anonymousUser.getUserRaw({ userId: "me" }),
    );
    check(
      unauthenticated instanceof ResponseError &&
        unauthenticated.response.status === 401,
      "generated-user-auth",
    );
    check(
      (await unauthenticated.response.json()).message === "session required",
      "generated-user-error-body",
    );
    const signed = new Configuration(accountPrefix);
    const users = new UsersApi(signed);
    const lookup = { ids: [] as string[], usernames: ["unknown", "fixture"] };
    check(
      !Object.keys((await accountPrefix.readSavedProfiles(lookup)).profiles)
        .length,
      "cold-profile-store",
    );
    await accountPrefix.refreshSavedProfiles(lookup);
    const named = await accountPrefix.readSavedProfiles(lookup);
    check(
      named.usernames.fixture === userId &&
        named.profiles[userId]?.username === "fixture" &&
        !Object.hasOwn(named.usernames, "unknown"),
      "stored-profile-by-name",
    );
    check(
      !Object.keys((await accountRoot.readSavedProfiles(lookup)).profiles)
        .length,
      "isolated-profile-store",
    );
    check(
      (await rejected(
        invoke("store_channel_profiles", {
          rid: accountPrefix.rid,
          profiles: [{ id: userId, unexpected: "invalid" }],
        }),
      )) === "invalid_directory",
      "invalid-profile-shape",
    );
    const image = await users.getProfileImage({ userId });
    const bytes = new DataView(await image.arrayBuffer());
    check(
      image.type === "image/png" &&
        bytes.getUint32(0) === 0x89504e47 &&
        bytes.getUint32(16) === 48 &&
        bytes.getUint32(20) === 48,
      "generated-profile-image",
    );
    const batch = { requestBody: [userId, "b".repeat(26)], since: 123 };
    const profiles = await (await users.getUsersByIdsRaw(batch)).value();
    check(
      profiles.length === 2 &&
        profiles[0]?.id === batch.requestBody[1] &&
        profiles[0].firstName === "Юлия" &&
        profiles[1]?.id === userId,
      "generated-user-batch",
    );
    const statuses = await new StatusApi(signed).getUsersStatusesByIds({
      requestBody: batch.requestBody,
    });
    const [peerStatus, selfStatus] = statuses;
    check(
      statuses.length === 2 &&
        peerStatus?.userId === batch.requestBody[1] &&
        peerStatus.status === "dnd" &&
        peerStatus.manual === true &&
        peerStatus.lastActivityAt === 1700000000123 &&
        peerStatus.dndEndTime === 1700003600 &&
        selfStatus?.userId === userId &&
        selfStatus.status === "offline" &&
        selfStatus.dndEndTime === 0,
      "generated-presence-batch",
    );
    const unsignedBatch = await rejected(anonymousUser.getUsersByIdsRaw(batch));
    check(
      unsignedBatch instanceof ResponseError &&
        unsignedBatch.response.status === 401 &&
        (await unsignedBatch.response.json()).message === "session required",
      "generated-user-batch-auth",
    );
    const rawText = await root.fetchApi(`${root.basePath}/api/v4/users/ids`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Test-Case": "text",
      },
      body: '\ufeff ["Привет 👋"]\n',
    });
    check(rawText.status === 204 && rawText.body === null, "native-utf8-body");
    const user = await (await users.getUserRaw({ userId })).value();
    check(
      user.id === userId &&
        user.firstName === "Ada" &&
        user.username === "fixture",
      "generated-user",
    );
    const rootSession = new Configuration(accountRoot);
    await checkAccountResponses(accountPrefix, userId, observed);
    await checkChannelRefresh(accountPrefix, observed);
    await checkOpenTimelineCommits(accountPrefix);
    await checkUnreadThread(accountPrefix, userId);
    await checkPostReactions(accountRoot, accountPrefix);
    await checkTeamReads(accountRoot, accountPrefix);
    const prepared = await resolveComposerSubmission(
      { message: "-:fixture+wave:", hasAttachments: false, scheduled: false },
      accountPrefix,
    );
    check(
      prepared.kind === "reaction" &&
        prepared.emoji === "fixture+wave" &&
        prepared.action === "remove",
      "resolve custom emoji for the signed account",
    );
    const customEmoji = await accountPrefix.readCustomEmoji("fixture+wave");
    check(
      customEmoji.kind === "found" &&
        customEmoji.emoji.name === "fixture+wave" &&
        customEmoji.emoji.id === "e".repeat(26),
      "account custom emoji",
    );
    await checkTeamLoadOwnership(accountPrefix.rid, accountRoot.rid);
    check(
      (await accountPrefix.readJoinedTeams()) === null,
      "cold-team-directory",
    );
    const cold = await accountPrefix.readWorkspaceSettings();
    check(
      cold.preferences === null && cold.server === null,
      "cold-workspace-settings",
    );
    check(await accountPrefix.refreshJoinedTeams(), "team-directory-published");
    await checkWorkspaceSettings(accountPrefix, accountRoot);
    await checkDraftWrites(accountPrefix, accountRoot, userId);
    await checkSubmissions(accountPrefix, accountRoot, userId, observed);
    const cached = await accountPrefix.readJoinedTeams();
    check(
      cached?.teams[0]?.id === "Team0123456789012345678901" &&
        cached.teams[0].displayName === "Fixture Team" &&
        cached.teams[0].groupConstrained === true &&
        cached.selectedTeam === "Team0123456789012345678901",
      "cached-team-names",
    );
    check(
      await accountPrefix.selectJoinedTeam(cached.teams[0].id),
      "select-joined-team",
    );
    const directory = await accountPrefix.readAccountDirectory();
    check(
      directory.teams.length === 1 &&
        directory.teams[0]?.team.name === "fixture" &&
        directory.teams[0]?.membership.schemeGuest === true &&
        directory.preferences[0]?.value === "false",
      "account-navigation-directory",
    );
    const teamDirectory = await accountPrefix.readTeamDirectory(
      "Team0123456789012345678901",
    );
    const [row] = teamDirectory.channels;
    check(
      row?.channel.name === "town-square" &&
        row.channel.lastRootPostAt === 300 &&
        row.membership.mentionCountRoot === 2 &&
        teamDirectory.categories[0]?.type === "managed" &&
        teamDirectory.categories[0]?.channelIds?.[0] === row.channel.id,
      "team-navigation-directory",
    );
    const teamId = "Team0123456789012345678901";
    const recipientPage = await users.getUsers({
      page: 1,
      perPage: 20,
      inTeam: teamId,
      active: true,
    });
    const recipientSearch = await users.searchUsers({
      searchUsersRequest: {
        term: "ан",
        teamId,
        allowInactive: false,
        limit: 12,
      },
    });
    for (const profiles of [recipientPage, recipientSearch]) {
      check(
        profiles.length === 1 &&
          profiles[0].id === userId &&
          profiles[0].username === "anna" &&
          profiles[0].firstName === "Анна",
        "signed visible recipients",
      );
    }
    for (const request of [
      () => anonymousUser.getUsers({ page: 0 }),
      () => anonymousUser.searchUsers({ searchUsersRequest: { term: "ан" } }),
    ]) {
      const denied = await rejected(request());
      check(
        denied instanceof FetchError &&
          denied.cause instanceof TypeError &&
          denied.cause.cause === "operation_denied",
        "recipient-directory-denied-before-dispatch",
      );
    }
    const teamMembership = { kind: "team" as const, id: teamId };
    for (const change of ["join", "leave"] as const) {
      const result = await accountPrefix.changeOwnMembership(
        teamMembership,
        change,
      );
      check(result.kind === "applied", `signed-team-membership-${change}`);
    }

    const channelId = "c".repeat(26);
    await checkCollectionRemoval(accountPrefix, channelId);
    const term = "from:fixture Привет";
    check(
      await accountPrefix.rememberTeamSearch(teamId, term),
      "remember-team-search",
    );
    check(
      await accountPrefix.rememberTeamSearch(teamId, "releases"),
      "remember-second-team-search",
    );
    check(
      await accountPrefix.rememberTeamSearch(teamId, term),
      "repeat-team-search",
    );
    const recent = await accountPrefix.readRecentTeamSearches(teamId);
    check(
      recent.length === 2 && recent[0] === term && recent[1] === "releases",
      "team-search-recency",
    );
    check(
      !(await accountRoot.rememberTeamSearch(teamId, "other installation")),
      "unknown-team-search",
    );
    check(
      (await accountRoot.readRecentTeamSearches(teamId)).length === 0,
      "team-search-installation-isolation",
    );
    await accountPrefix.forgetTeamSearch(teamId, "releases");
    const command = await accountPrefix.executeServerCommand(
      { channelId, teamId, rootId: "r".repeat(26) },
      "/RELEASE  —Status  ",
    );
    check(
      command.kind === "executed" &&
        command.response.responseType === "ephemeral" &&
        command.response.text === "Fixture status",
      "account-server-command",
    );

    const commandThread = { channelId, teamId, rootId: "k".repeat(26) };
    const localCommand = await accountPrefix.saveDraft({
      ...commandThread,
      expectedRevision: null,
      message: "/RELEASE  —Saved  ",
    });
    const commandRevision = localCommand.draft.revision;
    check(
      localCommand.kind === "saved" && commandRevision,
      "saved-command-local-draft",
    );
    const commandOutcomes = await Promise.all(
      [1, 2].map(() =>
        accountPrefix.submitDraftCommand(commandThread, commandRevision),
      ),
    );
    check(
      commandOutcomes.some(
        (s) =>
          s.kind === "answered" &&
          s.settlement === "saved" &&
          s.result.kind === "executed" &&
          s.result.response.text === "Fixture status",
      ) && commandOutcomes.some((s) => s.kind === "conflict"),
      "saved-command-single-request",
    );
    const afterCommand = await accountPrefix.readDraft(commandThread);
    check(
      afterCommand.message === "" && afterCommand.clearedBySubmission,
      "saved-command-cleared",
    );

    const broadcast = await readPostMentionDecision(
      accountPrefix,
      { id: channelId, groupConstrained: true },
      { id: teamId, groupConstrained: true },
      composerPostMentions("Ready @here and @release-qa"),
      {
        confirmNotifications: true,
        maxNotificationsPerChannel: 100n,
        canMentionChannel: true,
        canMentionGroups: true,
        ldapGroups: true,
        customGroups: false,
      },
    );
    check(
      broadcast.kind === "ready" &&
        broadcast.confirmation?.kind === "here" &&
        broadcast.confirmation.members === 29 &&
        broadcast.confirmation.timezones === 2 &&
        broadcast.suppression === null,
      "account-broadcast-confirmation",
    );
    const audience = await readGroupMentionAudience(
      accountPrefix,
      { id: channelId, groupConstrained: true },
      { id: teamId, groupConstrained: true },
      ["release-qa."],
      {
        ldapGroups: true,
        customGroups: false,
        canMentionGroups: true,
        confirmNotifications: true,
      },
    );
    check(
      audience.kind === "ready" &&
        audience.groups.length === 1 &&
        audience.groups[0]?.handle === "release-qa" &&
        audience.groups[0].members === 3 &&
        audience.groups[0].timezones === 2,
      "account-scoped-group-audience",
    );

    check(
      (await accountPrefix.readTeamSidebar(teamId)) === null,
      "cold-channel-catalog",
    );
    check(
      !(await accountRoot.refreshTeamSidebar(teamId)),
      "unknown-team-requested-sidebar",
    );
    const cancelled = await invoke<number>("begin_sidebar_load", {
      rid: accountPrefix.rid,
      teamId,
    });
    const ticket = { rid: accountPrefix.rid, load: cancelled };
    const cancel = () => invoke("cancel_sidebar_load", ticket);
    await cancel();
    check(
      (await rejected(
        invoke("store_team_sidebar", {
          ...ticket,
          data: { channels: [], categories: [] },
        }),
      )) === "unknown_directory_load",
      "cancelled-sidebar-publication",
    );
    check(
      (await rejected(cancel())) === "unknown_directory_load",
      "repeated-sidebar-cancellation",
    );
    const stale = await invoke<number>("begin_sidebar_load", {
      rid: accountPrefix.rid,
      teamId,
    });
    const fresh = await invoke<number>("begin_sidebar_load", {
      rid: accountPrefix.rid,
      teamId,
    });
    const publish = (rid: number, load: number, data: unknown) =>
      invoke<boolean>("store_team_sidebar", { rid, load, data });
    check(
      !(await publish(accountPrefix.rid, stale, {
        channels: [],
        categories: [],
      })),
      "stale-channel-catalog",
    );
    check(
      (await rejected(publish(accountRoot.rid, fresh, {}))) ===
        "unknown_directory_load",
      "foreign-channel-catalog",
    );
    check(
      (await rejected(publish(accountPrefix.rid, fresh, {}))) ===
        "invalid_directory",
      "invalid-channel-catalog",
    );
    check(
      (await rejected(publish(accountPrefix.rid, fresh, {}))) ===
        "unknown_directory_load",
      "reused-channel-catalog",
    );
    check(
      await accountPrefix.refreshTeamSidebar(teamId),
      "publish-channel-catalog",
    );
    await checkRoleStorage(accountPrefix, accountRoot, userId);
    check(
      await accountPrefix.selectSidebarChannel(teamId, channelId),
      "select-saved-room",
    );
    const groupId = "g".repeat(26);
    check(
      (await accountPrefix.reopenKnownConversation(teamId, groupId)) ===
        "confirmed",
      "reopen-known-group-on-server",
    );
    check(
      await accountPrefix.refreshJoinedTeams(),
      "publish-updated-conversation-preferences",
    );
    const settingsAfterOpen = (await accountPrefix.readWorkspaceSettings())
      .preferences;
    check(
      settingsAfterOpen?.groupShown[groupId] === true &&
        settingsAfterOpen.viewTimes[groupId] > 0 &&
        (await accountPrefix.reopenKnownConversation(teamId, groupId)) ===
          "alreadyShown",
      "known-group-visible-without-a-second-put",
    );
    const catalog = await accountPrefix.readTeamSidebar(teamId);
    check(
      catalog?.selectedChannel === channelId &&
        catalog.data.channels[0]?.lastRootPostAt === 300 &&
        catalog.data.channels[0]?.createAt === 90 &&
        catalog.data.channels[0]?.groupConstrained === true &&
        catalog.data.categories[0]?.channelIds[0] === channelId,
      "read-channel-catalog",
    );
    check(
      (
        await accountPrefix.refreshChannelHistory({
          kind: "latest",
          channelId,
          collapsedThreads: true,
        })
      ).kind === "applied",
      "save-workspace-history",
    );
    await checkChannelHistory(rootSession, signed, new Configuration(root));
    await checkPostContext(rootSession, signed);
    const postId = "p".repeat(26),
      fileId = "f".repeat(26);
    const postAnchor = await accountPrefix.readPostAnchor(postId);
    const fileAnchor = await accountPrefix.readFileAnchor(fileId);
    check(
      postAnchor.postId === postId &&
        postAnchor.channelId === channelId &&
        postAnchor.rootId === "r".repeat(26) &&
        postAnchor.post?.id === postId &&
        postAnchor.post.editAt === 1250 &&
        postAnchor.post.isPinned &&
        postAnchor.post.attachments?.redactedFileCount === 2 &&
        postAnchor.post.attachments.fileIds?.length === 0 &&
        postAnchor.post.attachments.files === undefined &&
        fileAnchor.fileId === fileId &&
        fileAnchor.channelId === channelId &&
        fileAnchor.postId === postId,
      "account-message-anchors",
    );
    const { target, joined } = await openPostNavigation(
      accountPrefix,
      { kind: "file", id: fileId },
      teamId,
      async () => {
        throw Error("An existing DM unexpectedly requested membership");
      },
    ).open();
    check(
      joined.length === 0 &&
        target.kind === "ready" &&
        target.teamId === teamId &&
        target.channelId === channelId &&
        target.rootId === "r".repeat(26) &&
        target.postId === postId &&
        target.post.id === target.postId &&
        target.post.channelId === target.channelId &&
        target.post.rootId === target.rootId &&
        target.post.userId === "u".repeat(26) &&
        target.post.createAt === 1100 &&
        target.post.message === "Later reply",
      "inspect-file-post-destination",
    );
    const contentFiles = new FilesApi(signed);
    for (const method of [
      "getFileRaw",
      "getFileThumbnailRaw",
      "getFilePreviewRaw",
    ] as const) {
      const denied = await rejected(
        contentFiles[method]({ fileId: "f".repeat(26) }),
      );
      check(
        denied instanceof FetchError &&
          denied.cause instanceof TypeError &&
          denied.cause.cause === "operation_denied",
        `native-only-${method}`,
      );
    }
    const threads = new ThreadsApi(signed);
    const follow = { userId: "me", teamId, threadId: postId };
    check(
      (await threads.startFollowingThread(follow)).status === "OK",
      "signed thread follow",
    );
    check(
      (await threads.stopFollowingThread(follow)).status === "OK",
      "signed thread unfollow",
    );
    await checkThreadList(threads, teamId, channelId, userId);
    await checkAccountThreadList(accountPrefix, teamId, channelId, userId);
    const guestThreads = new ThreadsApi(new Configuration(prefixed));
    const timestamp = 1700000000123;
    await checkAccountThreadReadState(accountPrefix, teamId, postId, timestamp);
    const readThread = await threads.updateThreadReadForUser({
      ...follow,
      timestamp,
    });
    check(
      readThread.id === postId &&
        readThread.post?.id === postId &&
        readThread.lastViewedAt === timestamp &&
        readThread.unreadReplies === 3 &&
        readThread.unreadMentions === 2,
      "signed single thread read",
    );
    check(
      (await threads.updateThreadsReadForUser({ userId: "me", teamId }))
        .status === "OK",
      "signed team thread read",
    );
    for (const request of [
      () => guestThreads.updateThreadReadForUser({ ...follow, timestamp }),
      () => guestThreads.updateThreadsReadForUser({ userId: "me", teamId }),
      () => threads.updateThreadReadForUser({ ...follow, timestamp: 1.5 }),
      () =>
        threads.updateThreadsReadForUser({ userId: "b".repeat(26), teamId }),
      () => guestThreads.startFollowingThread(follow),
      () => threads.stopFollowingThread({ ...follow, userId: "b".repeat(26) }),
      () => threads.startFollowingThread({ ...follow, threadId: "short" }),
    ]) {
      const denied = await rejected(request());
      check(
        denied instanceof FetchError &&
          denied.cause instanceof TypeError &&
          denied.cause.cause === "operation_denied",
        "thread-mutation-denied-before-dispatch",
      );
    }
    const categoryApi = new ChannelsApi(signed);
    const direct = await categoryApi.createDirectChannelRaw({
      requestBody: [userId],
    });
    const group = await categoryApi.createGroupChannelRaw({
      requestBody: ["x".repeat(26), "y".repeat(26)],
    });
    const ownConversation = await direct.value();
    const groupConversation = await group.value();
    check(
      direct.raw.status === 201 &&
        ownConversation.id === "d".repeat(26) &&
        ownConversation.type === "D" &&
        ownConversation.teamId === "",
      "signed self conversation",
    );
    check(
      group.raw.status === 201 &&
        groupConversation.id === "g".repeat(26) &&
        groupConversation.type === "G" &&
        groupConversation.teamId === "",
      "signed group conversation",
    );
    const unsignedConversations = new ChannelsApi(new Configuration(prefixed));
    for (const request of [
      () =>
        unsignedConversations.createDirectChannel({ requestBody: [userId] }),
      () =>
        unsignedConversations.createGroupChannel({
          requestBody: ["x".repeat(26), "y".repeat(26)],
        }),
    ]) {
      const denied = await rejected(request());
      check(
        denied instanceof FetchError &&
          denied.cause instanceof TypeError &&
          denied.cause.cause === "operation_denied",
        "conversation-denied-before-dispatch",
      );
    }
    const categoryOwner = "Abc01234567890123456789012";
    const categoryId = `direct_messages_${categoryOwner.toLowerCase()}_${teamId.toLowerCase()}`;
    const categoryScope = { userId: "me", teamId };
    const collapsedCategory =
      await categoryApi.updateSidebarCategoryForTeamForUser({
        ...categoryScope,
        categoryId,
        sidebarCategoryWithChannels: {
          id: categoryId,
          userId: categoryOwner,
          teamId,
          type: "direct_messages",
          channelIds: [channelId],
          collapsed: true,
        },
      });
    check(
      collapsedCategory.id === categoryId &&
        collapsedCategory.collapsed === true &&
        collapsedCategory.channelIds?.[0] === channelId,
      "signed sidebar category with channels",
    );
    const deletion = await categoryApi.removeSidebarCategoryForTeamForUser({
      ...categoryScope,
      categoryId: "m".repeat(26),
    });
    check(deletion.status === "OK", "signed sidebar category removal");
    for (const request of [
      () => guestThreads.getUserThreads({ userId: "me", teamId }),
      () => threads.getUserThreads({ userId: "b".repeat(26), teamId }),
      () => threads.getUserThreads({ userId: "me", teamId: "short" }),
    ]) {
      const denied = await rejected(request());
      check(
        denied instanceof FetchError &&
          denied.cause instanceof TypeError &&
          denied.cause.cause === "operation_denied",
        "thread-list-denied-before-dispatch",
      );
    }
    await checkPostMutations(
      rootSession,
      signed,
      channelId,
      accountPrefix,
      userId,
    );
    await checkConnectServer(origin);
    const profile = await inspectInstallation(
      `${prefixed.basePath.slice("https://".length)}/`,
      new AbortController().signal,
    );
    check(
      profile.serverUrl === prefixed.basePath &&
        profile.version === "10.10.1" &&
        profile.siteName === "Fixture" &&
        profile.ssoProviders.join(",") === "gitlab" &&
        profile.passwordIdentifiers.length === 0 &&
        !profile.guestMagicLink,
      "generated-installation-profile",
    );
    check(
      (await api.getPing(query, scenario("unhealthy"))).status === "UNHEALTHY",
      "generated-unhealthy",
    );
    const http = await rejected(api.getPing(query, scenario("error")));
    check(
      http instanceof ResponseError && http.response.status === 503,
      "generated-http-error",
    );
    check(
      (await http.response.json()).message === "unavailable",
      "generated-error-body",
    );
    const redirect = await rejected(api.getPing(query, scenario("redirect")));
    check(
      redirect instanceof FetchError &&
        redirect.cause instanceof TypeError &&
        redirect.cause.cause === "redirect",
      "generated-redirect",
    );
    const tls = await rejected(
      new SystemApi(new Configuration(foreign)).getPing(query),
    );
    check(
      tls instanceof FetchError &&
        tls.cause instanceof TypeError &&
        tls.cause.cause === "network",
      "generated-tls",
    );

    await checkAbort("ping", (init) => api.getPingRaw(query, init));
    await checkAbort("batch", (init) => users.getUsersByIdsRaw(batch, init));
  } finally {
    await Promise.all([
      accountRoot.close(),
      accountPrefix.close(),
      root.close(),
      prefixed.close(),
      control.close(),
      foreign.close(),
    ]);
  }
}
