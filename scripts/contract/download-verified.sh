#!/bin/sh
# Cache entries from older contract snapshots may have the same name and a different pin.
set -eu
target=$1
url=$2
digest=$3

verify() {
    printf '%s  %s\n' "$digest" "$1" | shasum -a 256 --check --status
}

if [ -f "$target" ] && verify "$target"; then
    exit 0
fi
candidate=$(mktemp "$(dirname "$target")/.download.XXXXXXXX")
trap 'rm -f "$candidate"' EXIT
trap 'exit 1' HUP INT TERM
printf 'Downloading %s\n' "$(basename "$target")"
curl -fsSL --retry 3 --max-time 300 "$url" -o "$candidate"
if ! verify "$candidate"; then
    echo "SHA-256 mismatch for $(basename "$target")" >&2
    exit 1
fi
mv "$candidate" "$target"
