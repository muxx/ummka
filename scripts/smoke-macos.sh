#!/bin/bash
set -euo pipefail

# The caller controls connectivity. This script only operates on the unpacked app.
exe="$(cd -P "$1/Contents/MacOS" && pwd)/ummka"
pid=''
cleanup() {
    if [[ -n "$pid" ]]; then kill -TERM "$pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

for run in 1 2; do
    open -n "$1"
    for ((attempt=0; attempt<50; attempt++)); do
        pid=$(ps -axo pid=,comm= | awk -v exe="$exe" '{ p=$1; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, ""); if ($0 == exe) print p }')
        [[ -z "$pid" ]] || break
        sleep 0.1
    done
    [[ -n "$pid" ]] || { echo 'The native app did not launch.' >&2; exit 1; }
    osascript - "$pid" <<'APPLESCRIPT'
on containsServerField(node, insideWebArea)
    tell application "System Events"
        set nodeRole to role of node
        if insideWebArea and nodeRole is "AXTextField" then return enabled of node
        set children to get UI elements of node
    end tell
    set isWebContent to (insideWebArea or nodeRole is "AXWebArea")
    repeat with child in children
        if my containsServerField(contents of child, isWebContent) then return true
    end repeat
    return false
end containsServerField

on hasNativeControls(win)
    local controlSubroles
    tell application "System Events" to set controlSubroles to get subrole of every button of win
    return controlSubroles contains "AXCloseButton" and controlSubroles contains "AXMinimizeButton" and (controlSubroles contains "AXFullScreenButton" or controlSubroles contains "AXZoomButton")
end hasNativeControls

on run argv
    set appPid to (item 1 of argv) as integer
    tell application "System Events"
        set proc to first application process whose unix id is appPid
        repeat 40 times
            if exists window 1 of proc then
                if my containsServerField(window 1 of proc, false) and my hasNativeControls(window 1 of proc) then return
            end if
            delay 0.1
        end repeat
    end tell
    error "The server address field and the system window controls did not appear."
end run
APPLESCRIPT
    kill -TERM "$pid"
    for ((attempt=0; attempt<50; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then echo 'The app did not stop.' >&2; exit 1; fi
    pid=''
    echo "Offline launch $run rendered the server address field."
done
