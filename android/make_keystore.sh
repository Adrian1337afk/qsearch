#!/usr/bin/env bash
# Create the release keystore once. Keep it OUTSIDE the repository and back it
# up: without it, updates can no longer be installed over the old app.
#
# Usage: make_keystore.sh /path/to/keydir
# Writes qsearch-android.jks and qsearch-android.password.txt (random password).
set -euo pipefail
dir="${1:?usage: make_keystore.sh /path/to/keydir}"
keytool="$(ls -d "$HOME"/.mozbuild/jdk/jdk-*/bin/keytool | head -1)"
mkdir -p "$dir"
if [ -f "$dir/qsearch-android.jks" ]; then
  echo "keystore already exists: $dir/qsearch-android.jks"
  exit 0
fi
umask 077
head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$dir/qsearch-android.password.txt"
"$keytool" -genkeypair -keystore "$dir/qsearch-android.jks" -storetype PKCS12 \
  -alias qsearch -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=qsearch, O=qdran" -storepass:file "$dir/qsearch-android.password.txt"
"$keytool" -list -keystore "$dir/qsearch-android.jks" \
  -storepass:file "$dir/qsearch-android.password.txt" | grep -i fingerprint
