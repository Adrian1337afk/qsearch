#!/usr/bin/env python3
"""Replace the Firefox artwork in the Fenix tree with the qsearch logo.

Called by apply_android.py. Needs `rsvg-convert` (librsvg2-bin), ImageMagick
(`identify`, `convert` with WebP support) and the DejaVu Sans Bold font.

The logo is `branding/logo.svg`: a lime (#c8ff3d) Q on #0b0b0c. Private mode
uses purple (#a78bfa).
"""
import re
import subprocess
import tempfile
from pathlib import Path

DARK = "#0b0b0c"
LIME = "#c8ff3d"
PURPLE = "#a78bfa"
RES = "mobile/android/fenix/app/src/%s/res"
SOURCE_SETS = ("main", "release")

LICENSE = """<?xml version="1.0" encoding="utf-8"?>
<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->
"""

# The Q of branding/logo.svg (32x32 units) as Android vector paths.
Q_PATHS = """        <path
            android:pathData="M7.5,15a7.5,7.5 0 1,0 15,0a7.5,7.5 0 1,0 -15,0"
            android:strokeColor="{c}"
            android:strokeWidth="3" />
        <path
            android:pathData="M19.5,19.5L25,25"
            android:strokeColor="{c}"
            android:strokeLineCap="round"
            android:strokeWidth="3" />
"""
BOX_PATH = """        <path
            android:fillColor="{c}"
            android:pathData="M7,0h18a7,7 0 0 1 7,7v18a7,7 0 0 1 -7,7h-18a7,7 0 0 1 -7,-7v-18a7,7 0 0 1 7,-7z" />
"""


def adaptive_foreground(color):
    """108dp adaptive-icon layer; the Q sits inside the 66dp safe zone."""
    return (LICENSE + """<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="1.7"
        android:scaleY="1.7"
        android:translateX="26.8"
        android:translateY="26.8">
""" + Q_PATHS.format(c=color) + """    </group>
</vector>
""")


def boxed_logo(color, dp=24):
    """The whole logo (dark rounded square + Q) for use inside the app."""
    return (LICENSE + f"""<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="{dp}dp"
    android:height="{dp}dp"
    android:viewportWidth="32"
    android:viewportHeight="32">
    <group>
""" + BOX_PATH.format(c=DARK) + Q_PATHS.format(c=color) + """    </group>
</vector>
""")


def sized_logo(old_xml, mono=False):
    """A vector with the size of the one it replaces, showing the logo centred.
    `mono`: only the Q in white, for icons the system tints."""
    w = float(re.search(r'android:width="([\d.]+)dp"', old_xml).group(1))
    h = float(re.search(r'android:height="([\d.]+)dp"', old_xml).group(1))
    s = min(w, h)
    if mono == "layer":
        # Like the launcher foreground: the lime Q alone, at about half the size.
        s *= 0.55
        body = Q_PATHS.format(c=LIME)
    else:
        body = Q_PATHS.format(c="#ffffff") if mono else BOX_PATH.format(c=DARK) + Q_PATHS.format(c=LIME)
    return (LICENSE + f"""<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="{w:g}dp"
    android:height="{h:g}dp"
    android:viewportWidth="{w:g}"
    android:viewportHeight="{h:g}">
    <group
        android:scaleX="{s / 32:g}"
        android:scaleY="{s / 32:g}"
        android:translateX="{(w - s) / 2:g}"
        android:translateY="{(h - s) / 2:g}">
""" + body + """    </group>
</vector>
""")


# Fox and "Kit" mascot artwork: illustrations get the logo, tinted icons the bare Q.
FOX_ILLUSTRATIONS = ("fox_*.xml", "ic_kit_*.xml", "kit_*.xml", "illustration_fox_*.xml",
                     "firefox_as_default_banner_illustration.xml")
FOX_ICONS = ("ic_status_logo.xml", "mozac_ic_kit_*.xml")
AC_RES = "mobile/android/android-components/components"
AC_FOX = ((AC_RES + "/lib/llm-mlpa/src/main/res/drawable/firefox_icon.xml", False),
          (AC_RES + "/ui/icons/src/main/res/drawable/mozac_ic_logo_firefox_24.xml", True))
Q_MARK = "M19.5,19.5L25,25"


def solid(color):
    return (LICENSE + f"""<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="{color}" />
</shape>
""")


def logo_svg(w, h, color, round_=False):
    s = min(w, h)
    rx = 16 if round_ else 7
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">'
            f'<g transform="translate({(w - s) / 2},{(h - s) / 2}) scale({s / 32})">'
            f'<rect width="32" height="32" rx="{rx}" fill="{DARK}"/>'
            f'<circle cx="15" cy="15" r="7.5" fill="none" stroke="{color}" stroke-width="3"/>'
            f'<path d="M19.5 19.5 25 25" stroke="{color}" stroke-width="3" stroke-linecap="round"/>'
            f'</g></svg>')


TEXT_W = 4.4  # width of "qsearch" in DejaVu Sans Bold, in font sizes


def text_svg(w, h, fill):
    f = min(0.8 * h, w / TEXT_W)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">'
            f'<text x="{w / 2}" y="{h / 2 + 0.3 * f}" text-anchor="middle" font-family="DejaVu Sans" '
            f'font-weight="bold" font-size="{f}" fill="{fill}">qsearch</text></svg>')


def wordmark_svg(w, h, color, fill):
    s = 0.8 * h
    gap = 0.25 * h
    f = min(0.55 * h, (w - s - gap) / TEXT_W)
    total = s + gap + TEXT_W * f
    x0 = (w - total) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">'
            f'<g transform="translate({x0},{(h - s) / 2}) scale({s / 32})">'
            f'<rect width="32" height="32" rx="7" fill="{DARK}"/>'
            f'<circle cx="15" cy="15" r="7.5" fill="none" stroke="{color}" stroke-width="3"/>'
            f'<path d="M19.5 19.5 25 25" stroke="{color}" stroke-width="3" stroke-linecap="round"/>'
            f'</g>'
            f'<text x="{x0 + s + gap}" y="{h / 2 + 0.33 * f}" font-family="DejaVu Sans" '
            f'font-weight="bold" font-size="{f}" fill="{fill}">qsearch</text></svg>')


def size_of(path):
    out = subprocess.run(["identify", "-format", "%w %h", str(path)],
                         check=True, capture_output=True, text=True).stdout.split()
    return int(out[0]), int(out[1])


def render(svg, dest):
    """SVG text -> image file in the format of `dest`'s extension."""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.svg"
        png = Path(tmp) / "out.png"
        src.write_text(svg, encoding="utf-8")
        subprocess.run(["rsvg-convert", "-o", str(png), str(src)], check=True)
        if dest.suffix == ".png":
            dest.write_bytes(png.read_bytes())
        else:
            subprocess.run(["convert", str(png), "-define", "webp:lossless=true", str(dest)], check=True)


def bitmap_svg(name, w, h):
    """Which picture replaces the bitmap called `name` (None: leave it)."""
    if name.startswith("ic_logo_wordmark_private"):
        return wordmark_svg(w, h, PURPLE, "#ffffff")
    if name.startswith("ic_logo_wordmark_dark"):
        return wordmark_svg(w, h, LIME, "#ffffff")
    if name.startswith("ic_logo_wordmark_normal"):
        return wordmark_svg(w, h, LIME, DARK)
    if name.startswith("ic_wordmark_text_private"):
        return text_svg(w, h, "#ffffff")
    if name.startswith("ic_wordmark_text_normal"):
        return text_svg(w, h, DARK)
    if name.startswith("ic_launcher_private"):
        return logo_svg(w, h, PURPLE)
    if name.startswith("ic_launcher_round"):
        return logo_svg(w, h, LIME, round_=True)
    if name.startswith(("ic_launcher", "ic_wordmark_logo", "ic_wordmark_sport_logo", "firefox_sport")):
        return logo_svg(w, h, LIME)
    if name.startswith("fenix_search_widget"):
        return wordmark_svg(w, h, LIME, "#ffffff")
    if name.startswith(("fenix_error", "kit_")):
        return logo_svg(w, h, LIME)
    return None


def run(t, branding):
    """`t` is apply_android.Tree; `branding` holds logo.svg (kept as the reference)."""
    if not (branding / "logo.svg").is_file():
        raise SystemExit("make_android_icons: branding/logo.svg missing")

    for ss in SOURCE_SETS:
        res = t.root / (RES % ss)
        # Bitmaps: same file name and pixel size, new picture.
        for p in sorted(res.rglob("*.webp")):
            w, h = size_of(p)
            svg = bitmap_svg(p.name, w, h)
            if svg is None:
                continue
            rel = p.relative_to(t.root).as_posix()
            before = p.read_bytes()
            render(svg, p)
            if p.read_bytes() != before:
                t.changed.append(rel)

        # Vector launcher layers, including the alternative icons of the icon picker.
        draw = res / "drawable"
        for p in sorted(draw.glob("ic_launcher_foreground*.xml")):
            t.write(p.relative_to(t.root).as_posix(), adaptive_foreground(LIME))

    main = RES % "main"
    fox = [(pat, False) for pat in FOX_ILLUSTRATIONS] + [(pat, True) for pat in FOX_ICONS]
    # Previews of the alternative launcher icons (Settings > Customize > App icon).
    fox += [(f"ic_{name}.xml", "layer") for name in
            ("cool", "cuddling", "flaming", "minimal", "momo", "pixelated", "pride", "retro_2004")]
    rels = [(p.relative_to(t.root).as_posix(), mono)
            for pat, mono in fox for p in sorted((t.root / main).glob("drawable*/" + pat))]
    for rel, mono in rels + list(AC_FOX):
        text = t.read(rel)
        if Q_MARK not in text:
            t.write(rel, sized_logo(text, mono))

    t.write(main + "/drawable/ic_launcher_monochrome.xml", adaptive_foreground("#ffffff"))
    t.write(main + "/drawable/ic_launcher_private_foreground.xml", adaptive_foreground(PURPLE))
    t.write(main + "/drawable/ic_launcher_private_background.xml", solid(DARK))
    t.write(main + "/drawable/ic_firefox.xml", boxed_logo(LIME))
    t.write(main + "/drawable/expressive_firefox.xml", boxed_logo(LIME, dp=35))
    t.sub(main + "/values/colors.xml",
          r'<color name="ic_launcher_background">#[0-9A-Fa-f]+</color>',
          f'<color name="ic_launcher_background">{DARK}</color>')

    # Dark theme, normal mode: lime logo with white text (stock Fenix reuses the private wordmark).
    for dens in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        ref = t.root / main / f"drawable-{dens}" / "ic_logo_wordmark_normal.webp"
        w, h = size_of(ref)
        dest = ref.with_name("ic_logo_wordmark_dark.webp")
        before = dest.read_bytes() if dest.exists() else b""
        render(wordmark_svg(w, h, LIME, "#ffffff"), dest)
        if dest.read_bytes() != before:
            t.changed.append(dest.relative_to(t.root).as_posix())
    t.replace(main + "/drawable-night/ic_logo_wordmark_normal.xml",
              "@drawable/ic_logo_wordmark_private", "@drawable/ic_logo_wordmark_dark")
