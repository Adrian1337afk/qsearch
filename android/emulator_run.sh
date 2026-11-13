#!/usr/bin/env bash
# Start the "qsearch" emulator without a window and install the APK.
# Usage: emulator_run.sh /path/to/qsearch.apk   (stays in the foreground; Ctrl+C stops it)
set -euo pipefail
apk="${1:?apk}"
sdk="$HOME/.mozbuild/android-sdk-linux"
export ANDROID_SDK_ROOT="$sdk" ANDROID_HOME="$sdk" ANDROID_AVD_HOME="$HOME/.android/avd"
adb="$sdk/platform-tools/adb"
"$sdk/emulator/emulator" -avd qsearch -no-window -no-audio -no-snapshot -no-boot-anim \
  -gpu swiftshader_indirect -memory 4096 -cores 4 > "$HOME/emulator.log" 2>&1 &
emu=$!
trap 'kill $emu 2>/dev/null || true' EXIT
"$adb" wait-for-device
until [ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
echo "BOOTED abis=$("$adb" shell getprop ro.product.cpu.abilist | tr -d '\r')"
"$adb" install -r "$apk"
echo "INSTALLED"
wait $emu
