"""Renderiza um chip do DLS em SVG com a aparencia exata do jogo (grade,
corpo dos chips, pinos coloridos, fios por cor de origem), para conferir o
resultado sem precisar abrir o Digital Logic Sim.

  python tools/ai_style/render_preview.py --name KMAP4-A --out preview.html
  python tools/ai_style/render_preview.py --name ALU-8 --compare --out preview.html

--compare mostra o que esta em Chips/ ao lado do backup em
tools/ai_style/backup_chips/ (antes x depois).
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import autolayout as A  # noqa: E402
import dlssim as S      # noqa: E402

G = 0.125
BG = "rgb(66,66,69)"
GRID = "rgb(49,49,51)"

# DrawSettings.CreateTheme(): StateHighCol[PinColour]
STATE_HIGH = [
    (0.95, 0.30, 0.31),  # 0 Vermelho
    (0.92, 0.44, 0.12),  # 1 Laranja
    (0.98, 0.76, 0.26),  # 2 Amarelo
    (0.25, 0.66, 0.31),  # 3 Verde
    (0.20, 0.50, 1.00),  # 4 Azul
    (0.60, 0.40, 0.98),  # 5 Violeta
    (0.84, 0.33, 0.90),  # 6 Rosa
    (0.90, 0.90, 0.90),  # 7 Branco
]

BUILTIN_BODY = {
    "NAND": (0.73, 0.26, 0.26),
    "3-STATE BUFFER": (0.10, 0.10, 0.10),
    "CLOCK": (0.10, 0.10, 0.10),
    "PULSE": (0.10, 0.10, 0.10),
    "KEY": (0.10, 0.10, 0.10),
    "RAM 256×8": (0.85, 0.45, 0.30),
    "ROM 256×16": (0.25, 0.35, 0.50),
    "LED": (0.10, 0.10, 0.10),
    "7-SEGMENT": (0.10, 0.10, 0.10),
    "DOT DISPLAY": (0.10, 0.10, 0.10),
    "RGB DISPLAY": (0.10, 0.10, 0.10),
    "BUZZER": (0.00, 0.00, 0.00),
}
SPLIT_MERGE = (0.10, 0.10, 0.10)


def rgb(c):
    return "rgb(%d,%d,%d)" % tuple(round(x * 255) for x in c)


def body_colour(name):
    if name in BUILTIN_BODY:
        return rgb(BUILTIN_BODY[name])
    if name in ("8-1BIT", "4-1BIT", "1-8BIT", "1-4BIT", "8-4BIT", "4-8BIT"):
        return rgb(SPLIT_MERGE)
    if name.startswith("BUS"):
        return rgb((0.10, 0.10, 0.10))
    try:
        with open(os.path.join(S.CHIPS, name + ".json"), encoding="utf-8-sig") as f:
            c = json.load(f).get("Colour") or {"r": 0.4, "g": 0.4, "b": 0.4}
        return rgb((c["r"], c["g"], c["b"]))
    except Exception:
        return rgb((0.45, 0.45, 0.48))


def build_geometry(d):
    """Posicoes mundiais de todos os pinos + caixas dos subchips."""
    in_ids = {p["ID"] for p in d["InputPins"]}
    out_ids = {p["ID"] for p in d["OutputPins"]}
    sub = {s["ID"]: s for s in d["SubChips"]}

    src, dst = {}, {}
    for p in d["InputPins"]:
        src[("in", p["ID"], 0)] = (p["Position"]["x"], p["Position"]["y"])
    for p in d["OutputPins"]:
        dst[("out", p["ID"], 0)] = (p["Position"]["x"], p["Position"]["y"])

    for s in d["SubChips"]:
        info = A.chip_info(s["Name"])
        w, h = info["size"]
        iy = A.pin_offsets(h, [b for _, b in info["ins"]]) if info["ins"] else []
        oy = A.pin_offsets(h, [b for _, b in info["outs"]]) if info["outs"] else []
        px, py = s["Position"]["x"], s["Position"]["y"]
        for i, (pid, _) in enumerate(info["ins"]):
            dst[("sub", s["ID"], pid)] = (px - w / 2, py + iy[i])
        for i, (pid, _) in enumerate(info["outs"]):
            src[("sub", s["ID"], pid)] = (px + w / 2, py + oy[i])

    def key(addr, is_source):
        o = addr["PinOwnerID"]
        if is_source and o in in_ids:
            return ("in", o, 0)
        if not is_source and o in out_ids:
            return ("out", o, 0)
        return ("sub", o, addr["PinID"])

    return src, dst, key, sub


def net_colour(d, sub, w):
    o = w["SourcePinAddress"]["PinOwnerID"]
    for p in d["InputPins"]:
        if p["ID"] == o:
            return p.get("Colour", 0)
    s = sub.get(o)
    if s:
        pid = w["SourcePinAddress"]["PinID"]
        for e in (s.get("OutputPinColourInfo") or []):
            if e["PinID"] == pid:
                return e.get("PinColour", 0)
    return 0


def render_svg(d, scale, pad=40):
    src, dst, key, sub = build_geometry(d)

    pts_all = []
    for p in d["InputPins"] + d["OutputPins"]:
        pts_all.append((p["Position"]["x"], p["Position"]["y"]))
    for s in d["SubChips"]:
        w, h = A.chip_info(s["Name"])["size"]
        pts_all += [(s["Position"]["x"] - w / 2, s["Position"]["y"] - h / 2),
                    (s["Position"]["x"] + w / 2, s["Position"]["y"] + h / 2)]
    xs = [q[0] for q in pts_all]
    ys = [q[1] for q in pts_all]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

    def T(x, y):
        return ((x - minx) * scale + pad, (maxy - y) * scale + pad)

    W = int((maxx - minx) * scale + 2 * pad)
    H = int((maxy - miny) * scale + 2 * pad)
    out = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
           f'xmlns="http://www.w3.org/2000/svg" font-family="JetBrains Mono, monospace">']
    out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/>')

    g0 = int((minx - 1) / G) * G
    for gx in range(0, int((maxx - minx) / G) + 3):
        x = (g0 + gx * G - minx) * scale + pad
        out.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{H}" stroke="{GRID}" stroke-width="1"/>')
    gy = int((maxy + 1) / G) * G
    for i in range(0, int((maxy - miny) / G) + 3):
        y = (gy - i * G - miny) * scale + pad
        out.append(f'<line x1="0" y1="{y:.1f}" x2="{W}" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>')

    # fios primeiro, por baixo dos chips
    for w in d["Wires"]:
        a = src.get(key(w["SourcePinAddress"], True))
        b = dst.get(key(w["TargetPinAddress"], False))
        if not a or not b:
            continue
        col = rgb(STATE_HIGH[net_colour(d, sub, w) % 8])
        seq = [a]
        for pt in w.get("Points", []):
            if pt["x"] == 0 and pt["y"] == 0:
                continue
            seq.append((pt["x"], pt["y"]))
        seq.append(b)
        s = " ".join("%.1f,%.1f" % T(x, y) for x, y in seq)
        out.append(f'<polyline points="{s}" fill="none" stroke="{col}" '
                   f'stroke-width="{max(1.6, 0.025*scale):.1f}" stroke-linejoin="round" stroke-linecap="round"/>')

    # subchips
    for s in d["SubChips"]:
        w, h = A.chip_info(s["Name"])["size"]
        cx, cy = T(s["Position"]["x"], s["Position"]["y"])
        x, y = cx - w * scale / 2, cy - h * scale / 2
        r = min(6, h * scale / 3)
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w*scale:.1f}" height="{h*scale:.1f}" '
                   f'rx="{r:.1f}" fill="{body_colour(s["Name"])}" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>')
        fs = max(7, min(0.16 * scale, h * scale * 0.5))
        out.append(f'<text x="{cx:.1f}" y="{cy + fs*0.35:.1f}" fill="white" font-size="{fs:.0f}" '
                   f'font-weight="600" text-anchor="middle">{s["Name"][:22]}</text>')

    # pinos
    def pin(x, y, colour, is_out):
        cx, cy = T(x, y)
        c = rgb(STATE_HIGH[colour % 8])
        stub = 0.18 * scale
        x2 = cx - stub if is_out else cx + stub
        out.append(f'<line x1="{cx:.1f}" y1="{cy:.1f}" x2="{x2:.1f}" y2="{cy:.1f}" stroke="black" stroke-width="{max(1.5,0.05*scale):.1f}"/>')
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{max(3,0.093*scale):.1f}" fill="{c}" stroke="black" stroke-width="1.5"/>')

    for p in d["InputPins"]:
        pin(p["Position"]["x"], p["Position"]["y"], p.get("Colour", 0), False)
        cx, cy = T(p["Position"]["x"], p["Position"]["y"])
        out.append(f'<text x="{cx+0.22*scale:.1f}" y="{cy-0.12*scale:.1f}" fill="rgba(255,255,255,.55)" '
                   f'font-size="{max(6,0.13*scale):.0f}">{p["Name"]}</text>')
    for p in d["OutputPins"]:
        pin(p["Position"]["x"], p["Position"]["y"], p.get("Colour", 0), True)
        cx, cy = T(p["Position"]["x"], p["Position"]["y"])
        out.append(f'<text x="{cx-0.22*scale:.1f}" y="{cy-0.12*scale:.1f}" fill="rgba(255,255,255,.55)" '
                   f'font-size="{max(6,0.13*scale):.0f}" text-anchor="end">{p["Name"]}</text>')

    out.append("</svg>")
    return "".join(out), (W, H)


def load_from(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--demo", action="store_true",
                    help="mostra o estilo aplicado em memoria, sem gravar nada")
    ap.add_argument("--scale", type=float, default=0)
    ap.add_argument("--bk-dir", default="backup_chips",
                    help="pasta do 'antes' (backup_chips | backup_showcase)")
    args = ap.parse_args()

    cur = load_from(os.path.join(S.CHIPS, args.name + ".json"))
    panels = []

    def panel(title, d):
        span_x = max([p["Position"]["x"] for p in d["InputPins"] + d["OutputPins"]] +
                     [s["Position"]["x"] for s in d["SubChips"]] + [0]) - \
                 min([p["Position"]["x"] for p in d["InputPins"] + d["OutputPins"]] +
                     [s["Position"]["x"] for s in d["SubChips"]] + [0])
        sc = args.scale or max(18.0, min(90.0, 1100.0 / max(span_x, 0.5)))
        svg, (W, H) = render_svg(d, sc)
        return f'<figure><figcaption>{title} &nbsp;<small>{W}&times;{H}px &middot; ' \
               f'{len(d["SubChips"])} subchips &middot; {len(d["Wires"])} fios</small></figcaption>{svg}</figure>'

    if args.demo:
        import copy
        styled = A.layout(copy.deepcopy(cur))
        import colorize as C
        C.apply(styled)
        panels.append(panel("depois (estilo IA, em memoria)", styled))
        panels.append(panel("antes (Chips/)", cur))
    else:
        panels.append(panel("depois (Chips/)", cur))
        if args.compare:
            bk = os.path.join(HERE, args.bk_dir, args.name + ".json")
            if os.path.exists(bk):
                panels.append(panel("antes (backup)", load_from(bk)))

    html = ("<!doctype html><meta charset='utf-8'><title>" + args.name + "</title>"
            "<style>body{background:#1b1b1d;color:#eee;font-family:'JetBrains Mono',monospace;margin:18px;"
            "display:flex;flex-wrap:wrap;gap:18px}figure{margin:0;border:1px solid #333;border-radius:10px;"
            "overflow:hidden}figcaption{padding:8px 12px;background:#2a2a2c;font-size:14px}"
            "figcaption small{opacity:.6;font-weight:400}svg{display:block}</style>"
            + "".join(panels))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)
    print(args.out)


if __name__ == "__main__":
    main()
