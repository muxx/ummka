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

on nativeControlsAligned(win)
    local controlSubrole, seen
    tell application "System Events"
        set {windowLeft, windowTop} to position of win
        set seen to {}
        repeat with btn in buttons of win
            set controlSubrole to subrole of btn
            if controlSubrole is in {"AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton"} then
                set {btnLeft, btnTop} to position of btn
                set {btnWidth, btnHeight} to size of btn
                set centerY to btnTop + btnHeight / 2 - windowTop
                if centerY < 22 or centerY > 24 then return false
                if btnLeft + btnWidth - windowLeft > 80 then return false
                if controlSubrole is "AXCloseButton" then
                    set centerX to btnLeft + btnWidth / 2 - windowLeft
                    if centerX < 23 or centerX > 25 then return false
                end if
                set end of seen to controlSubrole
            end if
        end repeat
    end tell
    return seen contains "AXCloseButton" and seen contains "AXMinimizeButton" and (seen contains "AXZoomButton" or seen contains "AXFullScreenButton")
end nativeControlsAligned

on checkControlsAtSize(win, targetSize)
    tell application "System Events"
        set size of win to targetSize
        repeat 20 times
            if (size of win is targetSize) and my nativeControlsAligned(win) then return
            delay 0.1
        end repeat
    end tell
    error "The native window buttons are not centered on the 46-point header."
end checkControlsAtSize

on run argv
    set appPid to (item 1 of argv) as integer
    tell application "System Events"
        set proc to first application process whose unix id is appPid
        repeat 40 times
            if exists window 1 of proc then
                set win to window 1 of proc
                if my containsServerField(win, false) and my nativeControlsAligned(win) then
                    set originalSize to size of win
                    my checkControlsAtSize(win, {400, item 2 of originalSize})
                    my checkControlsAtSize(win, originalSize)
                    return
                end if
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
