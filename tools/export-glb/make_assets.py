"""Generate the viewer's OWN textures (BLOCK-VIEWER §3.3, §4): no Keen pixels.

- assets/web-glyphs.png: a 1024² alpha-mask atlas of the stencil glyph set (0-9, A-Z, '-', '/') rendered from
  Barlow Condensed Bold (SIL OFL, fonts/OFL.txt), white on transparent; assets/web-glyphs.json: char -> tight box (px).
- assets/web-perf.png: a 64² alpha-mask tile with one round hole, for perforated steel (door leaves).
- assets/web-decals.png (+ .json): OUR hazard/warning decal atlas, drawn here from primitives and the OFL font:
  ISO-style warning triangles (our own pictograms), diagonal stripe bands, re-typeset warning placards in Barlow
  Condensed, simple icons and a barcode. It replaces the Keen sticker atlases on exported blocks (BLOCK-VIEWER §3.3).
- assets/allowed-images.json: SHA-256 of every image a GLB may embed (the validator checks it).

Run with the system Python (needs Pillow): python3 -I tools/export-glb/make_assets.py
"""
import hashlib
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "assets")
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-/"
SIZE, CELL, PT = 1024, 128, 104


def glyphs():
    font = ImageFont.truetype(os.path.join(HERE, "fonts", "BarlowCondensed-Bold.ttf"), PT)
    img = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    boxes = {}
    per_row = SIZE // CELL
    for i, ch in enumerate(CHARS):
        cx, cy = (i % per_row) * CELL, (i // per_row) * CELL
        l, t, r, b = d.textbbox((0, 0), ch, font=font)
        x = cx + (CELL - (r - l)) // 2 - l
        y = cy + (CELL - (b - t)) // 2 - t
        d.text((x, y), ch, font=font, fill=(255, 255, 255, 255))
        bl, bt, br, bb = d.textbbox((x, y), ch, font=font)
        boxes[ch] = [bl, bt, br, bb]
    path = os.path.join(OUT, "web-glyphs.png")
    img.save(path, optimize=True)
    with open(os.path.join(OUT, "web-glyphs.json"), "w") as f:
        json.dump({"size": SIZE, "boxes": boxes}, f, indent=1)
    return path


# ------------------------------------------------------------------------------------------------ decal atlas
YELLOW, BLACK, WHITE, RED, ORANGE, BLUE = (232, 185, 49, 255), (17, 17, 17, 255), (236, 238, 240, 255), (196, 40, 32, 255), (236, 120, 28, 255), (40, 96, 190, 255)
DS = 2   # draw at 2x, downsample (anti-aliasing)


def font(px, bold=True):
    return ImageFont.truetype(os.path.join(HERE, "fonts", "BarlowCondensed-Bold.ttf"), int(px))


def fit_text(d, box, text, fill, max_px, min_px=8, spacing=0.0):
    """Largest font size (≤ max_px) at which `text` (may contain newlines) fits box; centred."""
    x0, y0, x1, y1 = box
    px = max_px
    while px > min_px:
        f = font(px)
        l, t, r, b = d.multiline_textbbox((0, 0), text, font=f, align="center", spacing=px * 0.12)
        if r - l <= (x1 - x0) and b - t <= (y1 - y0):
            break
        px -= 1
    f = font(px)
    l, t, r, b = d.multiline_textbbox((0, 0), text, font=f, align="center", spacing=px * 0.12)
    d.multiline_text((x0 + (x1 - x0 - (r - l)) / 2 - l, y0 + (y1 - y0 - (b - t)) / 2 - t), text, font=f, fill=fill, align="center", spacing=px * 0.12)


def placard(d, box, header, body, colour, header_fill=BLACK, body_fill=BLACK, header_frac=0.42):
    """A warning sign: coloured header with a stencil word, white body with the instruction."""
    x0, y0, x1, y1 = box
    r = (y1 - y0) * 0.06
    d.rounded_rectangle(box, radius=r, fill=WHITE, outline=BLACK, width=max(2, int((y1 - y0) * 0.03)))
    hy = y0 + (y1 - y0) * header_frac
    d.rounded_rectangle((x0 + 3 * DS, y0 + 3 * DS, x1 - 3 * DS, hy), radius=r * 0.7, fill=colour)
    pad = (y1 - y0) * 0.06
    fit_text(d, (x0 + pad, y0 + pad, x1 - pad, hy - pad * 0.6), header, header_fill, (hy - y0) * 0.8)
    fit_text(d, (x0 + pad, hy + pad * 0.6, x1 - pad, y1 - pad), body, body_fill, (y1 - hy) * 0.55)


def triangle(d, cx, base_y, base_w, fill=YELLOW):
    """Point-up ISO-style warning triangle (rounded look via a thick black border). Returns (bl, br, apex)."""
    h = base_w * 0.866
    bl, br, ap = (cx - base_w / 2, base_y), (cx + base_w / 2, base_y), (cx, base_y - h)
    d.polygon([bl, br, ap], fill=BLACK)
    k = 0.13   # border thickness as a fraction of the base
    inner = [(bl[0] + base_w * k * 0.87, bl[1] - base_w * k * 0.5), (br[0] - base_w * k * 0.87, br[1] - base_w * k * 0.5), (ap[0], ap[1] + base_w * k)]
    d.polygon(inner, fill=fill)
    return bl, br, ap, h


def bolt_icon(d, cx, cy, s, fill=BLACK):
    pts = [(0.10, -0.50), (-0.22, 0.06), (0.02, 0.06), (-0.10, 0.50), (0.24, -0.08), (0.0, -0.08), (0.12, -0.50)]
    d.polygon([(cx + x * s, cy + y * s) for x, y in pts], fill=fill)


def heat_icon(d, cx, cy, s, fill=BLACK):
    w = max(2, int(s * 0.09))
    for i in (-1, 0, 1):
        x = cx + i * s * 0.26
        pts = [(x + 0.07 * s * math.sin(t / 3.0), cy - 0.36 * s + t * s * 0.06) for t in range(0, 12)]
        d.line(pts, fill=fill, width=w, joint="curve")
    d.rectangle((cx - 0.42 * s, cy + 0.34 * s, cx + 0.42 * s, cy + 0.42 * s), fill=fill)


def bang_icon(d, cx, cy, s, fill=BLACK):
    d.rounded_rectangle((cx - 0.08 * s, cy - 0.42 * s, cx + 0.08 * s, cy + 0.14 * s), radius=0.05 * s, fill=fill)
    d.ellipse((cx - 0.09 * s, cy + 0.24 * s, cx + 0.09 * s, cy + 0.42 * s), fill=fill)


def decals():
    S = SIZE * DS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cells, tris, bands, keen_rows = {}, {}, {}, {}

    # stripe bands: 5 rows of 64 px (at 1x), 45-degree stripes with a 64 px period (tiles seamlessly in U)
    rows = {"white": WHITE, "blue": BLUE, "black": BLACK, "yellow": YELLOW, "red": RED}
    keen = {"white": (0, 32), "blue": (32, 64), "black": (64, 96), "yellow": (96, 128), "red": (128, 160)}
    band_h = 64
    for i, (name, col) in enumerate(rows.items()):
        y0, y1 = i * band_h, (i + 1) * band_h
        for x in range(-band_h * 2, SIZE + band_h * 2, band_h):
            pts = [(x, y1), (x + band_h / 2, y1), (x + band_h / 2 + band_h, y0), (x + band_h, y0)]
            d.polygon([(px * DS, py * DS) for px, py in pts], fill=col)
        bands[name] = [y0, y1]
        keen_rows[name] = list(keen[name])

    # warning placards (aspects match the elements they replace), from y = 336
    def cell(name, x, y, w, h):
        cells[name] = [x, y, x + w, y + h]
        return (x * DS, y * DS, (x + w) * DS, (y + h) * DS)

    placard(d, cell("danger_hv", 8, 336, 290, 202), "DANGER", "HIGH\nVOLTAGE", RED, header_fill=WHITE)
    placard(d, cell("caution_moving", 310, 336, 224, 202), "CAUTION", "MOVING\nPARTS", YELLOW)
    x0, y0, x1, y1 = cell("warn_instructions", 8, 550, 600, 99)
    d.rounded_rectangle((x0, y0, x1, y1), radius=8 * DS, fill=WHITE, outline=BLACK, width=3 * DS)
    d.rectangle((x0 + 3 * DS, y0 + 3 * DS, x0 + (x1 - x0) * 0.3, y1 - 3 * DS), fill=YELLOW)
    fit_text(d, (x0 + 10 * DS, y0 + 8 * DS, x0 + (x1 - x0) * 0.3 - 8 * DS, y1 - 8 * DS), "WARNING", BLACK, 80 * DS)
    fit_text(d, (x0 + (x1 - x0) * 0.3 + 14 * DS, y0 + 8 * DS, x1 - 14 * DS, y1 - 8 * DS), "READ THE INSTRUCTIONS\nBEFORE SERVICE", BLACK, 44 * DS)
    fit_text(d, cell("warn_hv_supply", 8, 661, 400, 125), "WARNING\nHIGH VOLTAGE POWER SUPPLY", BLACK, 60 * DS)
    fit_text(d, cell("caution_maint", 420, 661, 400, 122), "CAUTION\nMAINTENANCE REQUIRED", BLACK, 60 * DS)
    x0, y0, x1, y1 = cell("remote_operated", 8, 798, 560, 112)
    d.rounded_rectangle((x0, y0, x1, y1), radius=6 * DS, fill=BLACK)
    fit_text(d, (x0 + 12 * DS, y0 + 8 * DS, x1 - 12 * DS, y1 - 8 * DS), "REMOTE OPERATED SYSTEM\nAUTOMATED EQUIPMENT MAY START", YELLOW, 48 * DS)
    x0, y0, x1, y1 = cell("barcode", 580, 798, 436, 104)
    d.rectangle((x0, y0, x1, y1), fill=WHITE)
    import random
    rnd = random.Random(42)   # deterministic bars
    x = x0 + 10 * DS
    while x < x1 - 14 * DS:
        w = rnd.choice((1, 1, 2, 3)) * 2 * DS
        d.rectangle((x, y0 + 8 * DS, x + w, y1 - 26 * DS), fill=BLACK)
        x += w + rnd.choice((1, 2, 2, 3)) * 2 * DS
    fit_text(d, (x0, y1 - 24 * DS, x1, y1 - 4 * DS), "DC 0420 1337 0001", BLACK, 20 * DS)

    # triangles (point up): base-left, base-right, apex with a 3 px margin
    for name, icon, cx in (("tri_electric", bolt_icon, 760), ("tri_hot", heat_icon, 900), ("tri_general", bang_icon, 0)):
        if name == "tri_general":
            continue
        bl, br, ap, h = triangle(d, cx * DS, 545 * DS, 130 * DS)
        icon(d, cx * DS, (545 - h / DS * 0.38) * DS, 60 * DS)
        m = 3
        tris[name] = [[bl[0] / DS - m, bl[1] / DS + m], [br[0] / DS + m, br[1] / DS + m], [ap[0] / DS, ap[1] / DS - m * 2]]

    # icons (square cells, black and white variants), row at y = 920
    icons = {
        "chevrons": lambda c, f: [d.polygon([(c[0] + (dx - 0.2) * c[2], c[1] - 0.35 * c[2]), (c[0] + (dx + 0.05) * c[2], c[1]), (c[0] + (dx - 0.2) * c[2], c[1] + 0.35 * c[2]), (c[0] + (dx - 0.05) * c[2], c[1] + 0.35 * c[2]), (c[0] + (dx + 0.2) * c[2], c[1]), (c[0] + (dx - 0.05) * c[2], c[1] - 0.35 * c[2])], fill=f) for dx in (-0.12, 0.2)],
        "tri_general": lambda c, f: (d.polygon([(c[0] - 0.42 * c[2], c[1] + 0.36 * c[2]), (c[0] + 0.42 * c[2], c[1] + 0.36 * c[2]), (c[0], c[1] - 0.38 * c[2])], outline=f, width=int(0.08 * c[2])), bang_icon(d, c[0], c[1] + 0.06 * c[2], 0.42 * c[2], f)),
        "power": lambda c, f: fit_text(d, (c[0] - 0.48 * c[2], c[1] - 0.3 * c[2], c[0] + 0.48 * c[2], c[1] + 0.3 * c[2]), "POWER", f, int(0.4 * c[2])),
        "bolt": lambda c, f: bolt_icon(d, c[0], c[1], 0.9 * c[2], f),
        "arrow": lambda c, f: d.polygon([(c[0] - 0.4 * c[2], c[1] - 0.12 * c[2]), (c[0] + 0.05 * c[2], c[1] - 0.12 * c[2]), (c[0] + 0.05 * c[2], c[1] - 0.3 * c[2]), (c[0] + 0.42 * c[2], c[1]), (c[0] + 0.05 * c[2], c[1] + 0.3 * c[2]), (c[0] + 0.05 * c[2], c[1] + 0.12 * c[2]), (c[0] - 0.4 * c[2], c[1] + 0.12 * c[2])], fill=f),
    }
    x = 8
    for name, draw_icon in icons.items():
        for suffix, fill in (("", BLACK), ("_white", WHITE)):
            cells[name + suffix] = [x, 920, x + 90, 1010]
            draw_icon(((x + 45) * DS, 965 * DS, 90 * DS), fill)
            x += 100

    # padlock (the rack door's key cylinder), black and white, top right
    for suffix, fill, x in (("", BLACK, 830), ("_white", WHITE, 930)):
        cells["lock" + suffix] = [x, 336, x + 90, 426]
        cx, cy, sz = (x + 45) * DS, 381 * DS, 90 * DS
        d.arc((cx - 0.2 * sz, cy - 0.42 * sz, cx + 0.2 * sz, cy - 0.02 * sz), 180, 360, fill=fill, width=int(0.08 * sz))
        d.line((cx - 0.2 * sz, cy - 0.22 * sz, cx - 0.2 * sz, cy - 0.04 * sz), fill=fill, width=int(0.08 * sz))
        d.line((cx + 0.2 * sz, cy - 0.22 * sz, cx + 0.2 * sz, cy - 0.04 * sz), fill=fill, width=int(0.08 * sz))
        d.rounded_rectangle((cx - 0.32 * sz, cy - 0.06 * sz, cx + 0.32 * sz, cy + 0.4 * sz), radius=0.05 * sz, fill=fill)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(OUT, "web-decals.png")
    img.save(path, optimize=True)
    with open(os.path.join(OUT, "web-decals.json"), "w") as f:
        json.dump({"size": SIZE, "cells": cells, "triangles": tris, "bands": bands, "keen_rows": keen_rows}, f, indent=1)
    return path


def perf():
    n = 64
    img = Image.new("RGBA", (n, n), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    r = n * 0.30
    d.ellipse((n / 2 - r, n / 2 - r, n / 2 + r, n / 2 + r), fill=(255, 255, 255, 0))
    path = os.path.join(OUT, "web-perf.png")
    img.save(path, optimize=True)
    return path


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    paths = [glyphs(), perf(), decals()]
    allowed = {os.path.basename(p): hashlib.sha256(open(p, "rb").read()).hexdigest() for p in paths}
    with open(os.path.join(OUT, "allowed-images.json"), "w") as f:
        json.dump(allowed, f, indent=1)
    print(json.dumps(allowed, indent=1))
