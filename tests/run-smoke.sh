#!/usr/bin/env bash
# Run the smoke test in a private headless GNOME Shell 51 session.
#
# Usage: tests/run-smoke.sh [wayland|x11] [screenshot.png]
#
# RWC_SMOKE_SCRIPT selects another automation script, for example
# tests/coverage-smoke.js. RWC_SMOKE_LOG keeps the session log.
#
# The session uses its own XDG directories and an in-memory GSettings
# backend, so it never touches the settings or extensions of the
# running desktop.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
backend=${1:-wayland}
shot=${2:-}

case "$backend" in
    wayland) compositor_args=(--no-x11) ;;
    x11) compositor_args=() ;;
    *) echo 'Usage: tests/run-smoke.sh [wayland|x11] [screenshot.png]' >&2; exit 2 ;;
esac

case "$(gnome-shell --version)" in
    'GNOME Shell 51'*) ;;
    *) echo 'This smoke test requires GNOME Shell 51.' >&2; exit 2 ;;
esac

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
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

log="$scratch/session.log"
# Keep the log for inspection if RWC_SMOKE_LOG names a file.
trap '[[ -n "${RWC_SMOKE_LOG:-}" && -f "$log" ]] && cp -- "$log" "$RWC_SMOKE_LOG"; rm -rf -- "$scratch"' EXIT
if ! timeout -k 3s 60s dbus-run-session -- gnome-shell --headless \
    --force-animations "${compositor_args[@]}" --virtual-monitor 1280x720 \
    --automation-script "${RWC_SMOKE_SCRIPT:-$repo_root/tests/smoke.js}" > "$log" 2>&1; then
    cat "$log"
    exit 1
fi

if ! grep -q 'RWC_SMOKE_PASS' "$log" || grep -Eq \
    'GNOME Shell-CRITICAL|JS ERROR|JS WARNING|Failed to create offscreen|already disposed|\(gnome-shell:[0-9]+\).*CRITICAL|\[RWC Ultimate\]' \
    "$log"; then
    cat "$log"
    exit 1
fi

grep '^RWC_SKIP' "$log" || true
printf 'GNOME Shell 51 %s %s passed.\n' "$backend" \
    "$(basename "${RWC_SMOKE_SCRIPT:-smoke.js}" .js)"
