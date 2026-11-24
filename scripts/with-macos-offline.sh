#!/bin/bash
set -euo pipefail

# Only the disposable GitHub host may disconnect its default network interface.
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
interface=$(route -n get default | awk '/interface:/ {print $2}')
test -n "$interface"
network_available() {
    curl --head --silent --show-error --output /dev/null "$@" https://github.com/robots.txt
}
network_available --max-time 5
(sleep 40; sudo /sbin/ifconfig "$interface" up) > /dev/null 2>&1 &
watchdog=$!
restore() {
    sudo /sbin/ifconfig "$interface" up
    kill "$watchdog" 2>/dev/null || true
}
trap restore EXIT
sudo /sbin/ifconfig "$interface" down
if network_available --max-time 3 2>/dev/null; then
    echo 'The runner still has network access.' >&2
    exit 1
fi
"$@"
if ! kill -0 "$watchdog" 2>/dev/null || network_available --max-time 2 2>/dev/null; then
    echo 'Network isolation ended before the check finished.' >&2
    exit 1
fi
restore
trap - EXIT
for attempt in {1..6}; do
    network_available --max-time 4 && exit 0
    test "$attempt" -lt 6 || exit 1
    sleep 1
done
