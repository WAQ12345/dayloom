#!/bin/sh
# Capture only when Dayloom owns the foreground; avoid collecting other apps.
set -eu
cd "$(dirname "$0")/.."
DAILY_ADB="${DAILY_ADB:-$HOME/Android/sdk/platform-tools/adb}"
DAILY_PACKAGE=app.dayloom.mobile
DAILY_OUTPUT="${1:-artifacts/device-evidence}"
mkdir -p "$DAILY_OUTPUT"
"$DAILY_ADB" get-state > /dev/null
DAILY_FOCUS=$("$DAILY_ADB" shell dumpsys activity activities | rg 'mResumedActivity|topResumedActivity' || true)
case "$DAILY_FOCUS" in
  *"$DAILY_PACKAGE"*) ;;
  *) echo 'Dayloom is not foreground; screenshot capture skipped.' >&2; exit 1;;
esac
"$DAILY_ADB" shell dumpsys package "$DAILY_PACKAGE" | rg 'versionCode=|versionName=|firstInstallTime=|lastUpdateTime=' > "$DAILY_OUTPUT/package.txt"
"$DAILY_ADB" shell getprop ro.build.version.release > "$DAILY_OUTPUT/android-version.txt"
"$DAILY_ADB" shell wm size > "$DAILY_OUTPUT/screen.txt"
"$DAILY_ADB" exec-out screencap -p > "$DAILY_OUTPUT/screen.png"
DAILY_PID=$("$DAILY_ADB" shell pidof "$DAILY_PACKAGE" | tr -d '\r')
if [ -n "$DAILY_PID" ]; then
  "$DAILY_ADB" logcat -d --pid="$DAILY_PID" -t 300 > "$DAILY_OUTPUT/app-log.txt"
fi
printf 'Saved Dayloom device evidence to %s\n' "$DAILY_OUTPUT"
