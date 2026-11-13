#!/usr/bin/env bash
# Build the signed qsearch APK for Android (arm64).
#
# Usage: build_android.sh /path/to/firefox /path/to/keydir [version]
#   firefox  checkout of FIREFOX_153_7_0esr_RELEASE (Linux filesystem)
#   keydir   holds qsearch-android.jks + qsearch-android.password.txt
#            (see make_keystore.sh)
# Result:  qsearch-<version>-android-arm64.apk next to the firefox folder.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tree="$(cd "${1:?firefox tree}" && pwd)"
keys="$(cd "${2:?key directory}" && pwd)"
version="${3:-153.7.0}"
out="$(dirname "$tree")/qsearch-$version-android-arm64.apk"

python3 "$here/apply_android.py" "$tree"

cd "$tree"
./mach build
./mach gradle :fenix:assembleRelease -PdisableDebugSigning

unsigned="$(ls obj-qsearch-android/gradle/build/mobile/android/fenix/app/outputs/apk/release/*arm64-v8a*unsigned*.apk | head -1)"
bt="$(ls -d "$HOME"/.mozbuild/android-sdk-linux/build-tools/* | sort -V | tail -1)"
export JAVA_HOME="$(ls -d "$HOME"/.mozbuild/jdk/jdk-* | head -1)"
export PATH="$JAVA_HOME/bin:$PATH"

rm -f "$out" "$out.aligned"
"$bt/zipalign" -p 4 "$unsigned" "$out.aligned"
"$bt/apksigner" sign --ks "$keys/qsearch-android.jks" --ks-key-alias qsearch \
  --ks-pass "file:$keys/qsearch-android.password.txt" --out "$out" "$out.aligned"
rm -f "$out.aligned" "$out.idsig"
"$bt/apksigner" verify --print-certs "$out" | head -3
sha256sum "$out"
