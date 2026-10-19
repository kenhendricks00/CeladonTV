"""Generates every CeladonTV icon and banner from one emblem definition.

Usage: python branding/generate.py [path-to-chromium-or-edge]

Writes the adaptive launcher icon (VectorDrawables), the Android TV banner PNGs, and
the README logo/banner. PNGs are rendered with a headless Chromium-based browser.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "app" / "src" / "main" / "res"
ASSETS = ROOT / "assets"
DEFAULT_BROWSER = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

PLUM = "#2E1A47"
SCREEN = "#F6F1FF"
CELADON = "#ACE1AF"
LAVENDER = "#C4A9F5"
GRADIENT_TOP = "#A970FF"
GRADIENT_BOTTOM = "#E6D9FF"
WORDMARK_FONT = "Bahnschrift, 'Segoe UI', sans-serif"


def rounded_rect(x, y, w, h, r):
    return (f"M{x + r},{y}h{w - 2 * r}a{r},{r} 0 0 1 {r},{r}v{h - 2 * r}a{r},{r} 0 0 1 {-r},{r}"
            f"h{-(w - 2 * r)}a{r},{r} 0 0 1 {-r},{-r}v{-(h - 2 * r)}a{r},{r} 0 0 1 {r},{-r}z")


# Emblem in the 108x108 adaptive-icon viewport, kept inside the 66dp safe circle.
SCREEN_PATH = rounded_rect(26, 34, 56, 42, 10)
TRIANGLE = "M44,43L66,55L44,67z"
SLOPE = 12 / 22
EDGE_Y = round(55 + (82 - 66) * SLOPE, 2)
EMBLEM = [
    dict(d=SCREEN_PATH, fill=SCREEN),
    dict(d=f"M44,26L44,43L90,{EDGE_Y + 8 * SLOPE:.2f}L90,26z", fill=CELADON, clip=SCREEN_PATH),
    dict(d=TRIANGLE, fill=LAVENDER),
    dict(d=f"M44,34V76M66,55L82,{EDGE_Y}", stroke=PLUM),
    dict(d=TRIANGLE, stroke=PLUM),
    dict(d=SCREEN_PATH, stroke=PLUM),
    dict(d="M49,34L44,26M59,34L64,26", stroke=PLUM),
]
STROKE_WIDTH = 4.5


def svg_shapes(shapes, mono=False):
    out = []
    for i, s in enumerate(shapes):
        color = lambda c: "#000" if mono else c
        if s.get("clip"):
            out.append(f'<clipPath id="c{i}"><path d="{s["clip"]}"/></clipPath>')
        attrs = f' clip-path="url(#c{i})"' if s.get("clip") else ""
        if "fill" in s:
            if mono and s["fill"] != LAVENDER:
                continue
            out.append(f'<path d="{s["d"]}" fill="{color(s["fill"])}"{attrs}/>')
        else:
            out.append(f'<path d="{s["d"]}" fill="none" stroke="{color(s["stroke"])}" stroke-width="{STROKE_WIDTH}" '
                       f'stroke-linecap="round" stroke-linejoin="round"/>')
    return "".join(out)


def vector_drawable(shapes, mono=False):
    body = []
    for s in shapes:
        if "fill" in s:
            if mono and s["fill"] != LAVENDER:
                continue
            path = f'<path android:fillColor="{"#FF000000" if mono else s["fill"]}" android:pathData="{s["d"]}" />'
            if s.get("clip"):
                path = f'<group>\n        <clip-path android:pathData="{s["clip"]}" />\n        {path}\n    </group>'
            body.append(path)
        else:
            body.append(
                f'<path android:pathData="{s["d"]}" android:strokeColor="{"#FF000000" if mono else s["stroke"]}" '
                f'android:strokeWidth="{STROKE_WIDTH}" android:strokeLineCap="round" android:strokeLineJoin="round" />')
    return vector_xml("\n    ".join(body))


def vector_xml(body, extra_ns=""):
    return (f'<?xml version="1.0" encoding="utf-8"?>\n'
            f'<vector xmlns:android="http://schemas.android.com/apk/res/android"{extra_ns}\n'
            f'    android:width="108dp"\n    android:height="108dp"\n'
            f'    android:viewportWidth="108"\n    android:viewportHeight="108">\n    {body}\n</vector>\n')


def background_drawable():
    return vector_xml(
        '<path android:pathData="M0,0h108v108h-108z">\n'
        '        <aapt:attr name="android:fillColor">\n'
        f'            <gradient android:type="linear" android:startX="54" android:startY="0" android:endX="54" android:endY="108"\n'
        f'                android:startColor="{GRADIENT_TOP}" android:endColor="{GRADIENT_BOTTOM}" />\n'
        '        </aapt:attr>\n    </path>',
        extra_ns='\n    xmlns:aapt="http://schemas.android.com/aapt"')


def gradient_def(height):
    return (f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="{height}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{GRADIENT_TOP}"/><stop offset="1" stop-color="{GRADIENT_BOTTOM}"/></linearGradient>')


def icon_svg(size=512):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 108 108">'
            f'<defs>{gradient_def(108)}</defs>'
            f'<path d="{rounded_rect(0, 0, 108, 108, 24)}" fill="url(#bg)"/>'
            f'{svg_shapes(EMBLEM)}</svg>')


def banner_svg(width, height, layout):
    """layout coordinates are in a 320-unit-wide frame; height decides the aspect."""
    frame_h = 320 * height / width
    e = layout
    corner = f'<path d="{rounded_rect(0, 0, 320, frame_h, e["corner"])}" fill="url(#bg)"/>' if e["corner"] else \
        f'<rect width="320" height="{frame_h}" fill="url(#bg)"/>'
    pill_w, pill_h = e["pill"][2], e["pill"][3]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 320 {frame_h}">'
            f'<defs>{gradient_def(frame_h)}</defs>{corner}'
            f'<g transform="translate({e["emblem"][0]},{e["emblem"][1]}) scale({e["emblem"][2]})">{svg_shapes(EMBLEM)}</g>'
            f'<text x="{e["text"][0]}" y="{e["text"][1]}" font-family="{WORDMARK_FONT}" font-weight="700" '
            f'font-size="{e["text"][2]}" fill="{PLUM}">CeladonTV</text>'
            f'<rect x="{e["pill"][0]}" y="{e["pill"][1]}" width="{pill_w}" height="{pill_h}" rx="{pill_h / 2}" fill="{CELADON}"/>'
            f'<text x="{e["pill"][0] + pill_w / 2}" y="{e["pill"][1] + pill_h * 0.72}" text-anchor="middle" '
            f'font-family="{WORDMARK_FONT}" font-weight="600" font-size="{pill_h * 0.68}" fill="{PLUM}">android tv</text>'
            f'</svg>')


TV_LAYOUT = dict(corner=0, emblem=(-6, 22, 1.3), text=(124, 93, 37), pill=(152, 106, 112, 26))
README_LAYOUT = dict(corner=40, emblem=(-2, -6, 1.32), text=(126, 64, 37), pill=(156, 76, 108, 25))
TV_DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def render_png(browser, svg, out, width, height):
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "image.svg"
        src.write_text(svg, encoding="utf-8")
        page = Path(tmp) / "page.html"
        page.write_text(f'<html><body style="margin:0;background:transparent"><img src="image.svg" '
                        f'width="{width}" height="{height}" style="display:block"></body></html>', encoding="utf-8")
        subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--default-background-color=00000000", f"--window-size={width},{height}",
                        f"--user-data-dir={Path(tmp) / 'profile'}", f"--screenshot={out}", page.as_uri()],
                       check=True, capture_output=True)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def main():
    browser = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BROWSER", DEFAULT_BROWSER)

    write(RES / "drawable" / "ic_launcher_background.xml", background_drawable())
    write(RES / "drawable" / "ic_launcher_foreground.xml", vector_drawable(EMBLEM))
    write(RES / "drawable" / "ic_launcher_monochrome.xml", vector_drawable(EMBLEM, mono=True))
    write(RES / "mipmap-anydpi-v26" / "ic_launcher.xml",
          '<?xml version="1.0" encoding="utf-8"?>\n'
          '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
          '    <background android:drawable="@drawable/ic_launcher_background" />\n'
          '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
          '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n'
          '</adaptive-icon>\n')
    write(RES / "mipmap" / "ic_launcher.xml",
          '<?xml version="1.0" encoding="utf-8"?>\n'
          '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n'
          '    <item android:drawable="@drawable/ic_launcher_background" />\n'
          '    <item android:drawable="@drawable/ic_launcher_foreground" />\n'
          '</layer-list>\n')

    for density, scale in TV_DENSITIES.items():
        w, h = int(320 * scale), int(180 * scale)
        out = RES / f"drawable-{density}" / "banner.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        render_png(browser, banner_svg(w, h, TV_LAYOUT), out, w, h)

    write(ASSETS / "icon.svg", icon_svg())
    render_png(browser, icon_svg(512), ASSETS / "logo.png", 512, 512)
    render_png(browser, banner_svg(1920, 726, README_LAYOUT), ASSETS / "banner.png", 1920, 726)


if __name__ == "__main__":
    main()
