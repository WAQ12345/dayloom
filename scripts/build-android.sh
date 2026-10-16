#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./scripts/with-local-env.sh npx expo prebuild --platform android --no-install
set -- assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a '-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m'
if [ -n "${DAILY_HTTP_PROXY_PORT:-}" ]; then
  DAILY_PROXY_HOST="${DAILY_HTTP_PROXY_HOST:-127.0.0.1}"
  set -- "$@" "-Dhttp.proxyHost=$DAILY_PROXY_HOST" "-Dhttp.proxyPort=$DAILY_HTTP_PROXY_PORT" "-Dhttps.proxyHost=$DAILY_PROXY_HOST" "-Dhttps.proxyPort=$DAILY_HTTP_PROXY_PORT"
fi
./scripts/with-local-env.sh sh -c 'cd android && exec ./gradlew "$@"' sh "$@"
mkdir -p artifacts
cp android/app/build/outputs/apk/release/app-release.apk artifacts/daily-life-validation.apk
