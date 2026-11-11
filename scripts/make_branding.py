"""Create browser/branding/qsearch inside a Firefox source tree.

Usage: python make_branding.py <firefox_source_dir>

Starts from Mozilla's "unofficial" branding directory, then replaces every
name and every logo image with the qsearch ones.
"""
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

from make_icons import BG, PRIVATE_FG, render

NAME = "qsearch"
VENDOR = "qdran"
HERE = Path(__file__).resolve().parent
LOGO_SVG = HERE.parent / "branding" / "logo.svg"

WORDMARK = """<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->
<svg xmlns="http://www.w3.org/2000/svg" fill="context-fill #0b0b0c" viewBox="0 0 372 99">
  <text x="0" y="74" font-family="Segoe UI, system-ui, sans-serif" font-size="84" font-weight="700" letter-spacing="-2">qsearch</text>
</svg>
"""


def padded(size, canvas, scale=0.6, fg=None):
    """Logo centred on a transparent canvas (for tiles)."""
    w, h = canvas
    logo = render(int(min(w, h) * scale), fg)
    img = Image.new("RGBA", canvas, (0, 0, 0, 0))
    img.paste(logo, ((w - logo.width) // 2, (h - logo.height) // 2), logo)
    return img


def main() -> None:
    src = Path(sys.argv[1]) / "browser" / "branding"
    dst = src / NAME
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src / "unofficial", dst)

    # --- application icons -------------------------------------------------
    for s in (16, 22, 24, 32, 48, 64, 128, 256):
        render(s).save(dst / f"default{s}.png")
    render(256).save(dst / "firefox.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    render(64).save(dst / "firefox64.ico", sizes=[(s, s) for s in (16, 32, 48, 64)])
    render(256, PRIVATE_FG).save(dst / "pbmode.ico", sizes=[(s, s) for s in (16, 32, 48, 256)])
    # Incognito (private browsing) art is the same logo in purple.
    for name, size, fg in (
        ("VisualElements_150.png", 300, None),
        ("VisualElements_70.png", 142, None),
        ("PrivateBrowsing_150.png", 300, PRIVATE_FG),
        ("PrivateBrowsing_70.png", 142, PRIVATE_FG),
    ):
        padded(size, (size, size), fg=fg).save(dst / name)

    # --- about: pages ------------------------------------------------------
    content = dst / "content"
    for name, size, fg in (
        ("about-logo.png", 192, None),
        ("about-logo@2x.png", 384, None),
        ("about-logo-private.png", 192, PRIVATE_FG),
        ("about-logo-private@2x.png", 384, PRIVATE_FG),
    ):
        render(size, fg).save(content / name)
    about = Image.new("RGBA", (300, 236), (0, 0, 0, 0))
    logo = render(200)
    about.paste(logo, (50, 18), logo)
    about.save(content / "about.png")
    shutil.copyfile(LOGO_SVG, content / "about-logo.svg")
    (content / "about-wordmark.svg").write_text(WORDMARK, encoding="utf-8")
    (content / "firefox-wordmark.svg").write_text(WORDMARK, encoding="utf-8")

    # --- MSIX tiles (unused by the zip/installer build, kept consistent) ---
    for png in (dst / "msix" / "Assets").glob("*.png"):
        if png.name.startswith("Document"):
            continue
        with Image.open(png) as old:
            size = old.size
        padded(min(size), size, scale=0.7).save(png)

    # --- installer art -----------------------------------------------------
    for name, size in (("wizHeader.bmp", (150, 57)), ("wizHeaderRTL.bmp", (150, 57)), ("wizWatermark.bmp", (164, 314))):
        bmp = Image.new("RGB", size, BG[:3])
        logo = render(int(min(size) * 0.7))
        bmp.paste(logo, ((size[0] - logo.width) // 2, (size[1] - logo.height) // 2), logo)
        bmp.save(dst / name)

    # --- names -------------------------------------------------------------
    def sub(path, pairs):
        p = dst / path
        text = p.read_text(encoding="utf-8")
        for pattern, repl in pairs:
            text = re.sub(pattern, repl, text, flags=re.M)
        p.write_text(text, encoding="utf-8", newline="\n")

    sub("configure.sh", [
        (r"^MOZ_APP_DISPLAYNAME=.*$", f"MOZ_APP_DISPLAYNAME={NAME}"),
        (r"^MOZ_MACBUNDLE_ID=.*$", f"MOZ_MACBUNDLE_ID={NAME}"),
    ])
    sub("locales/en-US/brand.ftl", [
        (r"^(-brand-(?:shorter|short|shortcut|full|product)-name) = .*$", rf"\1 = {NAME}"),
        (r"^-vendor-short-name = .*$", f"-vendor-short-name = {VENDOR}"),
    ])
    sub("locales/en-US/brand.properties", [
        (r"^(brand\w+Name)=.*$", rf"\1={NAME}"),
    ])
    # Installer: own company name (also the registry key), own links.
    sub("branding.nsi", [
        (r"Nightly", NAME),
        (r"Mozilla Developer Preview", NAME),
        (r'^(!define CompanyName\s+)".*"$', rf'\1"{VENDOR}"'),
        (r'^(!define URLInfoAbout\s+)".*"$', r'\1"https://github.com/Adrian1337afk/qsearch"'),
        (r'^(!define HelpLink\s+)".*"$', r'\1"https://github.com/Adrian1337afk/qsearch"'),
    ])
    sub("pref/firefox-branding.js", [(r"https://nightly\.mozilla\.org", "https://qdran.de")])
    print("branding written to", dst)


if __name__ == "__main__":
    main()
