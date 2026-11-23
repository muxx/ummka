#!/bin/sh
set -eu

mkdir -p artifacts
set -- --no-progress --skip-dirs .git --skip-dirs .check-tools --skip-dirs node_modules \
    --skip-dirs artifacts --skip-dirs dist --skip-dirs src-tauri/target \
    --skip-dirs '**/.gradle' --skip-dirs '**/build'

trivy fs "$@" --scanners vuln --include-dev-deps --format json --output artifacts/trivy.json .
jq -e '(["package-lock.json", "src-tauri/Cargo.lock", "src-tauri/gen/android/app/gradle.lockfile"] - [.Results[].Target]) == []' \
    artifacts/trivy.json > /dev/null || { echo 'The vulnerability report must cover npm, Cargo and Gradle.' >&2; exit 1; }
trivy convert --severity HIGH,CRITICAL --exit-code 1 artifacts/trivy.json
trivy fs "$@" --scanners secret --exit-code 1 .
npm audit --audit-level=moderate
