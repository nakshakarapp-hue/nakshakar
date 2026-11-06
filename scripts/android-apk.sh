#!/usr/bin/env bash
# Builds the web app, copies it into the Android project, and builds both APKs into release/.
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build
npx cap sync android
node scripts/setup-signing.mjs
(
  cd android
  # A global trust-store override can break Gradle's downloads, so it is cleared for this build only.
  unset JAVA_TOOL_OPTIONS
  # The website APK, and the bundle uploaded to Google Play.
  ./gradlew assembleDirectRelease bundlePlayRelease --no-daemon
)
mkdir -p release
cp android/app/build/outputs/apk/direct/release/app-direct-release.apk release/Nakshakar-release.apk
cp android/app/build/outputs/bundle/playRelease/app-play-release.aab release/Nakshakar-play.aab
ls -la release
