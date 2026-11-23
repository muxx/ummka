#!/bin/sh
set -eu

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p .check-tools

download() {
    curl --fail --silent --show-error --location --retry 3 "$1" -o "$stage/download"
    printf '%s  %s\n' "$2" "$stage/download" | shasum -a 256 --check --status
}

install_archive() {
    download "$2" "$3"
    tar -xOf "$stage/download" "$4" > "$stage/executable"
    install -m 755 "$stage/executable" ".check-tools/$1"
}

install_archive actionlint \
    https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_arm64.tar.gz \
    aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f actionlint
install_archive shellcheck \
    https://github.com/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.darwin.aarch64.tar.gz \
    339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f shellcheck-v0.11.0/shellcheck
install_archive trivy \
    https://github.com/aquasecurity/trivy/releases/download/v0.70.0/trivy_0.70.0_macOS-ARM64.tar.gz \
    68e543c51dcc96e1c344053a4fde9660cf602c25565d9f09dc17dd41e13b838a trivy
download https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-macos-arm64 \
    a9fe3ea2f86dfc72f6728417521ec9067b343277152b114f4e98d8cb0e263603
install -m 755 "$stage/download" .check-tools/jq
