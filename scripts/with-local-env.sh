#!/bin/sh
set -eu
# Explicit overrides are optional; otherwise respect the caller's environment.
if [ -n "${DAILY_NODE_DIR:-}" ]; then export PATH="$DAILY_NODE_DIR:$PATH"; fi
if [ -n "${DAILY_JAVA_HOME:-}" ]; then export JAVA_HOME="$DAILY_JAVA_HOME"; fi
if [ -n "${JAVA_HOME:-}" ]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
if [ -n "${DAILY_ANDROID_HOME:-}" ]; then export ANDROID_HOME="$DAILY_ANDROID_HOME"; fi
if [ -z "${ANDROID_HOME:-}" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then export ANDROID_HOME="$ANDROID_SDK_ROOT"; fi
if [ -n "${ANDROID_HOME:-}" ]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export PATH="$ANDROID_HOME/platform-tools:$PATH"
fi
exec "$@"
