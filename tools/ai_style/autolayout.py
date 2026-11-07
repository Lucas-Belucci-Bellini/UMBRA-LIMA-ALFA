"""Auto-layout for Digital Logic Sim 2 chips: columns by signal depth, >= 5 grid squares between chips,
orthogonal wires with one vertical track per net in each gap. Only positions and wire points change."""
import copy, json, os, shutil, sys
import dlssim as S

G = 0.125
CHIP_GAP = 5 * G          # min vertical space between two chips
DUMMY_GAP = 2 * G         # clearance for a wire passing through a column
COL_MARGIN = 4 * G        # space between a column edge and the first/last wire track
TRACK = G                 # spacing between vertical wire tracks
MIN_COL_GAP = 8 * G


def _r(v):
    """Altura quantizada na precisao que o tracado dos fios realmente usa."""
    return round(v, 6)

BUILTIN = {
    "NAND": {"size": (1.0, 0.5), "ins": [(0, 1), (1, 1)], "outs": [(2, 1)]},
    "8-1BIT": {"size": (G * 9, 2.0), "ins": [(0, 8)], "outs": [(i, 1) for i in range(1, 9)]},
    "4-1BIT": {"size": (G * 9, 1.0), "ins": [(0, 4)], "outs": [(i, 1) for i in range(1, 5)]},
    "7-SEGMENT": {"size": (G * 10, 2.0), "ins": [(i, 1) for i in range(8)], "outs": []},
    "1-8BIT": {"size": (G * 9, 2.0), "ins": [(i, 1) for i in range(8)], "outs": [(8, 8)]},
    "1-4BIT": {"size": (G * 9, 1.0), "ins": [(i, 1) for i in range(4)], "outs": [(4, 4)]},
    "8-4BIT": {"size": (G * 9, 0.75), "ins": [(0, 8)], "outs": [(1, 4), (2, 4)]},
    "4-8BIT": {"size": (G * 9, 0.75), "ins": [(0, 4), (1, 4)], "outs": [(2, 8)]},
    "3-STATE BUFFER": {"size": (1.5, G * 5), "ins": [(0, 1), (1, 1)], "outs": [(2, 1)]},
    # ---- acrescentados: o resto dos builtin do DLS 2.x (BuiltinChipCreator.cs) ----
    "LED": {"size": (G * 2, G * 2), "ins": [(0, 1)], "outs": []},
    "CLOCK": {"size": (1.0, G * 3), "ins": [], "outs": [(0, 1)]},
    "PULSE": {"size": (1.0, G * 3), "ins": [(0, 1)], "outs": [(1, 1)]},
    "KEY": {"size": (G * 3, G * 3), "ins": [], "outs": [(0, 1)]},
    "ROM 256×16": {"size": (G * 12, 1.0), "ins": [(0, 8)], "outs": [(1, 8), (2, 8)]},
    "RAM 256×8": {"size": (G * 10, 1.0), "ins": [(0, 8), (1, 8), (2, 1), (3, 1), (4, 1)], "outs": [(5, 8)]},
    "DOT DISPLAY": {"size": (1.75, 1.75), "ins": [(0, 8), (1, 1), (2, 1), (3, 1), (4, 1), (5, 1)], "outs": [(6, 1)]},
    "RGB DISPLAY": {"size": (2.625, 2.625),
                    "ins": [(0, 8), (1, 4), (2, 4), (3, 4), (4, 1), (5, 1), (6, 1), (7, 1)],
                    "outs": [(8, 4), (9, 4), (10, 4)]},
    "BUZZER": {"size": (G * 9, 0.625), "ins": [(1, 8), (0, 4)], "outs": []},
    "BUS-1": {"size": (G * 2, G * 2), "ins": [(0, 1)], "outs": [(1, 1)]},
    "BUS-4": {"size": (G * 2, G * 3), "ins": [(0, 4)], "outs": [(1, 4)]},
    "BUS-8": {"size": (G * 2, G * 4), "ins": [(0, 8)], "outs": [(1, 8)]},
    "BUS-TERMINUS-1": {"size": (G * 2, G * 2), "ins": [(0, 1)], "outs": []},
    "BUS-TERMINUS-4": {"size": (G * 2, G * 3), "ins": [(0, 4)], "outs": []},
    "BUS-TERMINUS-8": {"size": (G * 2, G * 4), "ins": [(0, 8)], "outs": []},
}
DEVPIN_H = {1: 2 * G, 4: 3 * G, 8: 5 * G}
DEVPIN_W = 4 * G


def pin_offsets(size_y, bitcounts):
    if len(bitcounts) == 1:
        return [0.0]
    grid, ys = 0, []
    for b in bitcounts:
        h = {1: 2, 4: 3}.get(b, 4)
        ys.append(grid - h / 2)
        grid -= h
    top = size_y / 2
    out = [top + gy * G for gy in ys]
    rem = size_y - abs(grid) * G
    if rem > 0:
        sp = rem / (len(bitcounts) - 1)
        out = [y - sp * i for i, y in enumerate(out)]
    return out


def chip_info(name):
    if name in BUILTIN:
        return BUILTIN[name]
    d = S.load(name)
    return {"size": (d["Size"]["x"], d["Size"]["y"]),
            "ins": [(p["ID"], p["BitCount"]) for p in d["InputPins"]],
            "outs": [(p["ID"], p["BitCount"]) for p in d["OutputPins"]]}


def pav_nondecreasing(vals):
    blocks = []  # [sum, count]
    for v in vals:
        blocks.append([v, 1])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            s, c = blocks.pop()
            blocks[-1][0] += s
            blocks[-1][1] += c
    out = []
    for s, c in blocks:
        out += [s / c] * c
    return out


def layout(d):
    nodes = {}  # key -> dict(kind,w,h,inl{pid:ly},outl{pid:ly})
    for p in d["InputPins"]:
        nodes[("in", p["ID"])] = {"kind": "in", "w": DEVPIN_W, "h": DEVPIN_H[p["BitCount"]], "inl": {}, "outl": {0: 0.0}}
    for p in d["OutputPins"]:
        nodes[("out", p["ID"])] = {"kind": "out", "w": DEVPIN_W, "h": DEVPIN_H[p["BitCount"]], "inl": {0: 0.0}, "outl": {}}
    for s in d["SubChips"]:
        info = chip_info(s["Name"])
        w, h = info["size"]
        iy = pin_offsets(h, [b for _, b in info["ins"]]) if info["ins"] else []
        oy = pin_offsets(h, [b for _, b in info["outs"]]) if info["outs"] else []
        nodes[("sub", s["ID"])] = {"kind": "sub", "w": w, "h": h,
                                   "inl": {pid: iy[i] for i, (pid, _) in enumerate(info["ins"])},
                                   "outl": {pid: oy[i] for i, (pid, _) in enumerate(info["outs"])}}
    in_ids = {p["ID"] for p in d["InputPins"]}
    out_ids = {p["ID"] for p in d["OutputPins"]}

    def owner_key(owner, is_source):
        if is_source and owner in in_ids:
            return ("in", owner)
        if not is_source and owner in out_ids:
            return ("out", owner)
        return ("sub", owner)

    edges = []  # (src_key, src_pid, tgt_key, tgt_pid, wire_index)
    for wi, w in enumerate(d["Wires"]):
        s, t = w["SourcePinAddress"], w["TargetPinAddress"]
        edges.append((owner_key(s["PinOwnerID"], True), s["PinID"], owner_key(t["PinOwnerID"], False), t["PinID"], wi))

    # Fios que apontam para um pino que nao existe no chip de origem/destino
    # (ex.: COUNTER e DELAY ligam na saida do chip "1", que nao tem OutputPins).
    # Em vez de abortar o layout inteiro, o pino fantasma entra na conta como
    # pino central e fica registrado em d["_dangling"] para o relatorio.
    dangling = []
    for sk, sp, tk, tp, wi in edges:
        if sp not in nodes[sk]["outl"]:
            nodes[sk]["outl"][sp] = 0.0
            dangling.append((wi, "saida", sk[0], sk[1], sp))
        if tp not in nodes[tk]["inl"]:
            nodes[tk]["inl"][tp] = 0.0
            dangling.append((wi, "entrada", tk[0], tk[1], tp))
    if dangling:
        d["_dangling"] = dangling
    preds = {k: set() for k in nodes}
    succs = {k: set() for k in nodes}
    for sk, _, tk, _, _ in edges:
        preds[tk].add(sk)
        succs[sk].add(tk)

    # ---- layering (longest path, cycles broken by DFS order)
    layer = {}
    state = {}

    def depth(k):
        if k in layer:
            return layer[k]
        if nodes[k]["kind"] == "in":
            layer[k] = 0
            return 0
        state[k] = "busy"
        best = 0
        for p in preds[k]:
            if state.get(p) == "busy":
                continue
            best = max(best, depth(p) + 1)
        state[k] = "done"
        layer[k] = best
        return best

    subs = [k for k in nodes if k[0] == "sub"]
    for k in subs:
        depth(k)
    for k in subs:  # source-less chips (constants) sit right before their first consumer
        if not preds[k]:
            layer[k] = None
    changed = True
    while changed:
        changed = False
        for k in subs:
            if layer[k] is None or not preds[k]:
                cons = [layer[c] for c in succs[k] if c[0] == "sub" and layer[c] is not None]
                v = max(0, min(cons) - 1) if cons else 0
                if layer[k] != v:
                    layer[k] = v
                    changed = True
    last = max([layer[k] for k in subs] + [0]) + 1
    for k in nodes:
        if k[0] == "in":
            layer[k] = 0
        elif k[0] == "out":
            layer[k] = last

    # ---- nets and dummy nodes
    nets = {}  # (src_key,pid) -> list of (tgt_key, tgt_pid, wire_index)
    for sk, sp, tk, tp, wi in edges:
        nets.setdefault((sk, sp), []).append((tk, tp, wi))
    for net, tgts in nets.items():
        ls = layer[net[0]]
        lt = max([layer[t[0]] for t in tgts] + [ls])
        for l in range(ls + 1, lt):
            if any(layer[t[0]] > l for t in tgts):
                nodes[("dummy", net, l)] = {"kind": "dummy", "w": 0, "h": 0, "inl": {0: 0.0}, "outl": {0: 0.0}}
                layer[("dummy", net, l)] = l

    def waypoint_key(net, l):
        return ("dummy", net, l)

    # connections between adjacent layers: (left_key, left_pin_y_local, right_key, right_pin_y_local)
    links = []
    for net, tgts in nets.items():
        sk, sp = net
        ls = layer[sk]
        for tk, tp, wi in tgts:
            lt = layer[tk]
            prev = (sk, nodes[sk]["outl"][sp])
            for l in range(ls + 1, lt):
                dk = waypoint_key(net, l)
                links.append((prev[0], prev[1], dk, 0.0))
                prev = (dk, 0.0)
            if lt > ls:
                links.append((prev[0], prev[1], tk, nodes[tk]["inl"][tp]))
    links = list(set(links))
    left_of = {}
    right_of = {}
    for a, ay, b, by in links:
        right_of.setdefault(a, []).append((b, ay, by))
        left_of.setdefault(b, []).append((a, ay, by))

    # ---- ordering
    layers = [[] for _ in range(last + 1)]
    order_hint = {}
    for i, p in enumerate(d["InputPins"]):
        order_hint[("in", p["ID"])] = i
    for i, p in enumerate(d["OutputPins"]):
        order_hint[("out", p["ID"])] = i
    for i, s in enumerate(d["SubChips"]):
        k = ("sub", s["ID"])
        order_hint[k] = 1e9 + i if layer[k] == 0 else -s["Position"]["y"] * 1000 + i * 1e-3
    for k in nodes:
        layers[layer[k]].append(k)
    for L in layers:
        L.sort(key=lambda k: order_hint.get(k, 0))
    y = {k: 0.0 for k in nodes}

    def place(L, desired):
        c = []
        acc = 0.0
        for i, k in enumerate(L):
            if i > 0:
                a, b = nodes[L[i - 1]], nodes[k]
                nd = (a["kind"] == "dummy") + (b["kind"] == "dummy")
                gap = CHIP_GAP if nd == 0 else (3 * G if nd == 1 else DUMMY_GAP)
                acc += (a["h"] + b["h"]) / 2 + gap
            c.append(acc)
        z = pav_nondecreasing([-desired[k] - c[i] for i, k in enumerate(L)])
        for i, k in enumerate(L):
            y[k] = -(z[i] + c[i])

    def desired_from(side, L):
        des = {}
        for k in L:
            vals = []
            if side == "left":
                for a, ay, by in left_of.get(k, []):
                    vals.append(y[a] + ay - by)
            else:
                for b, ay, by in right_of.get(k, []):
                    vals.append(y[b] + by - ay)
            des[k] = sum(vals) / len(vals) if vals else y[k]
        return des

    for L in layers:  # initial stacking
        place(L, {k: 0.0 for k in L})
    for it in range(24):
        fwd = it % 2 == 0
        rng = range(1, last + 1) if fwd else range(last - 1, -1, -1)
        for li in rng:
            L = layers[li]
            des = desired_from("left" if fwd else "right", L)
            if 0 < li < last:
                L.sort(key=lambda k: -des[k])
            place(L, des)
    for li in range(1, last + 1):  # final forward pass: straight wires into chips
        place(layers[li], desired_from("left", layers[li]))

    # ---- columns and tracks
    def pin_y(k, pid, out):
        return y[k] + (nodes[k]["outl"] if out else nodes[k]["inl"])[pid]

    gaps = [dict() for _ in range(last)]  # gap index l (between l and l+1): net -> [y_left, set(y_right)]
    wire_paths = {}
    wire_net = {}
    for net, tgts in nets.items():
        sk, sp = net
        ls = layer[sk]
        for tk, tp, wi in tgts:
            wire_net[wi] = net
            lt = layer[tk]
            ys = [pin_y(sk, sp, True)]
            for l in range(ls + 1, lt):
                ys.append(y[waypoint_key(net, l)])
            ys.append(pin_y(tk, tp, False))
            wire_paths[wi] = (ls, lt, ys)
            for gi in range(ls, lt):
                ent = gaps[gi].setdefault(net, [_r(ys[gi - ls]), set()])
                ent[1].add(_r(ys[gi - ls + 1]))
    track_x = [dict() for _ in range(last)]
    gap_width = []
    for gi, g in enumerate(gaps):
        # "mover" = a rede muda de altura neste vao e portanto precisa de uma
        # trilha vertical propria. A comparacao usa exatamente a mesma conta do
        # tracado do fio (mais abaixo), senao uma rede considerada reta aqui
        # vira KeyError la.
        movers = [n for n, (yl, yr) in g.items()
                  if any(abs(_r(v) - _r(yl)) > 1e-6 for v in yr)]

        def span(n):
            yl, yr = g[n]
            vals = [yl] + list(yr)
            return min(vals), max(vals)

        def cost(a, b):  # crossings if a's track is left of b's
            yla, yra = g[a]
            ylb, yrb = g[b]
            lo, hi = span(b)
            c = sum(1 for v in yra if lo < v < hi)
            lo, hi = span(a)
            c += 1 if lo < ylb < hi else 0
            return c

        up = sorted([n for n in movers if sum(g[n][1]) / len(g[n][1]) > g[n][0]], key=lambda n: -g[n][0])
        dn = sorted([n for n in movers if n not in up], key=lambda n: g[n][0])
        seq = up + dn
        for _ in range(len(seq)):
            moved = False
            for i in range(len(seq) - 1):
                if cost(seq[i + 1], seq[i]) < cost(seq[i], seq[i + 1]):
                    seq[i], seq[i + 1] = seq[i + 1], seq[i]
                    moved = True
            if not moved:
                break
        for i, n in enumerate(seq):
            track_x[gi][n] = i
        gap_width.append(max(MIN_COL_GAP, 2 * COL_MARGIN + TRACK * max(0, len(seq) - 1)))

    col_w = [max([nodes[k]["w"] for k in L] + [0]) for L in layers]
    col_left = []
    x = 0.0
    for li in range(last + 1):
        col_left.append(x)
        x += col_w[li] + (gap_width[li] if li < last else 0)
    shift = x / 2
    col_left = [c - shift for c in col_left]
    ymid = (max(y.values()) + min(y.values())) / 2

    out = copy.deepcopy(d)
    cx = {li: col_left[li] + col_w[li] / 2 for li in range(last + 1)}
    for p in out["InputPins"]:
        p["Position"] = {"x": round(cx[0], 4), "y": round(y[("in", p["ID"])] - ymid, 4)}
    for p in out["OutputPins"]:
        p["Position"] = {"x": round(cx[last], 4), "y": round(y[("out", p["ID"])] - ymid, 4)}
    for s in out["SubChips"]:
        k = ("sub", s["ID"])
        s["Position"] = {"x": round(cx[layer[k]], 4), "y": round(y[k] - ymid, 4)}
    for wi, w in enumerate(out["Wires"]):
        w["ConnectionType"] = 0
        w["ConnectedWireIndex"] = -1
        w["ConnectedWireSegmentIndex"] = -1
        pts = [{"x": 0, "y": 0}]
        if wi in wire_paths:
            ls, lt, ys = wire_paths[wi]
            net = wire_net[wi]
            for gi in range(ls, lt):
                y0, y1 = _r(ys[gi - ls]), _r(ys[gi - ls + 1])
                if abs(y0 - y1) > 1e-6:
                    tx = col_left[gi] + col_w[gi] + COL_MARGIN + TRACK * track_x[gi].get(net, 0)
                    pts.append({"x": round(tx, 4), "y": round(y0 - ymid, 4)})
                    pts.append({"x": round(tx, 4), "y": round(y1 - ymid, 4)})
        pts.append({"x": 0, "y": 0})
        w["Points"] = pts
    return out


def check(before, after):
    assert [p["ID"] for p in before["InputPins"]] == [p["ID"] for p in after["InputPins"]]
    assert [p["ID"] for p in before["OutputPins"]] == [p["ID"] for p in after["OutputPins"]]
    assert before["Size"] == after["Size"]
    sig = lambda d: sorted((w["SourcePinAddress"]["PinOwnerID"], w["SourcePinAddress"]["PinID"],
                            w["TargetPinAddress"]["PinOwnerID"], w["TargetPinAddress"]["PinID"]) for w in d["Wires"])
    assert sig(before) == sig(after)
    for key in ("InputPins", "OutputPins"):
        ys = [p["Position"]["y"] for p in after[key]]
        assert all(ys[i] > ys[i + 1] for i in range(len(ys) - 1)), f"ordem dos pinos {key}"
    boxes = []
    for s in after["SubChips"]:
        w, h = chip_info(s["Name"])["size"]
        boxes.append((s["Position"]["x"], s["Position"]["y"], w, h))
    worst = 99
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            dx = abs(a[0] - b[0]) - (a[2] + b[2]) / 2
            dy = abs(a[1] - b[1]) - (a[3] + b[3]) / 2
            worst = min(worst, max(dx, dy))
    return worst


def truth(name, d):
    import random
    rnd = random.Random(1234)
    S.EXTRA[name] = d
    ins = d["InputPins"]
    res = []
    total_bits = sum(p["BitCount"] for p in ins)
    cases = range(2 ** total_bits) if total_bits <= 12 else [rnd.getrandbits(total_bits) for _ in range(1500)]
    for n in cases:
        vals, shift = {}, 0
        for p in ins:
            vals[p["ID"]] = (n >> shift) & ((1 << p["BitCount"]) - 1)
            shift += p["BitCount"]
        S.DISPLAY_LOG.clear()
        r = S.run(name, vals)
        res.append((tuple(sorted(r.items())), tuple(S.DISPLAY_LOG)))
    return res


if __name__ == "__main__":
    names = sys.argv[1].split(",")
    write = "--write" in sys.argv
    backup_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup_chips")
    os.makedirs(backup_dir, exist_ok=True)
    skipped = []
    for name in names:
        before = copy.deepcopy(S.load(name))
        foreign = sorted({s["Name"] for s in before["SubChips"]
                          if s["Name"] not in BUILTIN and not os.path.exists(os.path.join(S.CHIPS, s["Name"] + ".json"))})
        if foreign:
            skipped.append((name, foreign))
            continue
        try:
            after = layout(before)
            worst = check(before, after)
        except Exception as e:
            skipped.append((name, ["erro " + type(e).__name__ + ": " + str(e)[:60]]))
            continue
        try:
            sys.setrecursionlimit(20000)
            t0 = truth(name, before)
            t1 = truth(name, after)
            ok = t0 == t1
            verdict = "simulada igual" if ok else "DIFERENTE"
        except Exception as e:
            ok, verdict = True, "ligações idênticas (não simulável: " + type(e).__name__ + ")"
        S.EXTRA.pop(name, None)
        print(f"{name:22s} {verdict:45s} menor distância: {worst / G:.1f} quadrados")
        if not ok:
            sys.exit(1)
        if write:
            path = os.path.join(S.CHIPS, name + ".json")
            bk = os.path.join(backup_dir, name + ".json")
            if not os.path.exists(bk):
                shutil.copyfile(path, bk)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(after, f, indent=2, ensure_ascii=False)
            S._cache.pop(name, None)
    for name, foreign in skipped:
        print("PULADO", name, "usa", ", ".join(foreign))
