#!/usr/bin/env bash
# Wrap a packaged qsearch tarball (./mach package) into an AppImage.
#
#   scripts/make_appimage.sh <qsearch-*.linux-x86_64.tar.xz> [output-dir]
#
# Needs: tar, xz, rsvg-convert (librsvg2-bin), curl, desktop-file-utils.
# appimagetool is downloaded into the output dir if it is not on PATH.
set -euo pipefail

TARBALL=$(readlink -f "${1:?usage: make_appimage.sh <tarball> [output-dir]}")
OUT=$(readlink -f "${2:-$PWD}")
REPO=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
NAME=$(basename "$TARBALL")
NAME=${NAME%.tar.*}.AppImage

mkdir -p "$OUT"
APPDIR=$OUT/qsearch.AppDir
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/lib" "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps"

# The tarball holds one top-level folder: qsearch/
tar -xf "$TARBALL" -C "$APPDIR/usr/lib"
test -x "$APPDIR/usr/lib/qsearch/qsearch"

cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE=$(dirname "$(readlink -f "$0")")
exec "$HERE/usr/lib/qsearch/qsearch" "$@"
EOF
chmod +x "$APPDIR/AppRun"

cat > "$APPDIR/qsearch.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=qsearch
GenericName=Web Browser
Comment=Private web browser
Exec=qsearch %u
Icon=qsearch
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
StartupWMClass=qsearch
Actions=new-window;new-private-window;

[Desktop Action new-window]
Name=New Window
Exec=qsearch --new-window %u

[Desktop Action new-private-window]
Name=New Private Window
Exec=qsearch --private-window %u
EOF
cp "$APPDIR/qsearch.desktop" "$APPDIR/usr/share/applications/"

rsvg-convert -w 256 -h 256 "$REPO/branding/logo.svg" -o "$APPDIR/qsearch.png"
cp "$APPDIR/qsearch.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/qsearch.png"
ln -sf qsearch.png "$APPDIR/.DirIcon"

TOOL=$(command -v appimagetool || true)
if [ -z "$TOOL" ]; then
  TOOL=$OUT/appimagetool-x86_64.AppImage
  if [ ! -x "$TOOL" ]; then
    curl -fL -o "$TOOL" \
      https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x "$TOOL"
  fi
fi

# --appimage-extract-and-run: works without FUSE (containers, WSL)
ARCH=x86_64 "$TOOL" --appimage-extract-and-run "$APPDIR" "$OUT/$NAME"
rm -rf "$APPDIR"
( cd "$OUT" && sha256sum "$NAME" )
