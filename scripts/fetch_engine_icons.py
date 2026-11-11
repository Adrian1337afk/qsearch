"""Give every search engine in config/policies.json an icon.

Usage: python fetch_engine_icons.py

Each engine's favicon is downloaded once, here, at development time. It is
stored as a 32x32 PNG in config/engine-icons/ and written into policies.json
as a data: URI. The browser therefore shows the icons without contacting any
of those sites at startup.

Run it again after adding an engine to policies.json. Icons that are already
in config/engine-icons/ are not downloaded again.
"""
import base64
import io
import json
import re
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
POLICIES = ROOT / "config" / "policies.json"
ICON_DIR = ROOT / "config" / "engine-icons"
# DuckDuckGo's favicon service: one predictable URL per host.
ICON_SERVICE = "https://icons.duckduckgo.com/ip3/{host}.ico"
SIZE = 32


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def on_light_plate_if_dark(image: Image.Image) -> Image.Image:
    """A black logo on transparency disappears in a dark menu: back it white."""
    visible = [p for p in image.getdata() if p[3] > 128]
    if not visible:
        return image
    brightness = sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b, _ in visible) / len(visible)
    coverage = len(visible) / (SIZE * SIZE)
    if brightness > 70 or coverage > 0.9:
        return image
    plate = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=7, fill="white")
    inner = image.resize((SIZE - 6, SIZE - 6), Image.LANCZOS)
    plate.paste(inner, (3, 3), inner)
    return plate


def fetch_png(host: str) -> bytes:
    try:
        raw = download(ICON_SERVICE.format(host=host))
    except Exception:
        # The service does not know every host: ask the site itself.
        raw = download(f"https://{host}/favicon.ico")
    image = Image.open(io.BytesIO(raw))
    # .ico files hold several sizes; take the largest one.
    if getattr(image, "ico", None):
        image = image.ico.getimage(max(image.ico.sizes()))
    image = image.convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    image = on_light_plate_if_dark(image)
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    policies = json.loads(POLICIES.read_text(encoding="utf-8"))
    for engine in policies["policies"]["SearchEngines"]["Add"]:
        host = urlparse(engine["URLTemplate"]).hostname
        slug = re.sub(r"[^a-z0-9]+", "-", engine["Name"].lower()).strip("-")
        path = ICON_DIR / f"{slug}.png"
        if not path.exists():
            try:
                path.write_bytes(fetch_png(host))
                print("fetched", engine["Name"], f"({host})")
            except Exception as error:  # one bad icon must not stop the rest
                print("FAILED ", engine["Name"], f"({host}):", error)
                continue
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        engine["IconURL"] = f"data:image/png;base64,{data}"
    POLICIES.write_text(json.dumps(policies, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("policies.json updated")


if __name__ == "__main__":
    main()
