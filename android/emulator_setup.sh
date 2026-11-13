#!/usr/bin/env bash
# Create an x86_64 Android 14 emulator that can run arm64 apps (ARM translation).
# Needs /dev/kvm (user in group kvm).
set -euo pipefail
sdk="$HOME/.mozbuild/android-sdk-linux"
export JAVA_HOME="$(ls -d "$HOME"/.mozbuild/jdk/jdk-* | head -1)"
export ANDROID_SDK_ROOT="$sdk" ANDROID_HOME="$sdk"
export ANDROID_AVD_HOME="$HOME/.android/avd"
tools="$(ls -d "$sdk"/cmdline-tools/*/bin | head -1)"
img="system-images;android-34;google_apis;x86_64"
(set +o pipefail; yes | "$tools/sdkmanager" --sdk_root="$sdk" "$img" > /dev/null)
mkdir -p "$ANDROID_AVD_HOME"
if ! "$tools/avdmanager" list avd | grep -q "Name: qsearch"; then
  echo no | "$tools/avdmanager" create avd -n qsearch -k "$img" -d pixel_6
fi
echo "AVD ready: qsearch"
