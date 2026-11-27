#!/bin/sh
set -eu

case "$#:${1-}" in
    0:|1:--write-bindings) ;;
    *) echo 'Usage: check-contract.sh [--write-bindings]' >&2; exit 1 ;;
esac

: "${JAVA_HOME:?Set JAVA_HOME to the JDK used for the Android build}"
if [ ! -x "$JAVA_HOME/bin/java" ]; then
    echo 'JAVA_HOME must contain bin/java.' >&2
    exit 1
fi
version=10.10.1
revision=d6b35c41f0ae569304ad049831645274a1d68f6f
upstream="https://raw.githubusercontent.com/mattermost/mattermost/$revision/api/v4/source"
generator=openapi-generator-cli-7.27.0.jar
cache=".check-tools/mattermost-contract/$version"
mkdir -p "$cache" artifacts
work=$(mktemp -d artifacts/.contract.XXXXXXXX)
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM
download() {
    sh scripts/contract/download-verified.sh "$cache/$1" "$2" "$3"
}

emoji_source=webapp/channels/src/utils/emoji.json
download emoji-10.10.1.json "https://raw.githubusercontent.com/mattermost/mattermost/$revision/$emoji_source" 1466dd6147bbcb1f1fd707bc81a7e20cbdc1a4e45124979aa90357ff30461ba3
download emoji-12.1.0.json "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/$emoji_source" d38702de0ed432b68c00dfb94bb678c66a3c5f0f3541943debdcd63199f8d08c
npm run contract:emoji -- "$cache/emoji-10.10.1.json" "$cache/emoji-12.1.0.json" "$work/emoji.json"

download introduction.yaml "$upstream/introduction.yaml" 4b3786cc86ec1097c29f5b1bea8e9a32d09c4ddb6244140ec094425b6fdc5e09
download sharedchannels.yaml "$upstream/sharedchannels.yaml" 30a1a3bbdf46bbdb60c3812dfb52a367d52516da628cc8d9a1827b12d66f9c2e
download sharedchannels-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/sharedchannels.yaml" 986b35f437c772aff043e14af79097e078dbf442e0a389ffca4386c52d85ce9d
download system.yaml "$upstream/system.yaml" 10e9e11b14d34d30a661474269f69220f8ebdb05db64cd53e30cb199a665ae8e
download status.yaml "$upstream/status.yaml" e1adcf4a377c13618d7229f5319bfaceeea1879810d17cec5887f88b4032cde7
download status-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/status.yaml" e1adcf4a377c13618d7229f5319bfaceeea1879810d17cec5887f88b4032cde7
download users.yaml "$upstream/users.yaml" 20d0c9cf9631682f3461c7b13a521321dbd2aa605b60922404183ec2735e8f28
download teams.yaml "$upstream/teams.yaml" dc0723e5164d19b5d147ee9133db170fb83eedb3b884e320cd58ee36435cd3b3
download teams-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/teams.yaml" a96864edb919a027e886752898e3e115ca997381af39f97b5a8e28186172893f
download roles.yaml "$upstream/roles.yaml" 6869450fda52c0b2e06dd228cef1e08c309e35493e15fbdda604e35db9593258
download roles-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/roles.yaml" 6869450fda52c0b2e06dd228cef1e08c309e35493e15fbdda604e35db9593258
download groups.yaml "$upstream/groups.yaml" 728ea0e63e5e996f0f8b13d450a695ced4d09adddfb8571e884c89cc456079bb
download groups-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/groups.yaml" dfd8365bd2bf490a4857663ed2ec1cab9d6889665423abe1b4a9d7d244777f67
download commands.yaml "$upstream/commands.yaml" 91517ad53a1d46cf2cbeaa5143865d12cdce9e20997f1bc84e74c98908578f25
download commands-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/commands.yaml" 2ed01e423ff689cc230d0d049b2c9c92bb791b879bfcc7ca93a3bd3cc6d5b8d7
download channels.yaml "$upstream/channels.yaml" 34282bb7db184ae792493b97b384f9b47c0789d9f8dce7527cb2f3df9c09f9b3
download channels-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/channels.yaml" 57be9442965e8a747d88d579df013fdff377a5315cc91a8dc55f58eefeef2a6d
download preferences-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/preferences.yaml" 3bf3c9734d69bfdf20e1dd4e71158a65a81fca9dd64ee1703269b460111625a2
download preferences.yaml "$upstream/preferences.yaml" 3bf3c9734d69bfdf20e1dd4e71158a65a81fca9dd64ee1703269b460111625a2
download bookmarks.yaml "$upstream/bookmarks.yaml" fc24c32a05a2cceeeb7d43dc8794827a5520ce1f44613b4d2e0e5b1847557257
download bookmarks-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/bookmarks.yaml" 7b40fb9661f1e642ecc2fc60cd4e293493d7bb1776c1d186747014144ba088bb
download files.yaml "$upstream/files.yaml" c204f5c97602b2ac5bb023c7d56cd02fae30b5bfc4094101ef59e6e1d0118652
download files-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/files.yaml" 0a08b46860b5bf677fbcafecb97062ac53bf8a35e12cfa864a4dad26ff10b2ec
download posts.yaml "$upstream/posts.yaml" 83400ef682b755f3f3830dd4b622373b659bcc5b4d2d159756a735752b3b19ff
download emoji.yaml "$upstream/emoji.yaml" 295cfd21f759cb56ea31d3a8e76c8ffeaac518c004cec4f90dfee9a1c3c96711
download emoji-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/emoji.yaml" 295cfd21f759cb56ea31d3a8e76c8ffeaac518c004cec4f90dfee9a1c3c96711
download reactions.yaml "$upstream/reactions.yaml" 2eba6a5191114022b553e8f606cd3114bdb025875aea264438b5052d7a3b6d9d
download reactions-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/reactions.yaml" c8bf65a86d4abe0149df0b6da4cfd9c7b5d04bd0a9c6ce2d56d0b1284a440ae2
download posts-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/posts.yaml" d133032e5ffa60c816a4fd084e46b761a04eba0a070b11175f6dee3ac0c71020
download users-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/users.yaml" ef8e987ef018da1d5a106c517f171449b69aac1bf75faa33b0350c8ff0cee370
download definitions-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/definitions.yaml" 77a45d4af02436a67a1a84983742db82c73d44d3e881370bc896d61cd9d5fd48
download definitions.yaml "$upstream/definitions.yaml" 5c0f1f17fc06f6d7d105f59fdffe60204a9862c99593b7ad33cf908871660d96
download "$generator" "https://repo.maven.apache.org/maven2/org/openapitools/openapi-generator-cli/7.27.0/$generator" db9c4b738727698748746144394cb7ee96512fe50166555baaeeca9311ee1dba

npm run contract:build -- "$cache" "$work/openapi.json" "$work/native-auth.json"
"$JAVA_HOME/bin/java" -jar "$cache/$generator" validate -i "$work/openapi.json"
"$JAVA_HOME/bin/java" -jar "$cache/$generator" validate -i "$work/native-auth.json"
"$JAVA_HOME/bin/java" -jar "$cache/$generator" generate -g rust \
    -i "$work/native-auth.json" -o "$work/native" \
    --global-property models=Login_request,modelDocs=false,modelTests=false \
    --type-mappings 'string+password=models::SecretInput'
rustfmt --edition 2024 "$work/native/src/models/login_request.rs"
mkdir "$work/templates"
for template in apis.mustache apisReturnType.mustache modelGeneric.mustache; do
    unzip -p "$cache/$generator" "typescript-fetch/$template" > "$work/templates/$template"
done
# Pinned typescript-fetch otherwise drops nullable on a top-level array response.
patch -s -F 0 -p1 -d "$work/templates" < contracts/mattermost/nullable-array.patch
# Convert the models inside array-valued response dictionaries in both directions.
patch -s -F 0 -p1 -d "$work/templates" < contracts/mattermost/model-array-map.patch
"$JAVA_HOME/bin/java" -jar "$cache/$generator" generate -g typescript-fetch \
    -i "$work/openapi.json" -o "$work/client" -t "$work/templates" --additional-properties=importFileExtension=.js
strict_tsc() {
    node_modules/.bin/tsc --ignoreConfig --strict --target ES2022 --module NodeNext \
        --lib ES2022,DOM,DOM.Iterable --types node "$@"
}
strict_tsc --declaration --removeComments --rootDir "$work/client" --outDir "$work/compiled" "$work/client/index.ts"
cat > "$work/transport-types.ts" <<'TS'
import type { createRestTransport } from "../../src/mattermost/rest-transport.js";
import type { ConfigurationParameters } from "./client/runtime.js";
import type { ThreadsApi, UserThread, UsersApi, GetPostInfoRequest, GetPostThreadRequest, GetPostsForChannelRequest, GetUsersByIdsRequest, Post, PostInfo, PostList, User } from "./compiled/index.js";
declare const transport: ReturnType<typeof createRestTransport>;
transport satisfies Required<Pick<ConfigurationParameters, "basePath" | "fetchApi">>;
declare const threads: ThreadsApi;
const selection = {userId: "me", teamId: "team", threadId: "thread"};
(await threads.updateThreadReadForUser({...selection, timestamp: Date.now()})) satisfies UserThread;
(await threads.updateThreadsReadForUser(selection)).status satisfies string | undefined;
// @ts-expect-error callers use Unix milliseconds as a number
threads.updateThreadReadForUser({...selection, timestamp: "1700000000000"});
const followed = await threads.getUserThreads({ userId: "me", teamId: "team", before: "thread", perPage: 25, unread: true, threadsOnly: true });
followed.threads satisfies UserThread[] | null | undefined;
followed.threads?.[0].participants?.[0].username satisfies string | undefined;
followed.threads?.[0].unreadReplies satisfies number | undefined;
followed.totalUnreadUrgentMentions satisfies number | undefined;
// @ts-expect-error The server takes thread IDs as cursors and ignores page numbers.
threads.getUserThreads({ userId: "me", teamId: "team", page: 2 });
import type { FilesApi as FileContentApi } from "./compiled/index.js";
declare const content: FileContentApi;
for (const method of ["getFileRaw", "getFileThumbnailRaw", "getFilePreviewRaw"] as const) {
    const reply = await content[method]({ fileId: "file", range: "bytes=0-7" });
    reply.raw.body satisfies ReadableStream<Uint8Array> | null;
    reply.value() satisfies Promise<Blob>;
    // @ts-expect-error Each representation requires a file ID.
    content[method]({ range: "bytes=0-7" });
}
import type { FileInfo, PostsApi } from "./compiled/index.js";
declare const attachmentPosts: PostsApi;
const attachments = await attachmentPosts.getFileInfosForPost({ postId: "a-post" });
attachments satisfies FileInfo[] | null;
// @ts-expect-error The server may serialize an empty file list as null.
attachments satisfies FileInfo[];
// @ts-expect-error A post ID is required even when includeDeleted is absent.
attachmentPosts.getFileInfosForPost({});
declare const users: UsersApi;
(await users.getUsers({page: 0, perPage: 20, inTeam: "team", active: true})) satisfies User[];
(await users.searchUsers({searchUsersRequest: {term: "name", teamId: "team", limit: 20, allowInactive: false}})) satisfies User[];
// @ts-expect-error The search term is required.
users.searchUsers({searchUsersRequest: {teamId: "team"}});
// @ts-expect-error The page number is numeric.
users.getUsers({page: "0"});
(await users.getUsersByUsernames({ requestBody: ["ada"] })) satisfies User[];
(await users.getUserByUsername({ username: "fixture:remote" })) satisfies User;
(await users.getUserByEmail({ email: "fixture+dm@example.test" })) satisfies User;
// @ts-expect-error An exact lookup needs its path identifier.
users.getUserByUsername({});
// @ts-expect-error The email path parameter is a string.
users.getUserByEmail({ email: 42 });
(await users.getProfileImage({ userId: "user" })) satisfies Blob;
// @ts-expect-error Usernames are strings.
users.getUsersByUsernames({ requestBody: [42] });
// @ts-expect-error A profile image belongs to one user.
users.getProfileImage({});
declare const user: User;
user.position satisfies string | undefined;
user.isBot satisfies boolean | undefined;
user.remoteId satisfies string | undefined;
// @ts-expect-error The bot flag is a boolean.
const invalidUser: User = { isBot: "true" };
const ids: GetUsersByIdsRequest = { requestBody: ["an-id"], since: 123 };
// @ts-expect-error Mattermost accepts string IDs only.
const numbers: GetUsersByIdsRequest = { requestBody: [42] };
// @ts-expect-error Generated callers must supply the array.
const missing: GetUsersByIdsRequest = {};
const history: GetPostsForChannelRequest = {
    channelId: "an-id", skipFetchThreads: false, collapsedThreads: true, collapsedThreadsExtended: true,
};
// @ts-expect-error Thread switches are booleans.
const badFlag: GetPostsForChannelRequest = { channelId: "an-id", collapsedThreads: "true" };
const lookup: GetPostInfoRequest = { postId: "a-post-id" };
// @ts-expect-error The request must identify one post.
const unbound: GetPostInfoRequest = {};
declare const info: PostInfo;
info.hasJoinedTeam satisfies boolean | undefined;
info.hasJoinedChannel satisfies boolean | undefined;
info.channelId satisfies string | undefined;
const thread: GetPostThreadRequest = { postId: "a-post-id", fromCreateAt: 12, perPage: 1, direction: "down", updatesOnly: false };
// @ts-expect-error Timestamps on a thread cursor are numbers.
const badCursor: GetPostThreadRequest = { postId: "a-post-id", fromCreateAt: "12" };
declare const page: PostList;
import type { ChannelsApi, Preference, PreferencesApi } from "./compiled/index.js";
declare const channels: ChannelsApi;
(await channels.createDirectChannel({ requestBody: ["self"] })).id satisfies string | undefined;
(await channels.createGroupChannel({ requestBody: ["first", "second"] })).type satisfies string | undefined;
// @ts-expect-error A conversation request contains user IDs.
channels.createDirectChannel({ requestBody: [7] });
// @ts-expect-error A group needs its participant array.
channels.createGroupChannel({});
import type { SharedChannelsApi } from "./compiled/index.js";
declare const shared: SharedChannelsApi;
const dmCapability = await shared.canUserDirectMessage({ userId: "me", otherUserId: "peer" });
dmCapability.canDm satisfies boolean;
// @ts-expect-error An intended recipient is required.
shared.canUserDirectMessage({ userId: "me" });
// @ts-expect-error The request belongs to an account.
shared.canUserDirectMessage({ otherUserId: "peer" });
const managed = await channels.getManagedCategories({ teamId: "team" });
managed satisfies Record<string, string>;
// @ts-expect-error The mapping belongs to one team.
channels.getManagedCategories({});
const memberAdded = await channels.addChannelMember({ channelId: "channel", addChannelMemberRequest: { userId: "user", postRootId: "root" } });
memberAdded.channelId satisfies string | undefined;
(await channels.removeUserFromChannel({ channelId: "channel", userId: "user" })).status satisfies string | undefined;
// @ts-expect-error An individual addition requires the user ID.
channels.addChannelMember({ channelId: "channel", addChannelMemberRequest: {} });
// @ts-expect-error The server returns a different shape for a bulk invitation.
channels.addChannelMember({ channelId: "channel", addChannelMemberRequest: { userIds: ["user"] } });
const groupCounts = await channels.getChannelMemberCountsByGroup({ channelId: "room", includeTimezones: true });
for (const group of groupCounts) {
    group.groupId satisfies string;
    group.channelMemberCount satisfies number;
    group.channelMemberTimezonesCount satisfies number;
}
const stats = await channels.getChannelStats({ channelId: "room", excludeFilesCount: true });
stats.channelId satisfies string;
stats.memberCount satisfies number;
stats.guestCount satisfies number;
stats.pinnedpostCount satisfies number;
stats.filesCount satisfies number;
const zones = await channels.getChannelMembersTimezones({ channelId: "room" });
zones satisfies string[] | null;
// @ts-expect-error Fresh accounts with no known timezones return JSON null.
zones satisfies string[];
import type { GroupsApi } from "./compiled/index.js";
declare const mentionGroups: GroupsApi;
const matches = await mentionGroups.getGroups({ q: "release", page: 0, perPage: 60, filterAllowReference: true, includeMemberCount: true });
for (const group of matches) {
    group.remoteId satisfies string | null;
    group.allowReference satisfies boolean;
    group.name satisfies string | undefined;
    group.memberCount satisfies number | undefined;
}
// @ts-expect-error A textual flag would change the wire representation.
mentionGroups.getGroups({ filterAllowReference: "true" });
import type { Role, RolesApi } from "./compiled/index.js";
declare const roles: RolesApi;
const assigned = await roles.getRolesByNames({ requestBody: ["channel_user", "team_guest"] });
assigned satisfies Role[] | null;
assigned?.[0]?.permissions satisfies string[] | undefined;
assigned?.[0]?.schemeManaged satisfies boolean | undefined;
// @ts-expect-error An all-missing batch can return null.
assigned satisfies Role[];
// @ts-expect-error The endpoint requires an array of role names.
roles.getRolesByNames({ requestBody: "channel_user" });
import type { CommandsApi, CommandResponse } from "./compiled/index.js";
declare const commands: CommandsApi;
const command = await commands.executeCommand({ executeCommandRequest: { channelId: "dm", teamId: "workspace", rootId: "root", command: "/help" } });
command.responseType satisfies string;
command.skipSlackParsing satisfies boolean;
command.extraResponses satisfies (CommandResponse | null)[] | null;
const child = command.extraResponses?.[0];
if (child) child.responseType satisfies string;
// @ts-expect-error A successful response can contain a null nested item.
command.extraResponses satisfies CommandResponse[] | null;
const attachment = command.attachments?.[0];
// @ts-expect-error A nested attachment may also be null.
const validAttachment: object | undefined = attachment;
// @ts-expect-error Command execution requires a channel.
commands.executeCommand({ executeCommandRequest: { command: "/help" } });
// @ts-expect-error The server determines the caller from the session.
commands.executeCommand({ executeCommandRequest: { channelId: "dm", command: "/help", userId: "other" } });
const commandChoices = await commands.listAutocompleteCommands({ teamId: "workspace" });
commandChoices[0]?.autocompleteIconData satisfies string | undefined;
// @ts-expect-error The command picker exposes only fields needed by its user.
commandChoices[0]?.token;
const suggestions = await commands.listCommandAutocompleteSuggestions({ teamId: "workspace", userInput: "/he", channelId: "dm", rootId: "root" });
suggestions[0]?.suggestion satisfies string | undefined;
// @ts-expect-error The user input must be present in a suggestion request.
commands.listCommandAutocompleteSuggestions({ teamId: "workspace" });
declare const preferences: PreferencesApi;
const sidebar = await channels.getSidebarCategoriesForTeamForUser({ userId: "me", teamId: "team" });
sidebar.order satisfies string[] | undefined;
sidebar.categories?.[0]?.collapsed satisfies boolean | undefined;
sidebar.categories?.[0]?.muted satisfies boolean | undefined;
sidebar.categories?.[0]?.sorting satisfies string | undefined;
sidebar.categories?.[0]?.sortOrder satisfies number | undefined;
const categoryType: NonNullable<NonNullable<typeof sidebar.categories>[number]["type"]> = "managed";
// @ts-expect-error A sidebar is scoped to a team.
channels.getSidebarCategoriesForTeamForUser({ userId: "me" });
const savedPreferences = await preferences.getPreferences({ userId: "me" });
savedPreferences satisfies Preference[] | null;
// @ts-expect-error A user with no saved preferences receives null.
savedPreferences satisfies Preference[];
savedPreferences?.[0]?.value satisfies string | undefined;
// @ts-expect-error Preference values remain strings.
savedPreferences?.[0]?.value satisfies boolean | undefined;
(await channels.getChannel({ channelId: "channel" })).deleteAt satisfies number | undefined;
// @ts-expect-error A channel ID is required.
channels.getChannel({});
const teamChannels = await channels.getChannelsForTeamForUser({ userId: "me", teamId: "team" });
teamChannels[0]?.totalMsgCountRoot satisfies number | undefined;
teamChannels[0]?.lastRootPostAt satisfies number | undefined;
const members = await channels.getChannelMembersForUser({ userId: "me", teamId: "team" });
import type { TeamsApi } from "./compiled/index.js";
declare const teams: TeamsApi;
(await teams.addTeamMember({teamId: "team", addTeamMemberRequest: {teamId: "team", userId: "user"}})).teamId satisfies string | undefined;
(await teams.removeTeamMember({teamId: "team", userId: "user"})).status satisfies string | undefined;
// @ts-expect-error Mattermost compares the body team ID with the path.
teams.addTeamMember({teamId: "team", addTeamMemberRequest: {userId: "user"}});
// @ts-expect-error Mattermost requires an explicit user ID in the body.
teams.addTeamMember({teamId: "team", addTeamMemberRequest: {teamId: "team"}});
const myTeams = await teams.getTeamMembersForUser({ userId: "me" });
myTeams[0]?.schemeGuest satisfies boolean | undefined;
myTeams[0]?.deleteAt satisfies number | undefined;
members[0]?.schemeGuest satisfies boolean | undefined;
members[0]?.schemeAdmin satisfies boolean | undefined;
members[0]?.schemeUser satisfies boolean | undefined;
members[0]?.explicitRoles satisfies string | undefined;
// @ts-expect-error A membership read identifies its user.
teams.getTeamMembersForUser({});
members[0]?.msgCountRoot satisfies number | undefined;
members[0]?.mentionCountRoot satisfies number | undefined;
members[0]?.urgentMentionCount satisfies number | undefined;
import type { ReactionsApi, Reaction } from "./compiled/index.js";
import type { EmojiApi } from "./compiled/index.js";
declare const customEmoji: EmojiApi;
const entry = await customEmoji.getEmojiByName({ emojiName: "fixture_wave" });
entry.name satisfies string;
entry.creatorId satisfies string;
entry.createAt satisfies number;
entry.deleteAt satisfies number;
// @ts-expect-error An exact lookup requires the emoji name.
customEmoji.getEmojiByName({});
declare const reactionsApi: ReactionsApi;
const reactionList = await reactionsApi.getReactions({ postId: "post" });
reactionList satisfies Reaction[] | null;
// @ts-expect-error An empty reaction list is encoded as null.
reactionList satisfies Reaction[];
const origin: string | null = reactionList?.[0]?.remoteId ?? null;
reactionList?.[0]?.channelId satisfies string | undefined;
declare const post: Post;
post.messageSource satisfies string | undefined;
page.firstInaccessiblePostTime satisfies number | undefined;
post.replyCount satisfies number | undefined;
post.lastReplyAt satisfies number | undefined;
post.isFollowing satisfies boolean | undefined;
post.participants?.[0]?.id satisfies string | undefined;
post.metadata?.images?.["https://fixture.invalid/sample.png"]?.frameCount satisfies number | undefined;
// @ts-expect-error Image dimensions are indexed by URL.
post.metadata?.images?.map((image: unknown) => image);
TS
strict_tsc --noEmit --allowImportingTsExtensions "$work/transport-types.ts"
UMMKA_CONTRACT_SOURCES="$cache" UMMKA_CONTRACT_WORK="$work" npm run contract:test
bindings=vendor/mattermost
native_bindings=vendor/mattermost-native
if [ "${1-}" = "--write-bindings" ]; then
    mkdir -p vendor/emoji
    cp "$work/emoji.json" vendor/emoji/standard.json
    mkdir -p "$bindings" "$native_bindings"
    rsync --recursive --checksum --delete-after --delay-updates "$work/compiled/" "$bindings/"
    rsync --recursive --checksum --delete-after --delay-updates "$work/native/src/models/" "$native_bindings/"
fi
if ! cmp "$work/emoji.json" vendor/emoji/standard.json; then
    echo 'The emoji directory differs. Run make generate-bindings and review the changes.' >&2
    exit 1
fi
if ! diff -qr "$work/compiled" "$bindings" || ! diff -qr "$work/native/src/models" "$native_bindings"; then
    echo 'Mattermost bindings differ. Run make generate-bindings and review the changes.' >&2
    exit 1
fi
npm run test:rest
spec="artifacts/mattermost-v$version.openapi.json"
mv "$work/openapi.json" "$spec"
mv "$work/native-auth.json" "artifacts/mattermost-v$version.native-auth.openapi.json"
shasum -a 256 "$spec"
