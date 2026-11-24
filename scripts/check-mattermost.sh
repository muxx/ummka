#!/bin/sh
set -eu

case "${1-}" in
    10.10.1) digest=714be7be92339433c4f9c5ff9de6ebe6540247c6e2154889503a734f9bc9a100 ;;
    12.1.0) digest=35927b9c535a9eb74f0e45385d3fe5d8308b16e0464031f157a834da8af3ee73 ;;
    *) echo 'Expected a supported Mattermost fixture version.' >&2; exit 1 ;;
esac
project="ummka-history-$(openssl rand -hex 8)"
UMMKA_FIXTURE_DB_PASSWORD=$(openssl rand -hex 24)
UMMKA_FIXTURE_GITLAB_SECRET=$(openssl rand -hex 24)
export UMMKA_FIXTURE_DB_PASSWORD UMMKA_FIXTURE_GITLAB_SECRET
export UMMKA_FIXTURE_SERVER_IMAGE="mattermost/mattermost-team-edition@sha256:$digest"
compose() {
    docker compose -p "$project" -f scripts/contract/compatibility/compose.yaml "$@"
}
compose config -q
sources=$(mktemp)
trap 'rm -f "$sources"; compose down --volumes' EXIT
trap 'exit 1' HUP INT TERM
# Snapshot the generated bindings and probe together. A macOS shared mount can
# expose an old file length to Node's module loader after a binding is replaced.
COPYFILE_DISABLE=1 tar -cf "$sources" package.json vendor/mattermost \
    src/mattermost/focused-history.ts src/mattermost/model-fields.ts src/mattermost/channel-post-records.ts src/mattermost/navigation-data.ts \
    src/mattermost/channel-history-page.ts src/mattermost/channel-history-refresh.ts \
    scripts/contract/compatibility/*.ts
compose up -d --wait --wait-timeout 180 database images gitlab mattermost
compose run --rm --no-deps -T probe sh -ec "tar -xf - && exec node scripts/contract/compatibility/history.ts '$1'" <"$sources"
