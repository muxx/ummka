#!/bin/bash
set -euo pipefail

app="$1"
archive="$2"
codesign --verify --deep --strict "$app"

archive_dir=$(dirname "$archive")
mkdir -p "$archive_dir"
scratch=$(mktemp -d "$archive_dir/.macos-package.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ditto -c -k --keepParent "$app" "$scratch/app.zip"
ditto -x -k "$scratch/app.zip" "$scratch/unpacked"
unpacked_app="$scratch/unpacked/$(basename "$app")"
codesign --verify --deep --strict "$unpacked_app"

# Mutate only the disposable extraction, leaving the ZIP intact.
icon="$unpacked_app/Contents/Resources/icon.icns"
test -f "$icon"
printf '\n' >> "$icon"
if codesign --verify --deep --strict "$unpacked_app"; then
    echo 'Strict verification accepted a modified macOS resource.' >&2
    exit 1
fi

mv -f "$scratch/app.zip" "$archive"
