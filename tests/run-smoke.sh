#!/usr/bin/env bash
# Run the smoke test in a private headless GNOME Shell 51 session.
#
# Usage: tests/run-smoke.sh [wayland|x11] [screenshot.png]
#
# RWC_SMOKE_MONITOR sets the size of the virtual monitor, 1280x720 by
# default, or of several, separated by spaces. RWC_SMOKE_SCRIPT selects
# another automation script, for example tests/coverage-smoke.js.
# RWC_SMOKE_LOG keeps the session log. RWC_SMOKE_NO_X11 skips the X11
# runs.
#
# The session uses its own XDG directories and an in-memory GSettings
# backend, so it never touches the settings or extensions of the
# running desktop.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
args=("$@")
backend=${1:-wayland}
shot=${2:-}

case "$backend" in
    wayland) compositor_args=(--no-x11) ;;
    x11) compositor_args=() ;;
    *) echo 'Usage: tests/run-smoke.sh [wayland|x11] [screenshot.png]' >&2; exit 2 ;;
esac

name=$(basename "${RWC_SMOKE_SCRIPT:-smoke.js}" .js)
if [[ $backend == x11 && -n "${RWC_SMOKE_NO_X11:-}" ]]; then
    printf 'GNOME Shell 51 x11 %s skipped.\n' "$name"
    exit 0
fi

case "$(gnome-shell --version)" in
    'GNOME Shell 51'*) ;;
    *) echo 'This smoke test requires GNOME Shell 51.' >&2; exit 2 ;;
esac

scratch=$(mktemp -d)
log="$scratch/session.log"

# Keep the log for inspection if RWC_SMOKE_LOG names a file. The document
# portal mounts a FUSE file system in the runtime directory and may still
# be unmounting it when the session ends, so detach it first. Cleaning up
# never changes the result.
cleanup() {
    local status=$?
    if [[ -n "${RWC_SMOKE_LOG:-}" && -f "$log" ]]; then
        cp -- "$log" "$RWC_SMOKE_LOG"
    fi
    fusermount3 -uz "$scratch/runtime/doc" 2>/dev/null || true
    rm -rf -- "$scratch" || echo "Could not remove $scratch" >&2
    exit "$status"
}
trap cleanup EXIT

errors='GNOME Shell-CRITICAL|JS ERROR|JS WARNING|Failed to create offscreen|already disposed|\(gnome-shell:[0-9]+\).*CRITICAL|\[RWC Ultimate\]'

# The shell's test client, a GTK app that opens the test windows, now and
# then crashes under Xwayland on slow machines, in the middle of a call.
# That is not ours to fix, so such a run is repeated once.
client_crashed() {
    [[ -z "${RWC_SMOKE_RETRY:-}" ]] &&
        grep -q 'Message recipient disconnected from message bus' "$log"
}

# Print the session log and fail, or try again after a crashed test
# client. On GitHub, also add annotations, which can be read without the
# log: the first line that explains the failure, and the warnings and
# errors right before it, for example from Xwayland or the test client.
fail() {
    cat "$log"
    local level=error
    client_crashed && level=warning
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
        local reason stop context
        reason=$(grep -m1 -E "$errors" "$log" || echo "$1")
        # GitHub reads % as the start of an escape and %0A as a line break.
        echo "::$level title=$name ($backend)::${reason//%/%25}"
        # What led to the failure, without the noise of shutting down.
        stop=$(grep -n -m1 -E "$errors" "$log" | cut -d: -f1)
        context=$(head -n "${stop:-$(wc -l < "$log")}" "$log" |
            grep -iE 'xwayland|perf-helper|gdk|gtk|warning|critical|error|fail' |
            tail -n 40 | cut -c1-240 | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\n/%0A/g')
        # GitHub cuts annotations after 4096 characters; keep the end.
        (( ${#context} <= 3800 )) || context="...${context: -3800}"
        [[ -z "$context" ]] || echo "::notice title=$name ($backend) log::$context"
    fi
    if [[ $level == warning ]]; then
        echo "The test client crashed, trying $name ($backend) once more." >&2
        RWC_SMOKE_RETRY=1 "$0" "${args[@]}"
        exit
    fi
    exit 1
}

mkdir -p "$scratch"/{runtime,data,config,cache,ext}
chmod 700 "$scratch/runtime"

make -s -C "$repo_root" pack
uuid=$(sed -n 's/^UUID = //p' "$repo_root/Makefile")
unzip -q "$repo_root/$uuid.shell-extension.zip" -d "$scratch/ext"
glib-compile-schemas "$scratch/ext/schemas"

export XDG_RUNTIME_DIR="$scratch/runtime" XDG_DATA_HOME="$scratch/data"
export XDG_CONFIG_HOME="$scratch/config" XDG_CACHE_HOME="$scratch/cache"
export GSETTINGS_BACKEND=memory GIO_USE_VFS=local GIO_USE_VOLUME_MONITOR=unix
export LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND="$backend"
# Keep the software-rendered test independent of an installed NVIDIA EGL vendor.
if [[ -f /usr/share/glvnd/egl_vendor.d/50_mesa.json ]]; then
    export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
fi
export RWC_TEST_BACKEND="$backend" RWC_TEST_EXTENSION="$scratch/ext"
export RWC_TEST_SCREENSHOT="${shot:+$(realpath -m -- "$shot")}"

monitor_args=()
for monitor in ${RWC_SMOKE_MONITOR:-1280x720}; do
    monitor_args+=(--virtual-monitor "$monitor")
done

if ! timeout -k 3s 60s dbus-run-session -- gnome-shell --headless \
    --force-animations "${compositor_args[@]}" \
    "${monitor_args[@]}" \
    --automation-script "${RWC_SMOKE_SCRIPT:-$repo_root/tests/smoke.js}" > "$log" 2>&1; then
    fail 'The session timed out or failed'
fi

if ! grep -q 'RWC_SMOKE_PASS' "$log" || grep -Eq "$errors" "$log"; then
    fail 'The script did not finish'
fi

grep '^RWC_SKIP' "$log" || true
printf 'GNOME Shell 51 %s %s passed.\n' "$backend" "$name"
