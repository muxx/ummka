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
partial=''
trap 'rm -rf "$work"; if [ -n "$partial" ]; then rm -f "$partial"; fi' EXIT

download() {
    target="$cache/$1"
    candidate="$target"
    if [ ! -f "$target" ]; then
        partial=$(mktemp "$cache/.download.XXXXXXXX")
        candidate="$partial"
        printf 'Downloading %s\n' "$1"
        curl -fsSL --retry 3 --max-time 300 "$2" -o "$candidate"
    fi
    if ! printf '%s  %s\n' "$3" "$candidate" | shasum -a 256 --check --status; then
        echo "SHA-256 mismatch for $1" >&2
        exit 1
    fi
    if [ -n "$partial" ]; then
        mv "$partial" "$target"
        partial=''
    fi
}

download introduction.yaml "$upstream/introduction.yaml" 4b3786cc86ec1097c29f5b1bea8e9a32d09c4ddb6244140ec094425b6fdc5e09
download system.yaml "$upstream/system.yaml" 10e9e11b14d34d30a661474269f69220f8ebdb05db64cd53e30cb199a665ae8e
download users.yaml "$upstream/users.yaml" 20d0c9cf9631682f3461c7b13a521321dbd2aa605b60922404183ec2735e8f28
download teams.yaml "$upstream/teams.yaml" dc0723e5164d19b5d147ee9133db170fb83eedb3b884e320cd58ee36435cd3b3
download channels.yaml "$upstream/channels.yaml" 34282bb7db184ae792493b97b384f9b47c0789d9f8dce7527cb2f3df9c09f9b3
download posts.yaml "$upstream/posts.yaml" 83400ef682b755f3f3830dd4b622373b659bcc5b4d2d159756a735752b3b19ff
download posts-12.1.0.yaml "https://raw.githubusercontent.com/mattermost/mattermost/243e3d0135203ab9166fe8f2873b07f697b06fd4/api/v4/source/posts.yaml" d133032e5ffa60c816a4fd084e46b761a04eba0a070b11175f6dee3ac0c71020
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
"$JAVA_HOME/bin/java" -jar "$cache/$generator" generate -g typescript-fetch \
    -i "$work/openapi.json" -o "$work/client" --additional-properties=importFileExtension=.js
strict_tsc() {
    node_modules/.bin/tsc --ignoreConfig --strict --target ES2022 --module NodeNext \
        --lib ES2022,DOM,DOM.Iterable --types node "$@"
}
strict_tsc --declaration --removeComments --rootDir "$work/client" --outDir "$work/compiled" "$work/client/index.ts"
cat > "$work/transport-types.ts" <<'TS'
import type { createRestTransport } from "../../src/mattermost/rest-transport.js";
import type { ConfigurationParameters } from "./client/runtime.js";
import type { GetPostInfoRequest, GetPostThreadRequest, GetPostsForChannelRequest, GetUsersByIdsRequest, Post, PostInfo, PostList } from "./compiled/index.js";
declare const transport: ReturnType<typeof createRestTransport>;
transport satisfies Required<Pick<ConfigurationParameters, "basePath" | "fetchApi">>;
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
declare const post: Post;
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
    mkdir -p "$bindings" "$native_bindings"
    rsync --recursive --checksum --delete-after --delay-updates "$work/compiled/" "$bindings/"
    rsync --recursive --checksum --delete-after --delay-updates "$work/native/src/models/" "$native_bindings/"
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
