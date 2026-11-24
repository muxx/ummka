#!/bin/sh
set -eu

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
download definitions.yaml "$upstream/definitions.yaml" 5c0f1f17fc06f6d7d105f59fdffe60204a9862c99593b7ad33cf908871660d96
download "$generator" "https://repo.maven.apache.org/maven2/org/openapitools/openapi-generator-cli/7.27.0/$generator" db9c4b738727698748746144394cb7ee96512fe50166555baaeeca9311ee1dba

npm run contract:build -- "$cache" "$work/openapi.json"
"$JAVA_HOME/bin/java" -jar "$cache/$generator" validate -i "$work/openapi.json"
"$JAVA_HOME/bin/java" -jar "$cache/$generator" generate -g typescript-fetch \
    -i "$work/openapi.json" -o "$work/client" --additional-properties=importFileExtension=.js
strict_tsc() {
    node_modules/.bin/tsc --ignoreConfig --strict --target ES2022 --module NodeNext \
        --lib ES2022,DOM,DOM.Iterable --types node "$@"
}
strict_tsc --rootDir "$work/client" --outDir "$work/compiled" "$work/client/index.ts"
cat > "$work/transport-types.ts" <<'TS'
import type { createRestTransport } from "../../src/mattermost/rest-transport.js";
import type { ConfigurationParameters } from "./client/runtime.js";
declare const transport: ReturnType<typeof createRestTransport>;
transport satisfies Required<Pick<ConfigurationParameters, "basePath" | "fetchApi">>;
TS
strict_tsc --noEmit "$work/transport-types.ts"
UMMKA_CONTRACT_SOURCES="$cache" UMMKA_CONTRACT_WORK="$work" npm run contract:test
spec="artifacts/mattermost-v$version.openapi.json"
mv "$work/openapi.json" "$spec"
shasum -a 256 "$spec"
