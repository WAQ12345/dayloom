#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./scripts/with-local-env.sh node scripts/apply-dependency-guards.cjs
python3 scripts/prepare-local-signing.py
. ./artifacts/signing/release.env
./scripts/with-local-env.sh npx expo prebuild --platform android --no-install
if ! grep -q 'daily-life-local-signing' android/app/build.gradle; then
  echo 'Missing signing plugin: add ./plugins/with-local-signing.cjs to Expo plugins.' >&2
  exit 1
fi
set -- assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a '-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m'
if [ -n "${DAILY_HTTP_PROXY_PORT:-}" ]; then
  DAILY_PROXY_HOST="${DAILY_HTTP_PROXY_HOST:-127.0.0.1}"
  set -- "$@" "-Dhttp.proxyHost=$DAILY_PROXY_HOST" "-Dhttp.proxyPort=$DAILY_HTTP_PROXY_PORT" "-Dhttps.proxyHost=$DAILY_PROXY_HOST" "-Dhttps.proxyPort=$DAILY_HTTP_PROXY_PORT"
fi
./scripts/with-local-env.sh sh -c 'cd android && exec ./gradlew "$@"' sh "$@"
mkdir -p artifacts/release
cp android/app/build/outputs/apk/release/app-release.apk artifacts/release/dayloom.apk
./scripts/with-local-env.sh sh -c '"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs artifacts/release/dayloom.apk' > artifacts/release/signature.txt
shasum -a 256 artifacts/release/dayloom.apk > artifacts/release/SHA256SUMS
