"""Renderiza as imagens da ENTREGA (double dabble -> 3 displays de 7 segmentos)
com a aparencia exata do Digital Logic Sim 2.x, incluindo o estado VIVO de cada
fio e os segmentos acesos, sem precisar abrir o jogo.

Tudo aqui foi tirado do fonte publico do DLS (SebLague/Digital-Logic-Sim):
DrawSettings.cs, DevSceneDrawer.cs, SubChipInstance.cs e DevPinInstance.cs.

  python tools/ai_style/render_delivery.py --chip "DISPLAY DECIMAL" --value 42 \
         --out entrega/caso-042.html

O HTML sai com o tamanho exato do canvas; o PNG e obtido com screenshot.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import autolayout as A  # noqa: E402
import dlssim as S      # noqa: E402

# ---------------------------------------------------------------- constantes DLS
G = 0.125
BG = (66 / 255, 66 / 255, 69 / 255)
GRID = (49 / 255, 49 / 255, 51 / 255)
GRID_TH = 0.0035
WIRE_TH = 0.025

STATE_HIGH = [
    (0.95, 0.30, 0.31), (0.92, 0.44, 0.12), (0.98, 0.76, 0.26), (0.25, 0.66, 0.31),
    (0.20, 0.50, 1.00), (0.60, 0.40, 0.98), (0.84, 0.33, 0.90), (0.90, 0.90, 0.90),
]
STATE_LOW = [
    (0.20, 0.10, 0.10), (0.28, 0.15, 0.01), (0.26, 0.20, 0.07), (0.10, 0.20, 0.10),
    (0.10, 0.14, 0.35), (0.19, 0.12, 0.28), (0.25, 0.10, 0.25), (0.35, 0.35, 0.35),
]
SEG_OFF = (0.10, 0.09, 0.09)
SEG_ON = (1.00, 0.32, 0.28)

PIN_RADIUS = 0.185 / 2
PIN_H = {1: 0.185, 4: 0.30, 8: 0.43}
DEV_STATE_R = 0.2
DEV_STATE_OUT = 0.0175
DEV_HANDLE_W = DEV_STATE_R * 0.64
MULTI_SQ = 0.21
CHIP_OUTLINE = 0.05
SUBPIN_INSET = 0.015
FONT_CHIP = 0.25
FONT_PIN = 0.2

SEG_ASPECT = 1.75
SEG_TH_FAC = 0.165
SEG_VSP_FAC = 0.07
SEG_INSET_FAC = 0.2


def rgb(c, a=None):
    s = "rgb(%d,%d,%d)" % tuple(max(0, min(255, round(x * 255))) for x in c[:3])
    if a is None:
        return s
    return "rgba(%d,%d,%d,%s)" % (round(c[0] * 255), round(c[1] * 255), round(c[2] * 255), a)


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def outline_col(c):
    d = 0.15
    if lum(c) < 0.075:
        return tuple(min(1.0, x + d) for x in c)
    return tuple(max(0.0, x - d) for x in c)


def border_col(c):
    d = -0.13
    if lum(c) > 0.5:
        return tuple(max(0.0, x + d) for x in c)
    return tuple(min(1.0, x - d) for x in c)


def chip_colour(name):
    if name in A.BUILTIN:
        return (0.10, 0.10, 0.10)
    try:
        c = S.load(name).get("Colour") or {"r": 0.4, "g": 0.4, "b": 0.4}
        return (c["r"], c["g"], c["b"])
    except Exception:
        return (0.45, 0.45, 0.48)


# ------------------------------------------------------------------- simulacao
def probe(chip, value):
    """Roda o chip com a entrada de 8 bits em `value` e devolve tudo que o
    desenho precisa: estado de cada rede e segmentos de cada display."""
    d = S.load(chip)
    pins = d["InputPins"]
    ins = {p["ID"]: value for p in pins}
    S.NET.clear()
    S.DISPLAY_LOG.clear()
    S._memo.clear()
    S.NET_ON = True
    try:
        S.run(chip, ins)
    finally:
        S.NET_ON = False
    segs = {}
    for path, sv in S.DISPLAY_LOG:
        sid = path.rsplit("#", 1)[-1]
        segs.setdefault(sid, sv)
    return d, ins, segs


def net_value(d, ins, addr):
    o, p = addr["PinOwnerID"], addr["PinID"]
    if any(q["ID"] == o for q in d["InputPins"]):
        return ins.get(o, 0)
    for s in d["SubChips"]:
        if s["ID"] == o:
            key = "/%s#%d" % (s["Name"], o)
            return S.NET.get(key, {}).get(p, 0)
    return 0


def net_colour(d, w):
    o = w["SourcePinAddress"]["PinOwnerID"]
    for p in d["InputPins"]:
        if p["ID"] == o:
            return p.get("Colour", 0)
    for s in d["SubChips"]:
        if s["ID"] == o:
            pid = w["SourcePinAddress"]["PinID"]
            for e in (s.get("OutputPinColourInfo") or []):
                if e["PinID"] == pid:
                    return e.get("PinColour", 0)
    return 0


# ------------------------------------------------------------------- displays
# O builtin 7-SEGMENT carrega o proprio display na descricao (BuiltinChipCreator
# .CreateDisplay7Seg): Position (0,0), Scale = largura do corpo - 2 grids.
BUILTIN_DESC = {
    "7-SEGMENT": {"ChipType": "7seg", "SubChips": [],
                  "Displays": [{"Position": {"x": 0.0, "y": 0.0}, "Scale": 1.0,
                                "SubChipID": -1}]},
}


def desc_of(name):
    if name in BUILTIN_DESC:
        return BUILTIN_DESC[name]
    if name in A.BUILTIN:
        return None
    return S.load(name)


def draw_instances(desc, origin, psc, out, seg_id):
    """Repete DevSceneDrawer.DrawDisplay(): posWorld = posParent + Pos*psc.
    `desc` e a descricao do chip INSTANCIADO em `origin`; a lista Displays dele
    e desenhada a partir dali. Chip customizado recursa nos filhos."""
    for x in (desc.get("Displays") or []):
        px = origin[0] + x["Position"]["x"] * psc
        py = origin[1] + x["Position"]["y"] * psc
        s = x["Scale"] * psc
        if desc.get("ChipType") == "7seg":
            out.append({"pos": (px, py), "scale": s, "seg": str(seg_id)})
            continue
        child = next((q for q in desc["SubChips"] if q["ID"] == x["SubChipID"]), None)
        if child is None:
            continue
        cdesc = desc_of(child["Name"])
        if cdesc is not None:
            draw_instances(cdesc, (px, py), s, out, x["SubChipID"])


def collect_displays(root):
    """Displays visiveis com `root` ABERTO: um DrawSubchipDisplays por subchip
    direto, com posParent = posicao do subchip e parentScale = 1."""
    out = []
    for s in root["SubChips"]:
        d = desc_of(s["Name"])
        if d is None:
            continue
        draw_instances(d, (s["Position"]["x"], s["Position"]["y"]), 1.0, out, s["ID"])
    return out


# ------------------------------------------------------------------- desenho
class Canvas:
    def __init__(self, scale, pad):
        self.s = scale
        self.pad = pad
        self.items = []
        self.minx = self.maxx = self.miny = self.maxy = None

    def fit(self, pts):
        for x, y in pts:
            if self.minx is None:
                self.minx = self.maxx = x
                self.miny = self.maxy = y
            self.minx = min(self.minx, x)
            self.maxx = max(self.maxx, x)
            self.miny = min(self.miny, y)
            self.maxy = max(self.maxy, y)

    def T(self, x, y):
        return ((x - self.minx) * self.s + self.pad, (self.maxy - y) * self.s + self.pad)

    def finish(self):
        W = int((self.maxx - self.minx) * self.s + 2 * self.pad)
        H = int((self.maxy - self.miny) * self.s + 2 * self.pad)
        head = ['<svg width="%d" height="%d" viewBox="0 0 %d %d" '
                'xmlns="http://www.w3.org/2000/svg" '
                'font-family="JetBrains Mono, Consolas, monospace">' % (W, H, W, H)]
        head.append('<rect width="%d" height="%d" fill="%s"/>' % (W, H, rgb(BG)))
        g0 = int(self.minx / G) * G
        nx = int((self.maxx - self.minx) / G) + 2
        ny = int((self.maxy - self.miny) / G) + 2
        th = max(1.0, GRID_TH * self.s)
        for i in range(nx + 1):
            x, _ = self.T(g0 + i * G, 0)
            head.append('<line x1="%.2f" y1="0" x2="%.2f" y2="%d" stroke="%s" stroke-width="%.2f"/>'
                        % (x, x, H, rgb(GRID), th))
        gy = int(self.maxy / G) * G
        for i in range(ny + 1):
            _, y = self.T(0, gy - i * G)
            head.append('<line x1="0" y1="%.2f" x2="%d" y2="%.2f" stroke="%s" stroke-width="%.2f"/>'
                        % (y, W, y, rgb(GRID), th))
        return head, W, H


def seg_polygon(cx, cy, w, h, vertical):
    """Forma de um segmento de 7 segmentos (hexagono com pontas)."""
    t = min(w, h) / 2
    if not vertical:
        pts = [(cx - w / 2, cy), (cx - w / 2 + t, cy - h / 2), (cx + w / 2 - t, cy - h / 2),
               (cx + w / 2, cy), (cx + w / 2 - t, cy + h / 2), (cx - w / 2 + t, cy + h / 2)]
    else:
        pts = [(cx, cy - h / 2), (cx + w / 2, cy - h / 2 + t), (cx + w / 2, cy + h / 2 - t),
               (cx, cy + h / 2), (cx - w / 2, cy + h / 2 - t), (cx - w / 2, cy - h / 2 + t)]
    return pts


def draw_seven_seg(cv, pos, scale, segs):
    """segs = (a,b,c,d,e,f,g) com 1 = aceso. Geometria de DrawDisplay_SevenSegment."""
    cx, cy = cv.T(*pos)
    s = scale * cv.s
    bw, bh = s, s * SEG_ASPECT
    th = s * SEG_TH_FAC
    sw = s - th - s * SEG_INSET_FAC
    rh = bh - th - s * SEG_INSET_FAC
    sh = rh / 2 - s * SEG_VSP_FAC
    ox, oy = sw / 2, rh / 4
    # borda e fundo preto
    cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>'
                    % (cx - bw / 2 - 0.015 * cv.s, cy - bh / 2 - 0.015 * cv.s,
                       bw + 0.03 * cv.s, bh + 0.03 * cv.s, rgb(border_col((0.12, 0.12, 0.14)))))
    cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="black"/>'
                    % (cx - bw / 2, cy - bh / 2, bw, bh))
    layout = [
        (0, (cx, cy - rh / 2), (sw, th), False),          # A topo
        (1, (cx + ox, cy - oy), (th, sh), True),          # B sup dir
        (2, (cx + ox, cy + oy), (th, sh), True),          # C inf dir
        (3, (cx, cy + rh / 2), (sw, th), False),          # D base
        (4, (cx - ox, cy + oy), (th, sh), True),          # E inf esq
        (5, (cx - ox, cy - oy), (th, sh), True),          # F sup esq
        (6, (cx, cy), (sw, th), False),                   # G meio
    ]
    for i, (px, py), (w, h), vert in layout:
        col = SEG_ON if (segs and segs[i]) else SEG_OFF
        pts = " ".join("%.2f,%.2f" % (a, b) for a, b in seg_polygon(px, py, w, h, vert))
        cv.items.append('<polygon points="%s" fill="%s"/>' % (pts, rgb(col)))


# BuiltinChipCreator: chips de display / bus / key usam NameDisplayLocation.Hidden
NAME_HIDDEN = {"7-SEGMENT", "LED", "RGB DISPLAY", "DOT DISPLAY", "KEY",
               "BUS-1", "BUS-4", "BUS-8",
               "BUS-TERMINUS-1", "BUS-TERMINUS-4", "BUS-TERMINUS-8"}


def chip_name_lines(name):
    """SubChipInstance.CreateMultiLineName: uma linha se for curto ou sem
    espaco; senao divide no espaco que melhor equilibra os dois lados."""
    if len(name) <= 6 or " " not in name:
        return [name]
    best, pen = [name], 1e9
    for i, ch in enumerate(name):
        if ch == " ":
            a, b = name[:i].strip(), name[i:].strip()
            p = abs(len(a) - len(b))
            if p < pen:
                best, pen = [a, b], p
    return best


def draw_subchip(cv, name, pos):
    w, h = A.chip_info(name)["size"]
    col = chip_colour(name)
    cx, cy = cv.T(*pos)
    W, H = w * cv.s, h * cv.s
    cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>'
                    % (cx - W / 2 - CHIP_OUTLINE * cv.s / 2, cy - H / 2 - CHIP_OUTLINE * cv.s / 2,
                       W + CHIP_OUTLINE * cv.s, H + CHIP_OUTLINE * cv.s, rgb(outline_col(col))))
    cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>'
                    % (cx - W / 2, cy - H / 2, W, H, rgb(col)))
    # DevSceneDrawer.DrawSubChip: o nome SEMPRE aparece (salvo NameLocation
    # Hidden); uma linha se couber, senao a versao em duas linhas.
    fs = FONT_CHIP * cv.s
    if fs <= 4 or name in NAME_HIDDEN:
        return
    tc = "black" if lum(col) > 0.5 else "white"
    fits = len(name) * fs * 0.62 < W - PIN_RADIUS * 2.5 * cv.s
    lines = [name] if fits else chip_name_lines(name)
    loc = 0
    try:
        loc = int(S.load(name).get("NameLocation", 0)) if name not in A.BUILTIN else 0
    except Exception:
        loc = 0
    lh = fs * 1.05
    if loc == 1:  # Top: faixa de fundo + texto encostado no topo
        band_h = G * cv.s + lh * len(lines)
        cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>'
                        % (cx - W / 2, cy - H / 2, W, band_h, rgb(border_col(col))))
        y0 = cy - H / 2 + G * cv.s / 2 + lh / 2
    else:
        y0 = cy - (len(lines) - 1) * lh / 2
    for i, ln in enumerate(lines):
        cv.items.append('<text x="%.2f" y="%.2f" fill="%s" font-size="%.1f" font-weight="700" '
                        'text-anchor="middle">%s</text>'
                        % (cx, y0 + i * lh + fs * 0.35, tc, fs, ln))


def sub_pin_pos(name, pos, pid, is_out):
    info = A.chip_info(name)
    w, h = info["size"]
    lst = info["outs"] if is_out else info["ins"]
    offs = A.pin_offsets(h, [b for _, b in lst])
    for i, (p, _) in enumerate(lst):
        if p == pid:
            x = pos[0] + (w / 2 - SUBPIN_INSET if is_out else -w / 2 + SUBPIN_INSET)
            return (x, pos[1] + offs[i])
    return None


def dev_pin_geometry(p, is_input):
    bit = p.get("BitCount", 1)
    face = 1 if is_input else -1
    hx, hy = p["Position"]["x"], p["Position"]["y"]
    grid = (4, 2) if bit == 8 else ((2, 2) if bit == 4 else (1, 1))
    sgx = grid[0] * MULTI_SQ + DEV_STATE_OUT
    sgy = grid[1] * MULTI_SQ + DEV_STATE_OUT
    if bit == 1:
        sgx = sgy = DEV_STATE_R * 2 + DEV_STATE_OUT * 2
    sd = (hx + face * (DEV_HANDLE_W / 2 + sgx / 2 + 0.065), hy)
    dst = 6 if bit in (1, 4) else 9
    pp = (hx + face * G * dst, hy)
    return sd, pp, (sgx, sgy), grid


def draw_dev_pin(cv, p, is_input, value):
    bit = p.get("BitCount", 1)
    col = STATE_HIGH[p.get("Colour", 0) % 8]
    low = STATE_LOW[p.get("Colour", 0) % 8]
    sd, pp, sg, grid = dev_pin_geometry(p, is_input)
    cx, cy = cv.T(*sd)
    px, py = cv.T(*pp)
    hx, hy = cv.T(p["Position"]["x"], p["Position"]["y"])
    cv.items.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="black" stroke-width="%.2f"/>'
                    % (cx, cy, px, py, max(1.5, 0.03 * cv.s)))
    if bit == 1:
        high = bool(value & 1)
        c = col if high else low
        r = DEV_STATE_R * cv.s
        cv.items.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>'
                        % (cx, cy, r + DEV_STATE_OUT * cv.s, rgb(tuple(x * 0.62 for x in c))))
        cv.items.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>' % (cx, cy, r, rgb(c)))
    else:
        n = grid[0] * grid[1]
        sq = MULTI_SQ * 0.9 * cv.s
        gx0 = cx - sg[0] * cv.s / 2 + MULTI_SQ * cv.s / 2
        gy0 = cy + sg[1] * cv.s / 2 - MULTI_SQ * cv.s / 2
        cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="black"/>'
                        % (cx - sg[0] * cv.s / 2, cy - sg[1] * cv.s / 2, sg[0] * cv.s, sg[1] * cv.s))
        for i in range(n):
            bx = value >> (bit - 1 - i) & 1
            c = col if bx else low
            r_, cix = divmod(i, grid[0])
            cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>'
                            % (gx0 + cix * MULTI_SQ * cv.s - sq / 2,
                               gy0 - r_ * MULTI_SQ * cv.s - sq / 2, sq, sq, rgb(c)))
        # rotulo decimal (UnsignedDecimal), como DrawPinDecValue
        txt = str(value & ((1 << bit) - 1))
        lw, lh = sg[0] * cv.s, 0.2 * cv.s
        ly = cy - sg[1] * cv.s / 2 - lh / 2 + 0.1 * cv.s - 0.225 * cv.s
        cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="rgba(0,0,0,0.17)"/>'
                        % (cx - lw / 2, ly - lh / 2, lw, lh))
        cv.items.append('<text x="%.2f" y="%.2f" fill="white" font-size="%.1f" font-weight="700" '
                        'text-anchor="middle">%s</text>' % (cx, ly + lh * 0.35, FONT_PIN * cv.s, txt))
    # pino e handle
    cv.items.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="black"/>'
                    % (px, py, PIN_RADIUS * cv.s))
    hw = DEV_HANDLE_W * cv.s
    cv.items.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="black"/>'
                    % (hx - hw / 2, hy - hw / 2, hw, hw))
    # nome do pino
    fs = max(7, FONT_PIN * cv.s * 0.9)
    nx = hx - (0.25 * cv.s) if is_input else hx + 0.25 * cv.s
    anchor = "end" if is_input else "start"
    cv.items.append('<text x="%.2f" y="%.2f" fill="rgba(255,255,255,0.75)" font-size="%.1f" '
                    'font-weight="700" text-anchor="%s">%s</text>'
                    % (nx, hy - 0.28 * cv.s, fs, anchor, p.get("Name", "")))


def render(chip, value, scale, pad=60):
    d, ins, segs = probe(chip, value)
    cv = Canvas(scale, pad)

    pts = []
    for p in d["InputPins"] + d["OutputPins"]:
        sd, pp, sg, _ = dev_pin_geometry(p, p in d["InputPins"])
        pts += [(p["Position"]["x"] - 1.2, p["Position"]["y"] - 0.6),
                (p["Position"]["x"] + 1.2, p["Position"]["y"] + 0.6)]
    for s in d["SubChips"]:
        w, h = A.chip_info(s["Name"])["size"]
        pts += [(s["Position"]["x"] - w / 2, s["Position"]["y"] - h / 2),
                (s["Position"]["x"] + w / 2, s["Position"]["y"] + h / 2)]
    disp = collect_displays(d)
    for x in disp:
        pts += [(x["pos"][0] - x["scale"] / 2, x["pos"][1] - x["scale"] * SEG_ASPECT / 2),
                (x["pos"][0] + x["scale"] / 2, x["pos"][1] + x["scale"] * SEG_ASPECT / 2)]
    cv.fit(pts)

    # fios
    for w in d["Wires"]:
        sa, ta = w["SourcePinAddress"], w["TargetPinAddress"]
        a = b = None
        if any(q["ID"] == sa["PinOwnerID"] for q in d["InputPins"]):
            pin = next(q for q in d["InputPins"] if q["ID"] == sa["PinOwnerID"])
            a = dev_pin_geometry(pin, True)[1]
        else:
            sub = next((s for s in d["SubChips"] if s["ID"] == sa["PinOwnerID"]), None)
            if sub:
                a = sub_pin_pos(sub["Name"], (sub["Position"]["x"], sub["Position"]["y"]),
                                sa["PinID"], True)
        if any(q["ID"] == ta["PinOwnerID"] for q in d["OutputPins"]):
            pin = next(q for q in d["OutputPins"] if q["ID"] == ta["PinOwnerID"])
            b = dev_pin_geometry(pin, False)[1]
        else:
            sub = next((s for s in d["SubChips"] if s["ID"] == ta["PinOwnerID"]), None)
            if sub:
                b = sub_pin_pos(sub["Name"], (sub["Position"]["x"], sub["Position"]["y"]),
                                ta["PinID"], False)
        if not a or not b:
            continue
        v = net_value(d, ins, sa)
        high = bool(v & 1) if isinstance(v, int) else False
        ci = net_colour(d, w) % 8
        col = STATE_HIGH[ci] if high else STATE_LOW[ci]
        seq = [a]
        for pt in w.get("Points", []):
            if pt["x"] == 0 and pt["y"] == 0:
                continue
            seq.append((pt["x"], pt["y"]))
        seq.append(b)
        s = " ".join("%.2f,%.2f" % cv.T(x, y) for x, y in seq)
        cv.items.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%.2f" '
                        'stroke-linejoin="round" stroke-linecap="round"/>'
                        % (s, rgb(col), max(1.6, WIRE_TH * cv.s)))

    # subchips
    for s in d["SubChips"]:
        draw_subchip(cv, s["Name"], (s["Position"]["x"], s["Position"]["y"]))

    # displays por cima
    for x in disp:
        draw_seven_seg(cv, x["pos"], x["scale"], segs.get(x["seg"]))

    # pinos do chip
    for p in d["InputPins"]:
        draw_dev_pin(cv, p, True, ins.get(p["ID"], 0))
    for p in d["OutputPins"]:
        draw_dev_pin(cv, p, False, 0)

    head, W, H = cv.finish()
    return "".join(head) + "".join(cv.items) + "</svg>", (W, H)


def page(chip, value, svg, W, H, caption):
    return ("<!doctype html><meta charset='utf-8'><title>%s</title>"
            "<style>html,body{margin:0;background:#1b1b1d}"
            ".bar{background:#2a2a2c;color:#eee;font:600 15px 'JetBrains Mono',Consolas,monospace;"
            "padding:9px 14px;border-bottom:1px solid #3a3a3c}"
            ".bar b{color:#f6c453}svg{display:block}</style>"
            "<div class='bar'>%s</div>%s" % (chip, caption, svg))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chip", required=True)
    ap.add_argument("--value", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=float, default=64)
    ap.add_argument("--caption", default="")
    args = ap.parse_args()
    svg, (W, H) = render(args.chip, args.value, args.scale)
    cap = args.caption or ("%s = %d" % (format(args.value, "08b"), args.value))
    html = page(args.chip, args.value, svg, W, H, cap)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)
    print(args.out, W, H + 34)


if __name__ == "__main__":
    main()
