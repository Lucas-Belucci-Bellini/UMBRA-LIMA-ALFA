"""Rasterizador minimo: SVG (o subconjunto que render_delivery.py emite) -> PNG.

Por que existe: o ambiente nao tem cairosvg/rsvg/inkscape/magick, mas tem
Pillow. Como o SVG aqui e gerado por nos mesmos, o formato e fechado e
previsivel: <rect>, <line>, <circle>, <polygon>, <polyline> e <text> com
coordenadas absolutas. Isso basta para gerar o PNG da entrega com
supersampling (SSAA) sem depender de navegador nem de screenshot.

  python -c "import svg2png; svg2png.write_file('a.html.svg','a.png',ss=3)"
"""

import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = os.environ.get("SYSTEMROOT", "C:/Windows") + "/Fonts"
_FONTS = {}

TAG_RE = re.compile(r"<(rect|line|circle|polygon|polyline|text)\b([^>]*?)(?:/>|>(.*?)</\1>)", re.S)
ATTR_RE = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
COL_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)")


def font(size, bold):
    key = (round(size), bool(bold))
    if key not in _FONTS:
        name = "arialbd.ttf" if bold else "arial.ttf"
        try:
            _FONTS[key] = ImageFont.truetype(os.path.join(FONT_DIR, name), max(1, key[0]))
        except Exception:
            _FONTS[key] = ImageFont.load_default()
    return _FONTS[key]


def colour(spec):
    """'rgb(r,g,b)' | 'rgba(r,g,b,a)' | nome -> (r,g,b,a) 0..255."""
    if spec is None:
        return (0, 0, 0, 255)
    m = COL_RE.match(spec.strip())
    if m:
        r, g, b, a = m.groups()
        return (int(r), int(g), int(b), 255 if a is None else round(float(a) * 255))
    names = {"black": (0, 0, 0), "white": (255, 255, 255), "none": None}
    if spec.strip() in names:
        v = names[spec.strip()]
        return None if v is None else (v[0], v[1], v[2], 255)
    return (0, 0, 0, 255)


def parse(svg):
    """Devolve (W, H, itens). Cada item e (tag, attrs, text)."""
    m = re.search(r"<svg\b([^>]*)>", svg)
    head = dict(ATTR_RE.findall(m.group(1))) if m else {}
    W = int(float(head.get("width", 800)))
    H = int(float(head.get("height", 600)))
    body = svg[m.end():] if m else svg
    items = []
    for mm in TAG_RE.finditer(body):
        tag, attrs, inner = mm.groups()
        items.append((tag, dict(ATTR_RE.findall(attrs or "")), (inner or "").strip()))
    return W, H, items


def _pts(spec):
    out = []
    for pair in spec.replace(",", " ").split():
        out.append(float(pair))
    return list(zip(out[0::2], out[1::2]))


def render(svg, ss=3):
    W, H, items = parse(svg)
    W2, H2 = W * ss, H * ss
    img = Image.new("RGBA", (W2, H2), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)

    def P(x, y):
        return (float(x) * ss, float(y) * ss)

    for tag, a, txt in items:
        fill = colour(a.get("fill"))
        stroke = colour(a.get("stroke"))
        if tag == "rect":
            x, y = P(a.get("x", 0), a.get("y", 0))
            w, h = float(a.get("width", 0)) * ss, float(a.get("height", 0)) * ss
            box = [x, y, x + w, y + h]
            if fill and fill[3] >= 255:
                d.rectangle(box, fill=fill)
            elif fill:
                ov = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
                ImageDraw.Draw(ov).rectangle(box, fill=fill)
                img.alpha_composite(ov)
                d = ImageDraw.Draw(img)
        elif tag == "line":
            p1 = P(a.get("x1", 0), a.get("y1", 0))
            p2 = P(a.get("x2", 0), a.get("y2", 0))
            w = max(1, round(float(a.get("stroke-width", 1)) * ss))
            d.line([p1, p2], fill=stroke, width=w)
        elif tag == "circle":
            cx, cy = P(a.get("cx", 0), a.get("cy", 0))
            r = float(a.get("r", 0)) * ss
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
        elif tag == "polygon":
            pts = [P(x, y) for x, y in _pts(a.get("points", ""))]
            if len(pts) >= 3:
                d.polygon(pts, fill=fill)
        elif tag == "polyline":
            pts = [P(x, y) for x, y in _pts(a.get("points", ""))]
            if len(pts) >= 2:
                w = max(1, round(float(a.get("stroke-width", 1)) * ss))
                d.line(pts, fill=stroke, width=w, joint="curve")
        elif tag == "text":
            if not txt.strip():
                continue
            f = font(float(a.get("font-size", 12)) * ss, a.get("font-weight") == "700")
            anchor = {"middle": "ms", "end": "rs", "start": "ls"}.get(a.get("text-anchor", "start"), "ls")
            x, y = P(a.get("x", 0), a.get("y", 0))
            c = fill or (255, 255, 255, 255)
            if c[3] >= 255:
                d.text((x, y), txt, font=f, fill=c, anchor=anchor)
            else:
                ov = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
                ImageDraw.Draw(ov).text((x, y), txt, font=f, fill=c, anchor=anchor)
                img.alpha_composite(ov)
                d = ImageDraw.Draw(img)

    if ss > 1:
        img = img.resize((W, H), Image.LANCZOS)
    return img.convert("RGB")


def write_file(path_in, path_out, ss=3):
    with open(path_in, encoding="utf-8") as f:
        html = f.read()
    m = re.search(r"<svg\b.*?</svg>", html, re.S)
    if not m:
        raise SystemExit("sem <svg> em " + path_in)
    img = render(m.group(0), ss)
    os.makedirs(os.path.dirname(os.path.abspath(path_out)) or ".", exist_ok=True)
    img.save(path_out)
    return img.size


if __name__ == "__main__":
    a = sys.argv
    ss = 3
    if "--ss" in a:
        i = a.index("--ss")
        ss = int(a[i + 1])
        del a[i:i + 2]
    print(write_file(a[1], a[2], ss))
