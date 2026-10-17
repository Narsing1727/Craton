"""Retint vendored components onto Beacon's theme tokens.

Tailwind palette classes (bg-emerald-500/20) and arbitrary hex classes (dark:bg-[#171717]) are
rewritten to Beacon's semantic tokens, whose values come from our palette (globals.css):
  success = chart-1, info = chart-2, warning = chart-3, destructive, plus the neutral surface,
  border and text tokens. Opacity suffixes and variant prefixes (dark:, hover:) are kept.
Pass the vendored files to retint as arguments; never run it on our own components.
"""
import colorsys
import re
import sys

import os
FE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..") + "/"
SKIP = ("gemini.tsx",)  # a third-party brand logo: its colours are the logo

HUE = {
    "red": "destructive", "rose": "destructive",
    "orange": "warning", "amber": "warning", "yellow": "warning",
    "lime": "success", "green": "success", "emerald": "success", "teal": "success",
    "cyan": "info", "sky": "info", "blue": "info", "indigo": "info",
    "violet": "info", "purple": "info", "fuchsia": "info", "pink": "info",
}
PROPS = "text|bg|border|ring|fill|stroke|from|to|via|shadow|outline|decoration|divide|placeholder|caret|accent|ring-offset"
palette = re.compile(r"\b(" + PROPS + r")-(" + "|".join(HUE) + r")-(\d{2,3})(/\d{1,3})?\b")
arbitrary = re.compile(r"\b(" + PROPS + r")-\[#([0-9a-fA-F]{3,8})\](/\d{1,3})?")


def semantic_for_hex(prop: str, hx: str) -> str:
    if len(hx) in (3, 4):
        hx = "".join(c * 2 for c in hx[:3])
    r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if s > 0.35 and 0.2 < l < 0.9:  # a real colour: map its hue
        deg = h * 360
        name = "destructive" if deg < 20 or deg >= 340 else "warning" if deg < 70 else "success" if deg < 170 else "info"
        return name
    # Neutral: pick by role and lightness.
    if prop in ("text", "fill", "stroke", "placeholder", "caret", "decoration"):
        return "foreground" if l > 0.72 else "muted-foreground"
    if prop in ("border", "divide", "ring", "outline", "ring-offset"):
        return "border"
    # Surfaces.
    if l > 0.9:
        return "background"
    if l < 0.11:
        return "card"
    return "muted"


def retint(src: str) -> tuple[str, int]:
    n = 0

    def pal(m):
        nonlocal n
        n += 1
        return f"{m.group(1)}-{HUE[m.group(2)]}{m.group(4) or ''}"

    def arb(m):
        nonlocal n
        n += 1
        return f"{m.group(1)}-{semantic_for_hex(m.group(1), m.group(2))}{m.group(3) or ''}"

    src = palette.sub(pal, src)
    src = arbitrary.sub(arb, src)
    return src, n


total = 0
for rel in sys.argv[1:]:
    if rel.endswith(SKIP):
        continue
    path = FE + rel.replace("\\", "/")
    text = open(path, encoding="utf8").read()
    new, n = retint(text)
    if n:
        open(path, "w", encoding="utf8").write(new)
        total += n
        print(f"{n:4d}  {rel}")
print("total", total)
sys.exit(0)
