"""Render the qsearch logo (same shapes as branding/logo.svg) to PNG and ICO.

Usage: python make_icons.py <output_dir>

Pillow has no SVG support, so the three shapes of the logo are drawn
directly, supersampled 8x and downscaled for clean edges.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG = (0x0B, 0x0B, 0x0C, 255)
FG = (0xC8, 0xFF, 0x3D, 255)
# Incognito (private browsing) uses the same logo in purple.
PRIVATE_FG = (0xA7, 0x8B, 0xFA, 255)
SS = 8  # supersampling factor


def render(size: int, fg=None) -> Image.Image:
    fg = fg or FG
    px = size * SS
    k = px / 32  # logo is designed on a 32x32 grid
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=7 * k, fill=BG)
    w = 3 * k
    # ring: centre (15,15), radius 7.5, stroke 3 -> outer 9, inner 6
    d.ellipse([(15 - 9) * k, (15 - 9) * k, (15 + 9) * k, (15 + 9) * k], fill=fg)
    d.ellipse([(15 - 6) * k, (15 - 6) * k, (15 + 6) * k, (15 + 6) * k], fill=BG)
    # tail: (19.5,19.5) -> (25,25), round caps
    d.line([19.5 * k, 19.5 * k, 25 * k, 25 * k], fill=fg, width=round(w))
    for cx, cy in ((19.5, 19.5), (25, 25)):
        d.ellipse(
            [cx * k - w / 2, cy * k - w / 2, cx * k + w / 2, cy * k + w / 2], fill=fg
        )
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for s in (16, 22, 24, 32, 48, 64, 128, 256):
        render(s).save(out / f"default{s}.png")
    render(512).save(out / "logo512.png")
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    render(256).save(out / "firefox.ico", sizes=ico_sizes)
    render(256).save(out / "firefox64.ico", sizes=ico_sizes)
    print("icons written to", out)


if __name__ == "__main__":
    main()
