"""Passagem "espaco invisivel", de baixo para cima na arvore de dependencia.

Para cada chip customizado, nesta ordem:
  1. autolayout.layout()      -> colunas/fios com os tamanhos JA corrigidos dos filhos;
  2. colorize.apply()         -> cores por rede (idempotente);
  3. arrumar Displays         -> o conjunto de displays sobe para uma faixa no topo,
                                 mantendo o arranjo relativo (linha de digitos, grade
                                 de LEDs); e o que aparece quando o chip vira bloco;
  4. Size = caixa que abraça TUDO (subchips + fios + displays + minimo legal do DLS).

So Position/Points/Colour/Size/Displays mudam; o netlist e conferido ponta a ponta
antes de gravar. Filhos antes dos pais (niveis topologicos), porque o layout do pai
usa o Size do filho.

  python tools/ai_style/bodyfit.py --names "DISPLAY DECIMAL,BIN2BCD-8" --write
  python tools/ai_style/bodyfit.py --all --write --jobs 10
  python tools/ai_style/bodyfit.py --all                 # dry-run
"""

import argparse
import copy
import json
import math
import os
import shutil
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import autolayout as A   # noqa: E402
import colorize as C     # noqa: E402
import dlssim as S       # noqa: E402

G = 0.125
MARGIN = 2 * G

# Vitrine ajustada a mao (faixa de nome + digitos dentro do corpo).
SKIP = {"TESTE DISPLAY"}


def ceil_grid(v):
    return round(math.ceil(v / G - 1e-9) * G, 6)


def pin_row_height(d):
    grids = {1: 2, 4: 3, 8: 4}

    def side(pins):
        if not pins:
            return 0.0
        return sum(grids.get(p.get("BitCount", 1), 4) for p in pins) * G
    return max(side(d["InputPins"]), side(d["OutputPins"]))


def min_size(d):
    """Piso do DLS (DescriptionCreator.CalculateMinChipSize)."""
    name = d.get("Name", "")
    multi = len(name) > 6 and " " in name
    w = max(len(name) * 0.62 * 0.25 + G, 0.375)
    h = max(pin_row_height(d), G * (4 if multi else 3))
    return w, h


# Builtins que SAO display: fator (largura, altura) em funcao da Scale.
DISPLAY_BUILTIN = {"7-SEGMENT": (1.0, 1.75), "LED": (1.0, 1.0),
                   "RGB DISPLAY": (1.0, 1.0), "DOT DISPLAY": (1.0, 1.0)}


def walk_displays(desc, origin, psc, out):
    """Instancias de display como o bloco as mostra (posicao relativa ao chip),
    repetindo DevSceneDrawer.DrawDisplay recursivamente."""
    for x in (desc.get("Displays") or []):
        px = origin[0] + x["Position"]["x"] * psc
        py = origin[1] + x["Position"]["y"] * psc
        s = x["Scale"] * psc
        child = next((q for q in desc.get("SubChips", [])
                      if q["ID"] == x.get("SubChipID")), None)
        if child is None:
            continue
        if child["Name"] in DISPLAY_BUILTIN:
            f = DISPLAY_BUILTIN[child["Name"]]
            out.append((px, py, s * f[0], s * f[1]))
        elif child["Name"] not in A.BUILTIN:
            walk_displays(S.load(child["Name"]), (px, py), s, out)


def block_displays(d):
    out = []
    walk_displays(d, (0.0, 0.0), 1.0, out)
    return out


def content_bbox(d):
    pts = []
    for s in d["SubChips"]:
        w, h = A.chip_info(s["Name"])["size"]
        pts += [(s["Position"]["x"] - w / 2, s["Position"]["y"] - h / 2),
                (s["Position"]["x"] + w / 2, s["Position"]["y"] + h / 2)]
    for w in d["Wires"]:
        for p in w.get("Points", []):
            if p["x"] or p["y"]:
                pts.append((p["x"], p["y"]))
    for px, py, w, h in block_displays(d):
        pts += [(px - w / 2, py - h / 2), (px + w / 2, py + h / 2)]
    if not pts:
        pts = [(0.0, 0.0)]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), max(xs), min(ys), max(ys)


def name_band(d):
    """Altura da faixa de nome quando NameLocation=Top (2 linhas se o nome nao
    cabe numa)."""
    if int(d.get("NameLocation", 0)) != 1:
        return 0.0
    name = d.get("Name", "")
    lines = 2 if (len(name) > 6 and " " in name) else 1
    return G + 0.25 * 1.05 * lines


def fit_size(d):
    """Corpo = o que aparece no bloco, e nada mais.

    * chip com displays: o corpo abraça exatamente os displays -- o DLS recorta
      (BeginMaskScope) tudo que cai fora do Size, entao corpo menor corta digito
      e corpo maior vira moldura vazia;
    * chip sem displays: o minimo legal do DLS (nome + fileiras de pinos). O
      conteudo logico nao aparece no bloco de qualquer forma, entao corpo grande
      seria so espaco vazio colorido.
    """
    mw, mh = min_size(d)
    mh = max(mh, name_band(d))
    disps = block_displays(d)
    if disps:
        xs = [px - w / 2 for px, py, w, h in disps] + [px + w / 2 for px, py, w, h in disps]
        ys = [py - h / 2 for px, py, w, h in disps] + [py + h / 2 for px, py, w, h in disps]
        return (ceil_grid(max(max(xs) - min(xs) + 2 * MARGIN, mw)),
                ceil_grid(max(max(ys) - min(ys) + 2 * MARGIN + name_band(d), mh)))
    return ceil_grid(mw), ceil_grid(mh)


def restyle_displays(d):
    """Centra o conjunto de displays na origem do chip, mantendo o arranjo
    relativo (linha de digitos, grade de LEDs). O corpo depois abraça exatamente
    esse conjunto. Translacao rigida das entradas de primeiro nivel; displays
    aninhados em subchip customizado acompanham o proprio conjunto."""
    if not d.get("Displays"):
        return False
    es = d["Displays"]
    xs = [e["Position"]["x"] for e in es]
    ys = [e["Position"]["y"] for e in es]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    ty = -name_band(d) / 2  # abaixo da faixa de nome, se houver
    if abs(cx) < 1e-9 and abs(cy - ty) < 1e-9:
        return False
    for e in es:
        e["Position"] = {"x": round(e["Position"]["x"] - cx, 4),
                         "y": round(e["Position"]["y"] - cy + ty, 4)}
    return True


def netlist_sig(d):
    return [(w["SourcePinAddress"]["PinOwnerID"], w["SourcePinAddress"]["PinID"],
             w["TargetPinAddress"]["PinOwnerID"], w["TargetPinAddress"]["PinID"])
            for w in d["Wires"]]


def identity_sig(d):
    return ([p["ID"] for p in d["InputPins"]], [p["ID"] for p in d["OutputPins"]],
            [s["ID"] for s in d["SubChips"]],
            [(p["ID"], p["BitCount"], p["Name"]) for p in d["InputPins"]],
            [(p["ID"], p["BitCount"], p["Name"]) for p in d["OutputPins"]],
            [(s["ID"], s["Name"]) for s in d["SubChips"]])


_EXIST = None


def exist_set():
    global _EXIST
    if _EXIST is None:
        _EXIST = {f[:-5] for f in os.listdir(S.CHIPS) if f.endswith(".json")}
    return _EXIST


def process(name, write, backup_dir, do_layout):
    S._cache.clear()
    path = os.path.join(S.CHIPS, name + ".json")
    try:
        with open(path, encoding="utf-8-sig") as f:
            before = json.load(f)
    except Exception as e:
        return {"name": name, "status": "read-error", "err": str(e)[:80]}
    if before.get("ChipType", 0) != 0 or name in SKIP:
        return {"name": name, "status": "skipped", "why": "builtin/vitrine"}
    foreign = sorted({s["Name"] for s in before.get("SubChips", [])
                      if s["Name"] not in A.BUILTIN and s["Name"] not in exist_set()})
    if foreign:
        return {"name": name, "status": "skipped", "why": "subchip ausente"}

    try:
        if do_layout:
            after = A.layout(copy.deepcopy(before))
            after.pop("_dangling", None)
            C.apply(after)
        else:
            after = copy.deepcopy(before)
        restyle_displays(after)
        nx, ny = fit_size(after)
        after["Size"] = {"x": nx, "y": ny}
        if netlist_sig(after) != netlist_sig(before):
            raise AssertionError("netlist mudou")
        if identity_sig(after) != identity_sig(before):
            raise AssertionError("identidade mudou")
    except RecursionError:
        return {"name": name, "status": "skipped", "why": "recursao profunda"}
    except Exception as e:
        return {"name": name, "status": "error", "err": f"{type(e).__name__}: {e}"[:120]}

    old = (before["Size"]["x"], before["Size"]["y"])
    if not do_layout and abs(nx - old[0]) < 1e-9 and abs(ny - old[1]) < 1e-9 \
            and before["Displays"] == after["Displays"]:
        return {"name": name, "status": "unchanged"}
    if write:
        bk = os.path.join(backup_dir, name + ".json")
        if not os.path.exists(bk):
            shutil.copyfile(path, bk)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(after, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    area0 = old[0] * old[1]
    area1 = nx * ny
    return {"name": name, "status": "ok", "old": old, "new": (nx, ny),
            "ratio": round(area1 / area0, 2) if area0 else 0.0}


def levels(names):
    exist = set(names)
    deps = {}
    for n in names:
        try:
            deps[n] = {s["Name"] for s in S.load(n).get("SubChips", [])} & exist - {n}
        except Exception:
            deps[n] = None
    done, out = set(), []
    remaining = [n for n in names if deps[n] is not None]
    broken = [n for n in names if deps[n] is None]
    while remaining:
        lvl = [n for n in remaining if deps[n] <= done]
        if not lvl:
            lvl = [sorted(remaining)[0]]
        out.append(lvl)
        done |= set(lvl)
        remaining = [n for n in remaining if n not in done]
    if broken:
        out.append(broken)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--names", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--no-layout", action="store_true", help="so Displays+Size")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()

    all_names = sorted(f[:-5] for f in os.listdir(S.CHIPS) if f.endswith(".json"))
    if args.names:
        names = [n for n in args.names.split(",") if n in set(all_names)]
    else:
        names = all_names
        if args.limit:
            names = names[:args.limit]
    backup_dir = os.path.join(HERE, "backup_refit")
    os.makedirs(backup_dir, exist_ok=True)

    lv = levels(names)
    print(f"{len(names)} chips em {len(lv)} niveis | " +
          ("GRAVANDO" if args.write else "dry-run") +
          (" | so Size/Displays" if args.no_layout else " | layout completo"), flush=True)
    t0 = time.time()
    stats = {"ok": 0, "unchanged": 0, "skipped": 0, "error": 0, "read-error": 0}
    ratios, examples, errors = [], [], []
    done = 0
    for li, lvl in enumerate(lv):
        with ProcessPoolExecutor(max_workers=args.jobs) as ex:
            futs = [ex.submit(process, n, args.write, backup_dir, not args.no_layout)
                    for n in lvl]
            for fut in as_completed(futs):
                r = fut.result()
                stats[r["status"]] = stats.get(r["status"], 0) + 1
                if r["status"] == "ok":
                    ratios.append(r["ratio"])
                    if len(examples) < 10:
                        examples.append(r)
                elif r["status"] in ("error", "read-error"):
                    errors.append((r["name"], r.get("err")))
                done += 1
        print(f"  nivel {li + 1}/{len(lv)}: {len(lvl)} chips | ok={stats['ok']} "
              f"igual={stats['unchanged']} skip={stats['skipped']} err={stats['error']}",
              flush=True)
    el = time.time() - t0
    ratios.sort()
    q = lambda p: ratios[min(len(ratios) - 1, int(len(ratios) * p))] if ratios else 0
    print(f"\ntempo {el:.0f}s | ok={stats['ok']} igual={stats['unchanged']} "
          f"skip={stats['skipped']} err={stats['error'] + stats['read-error']}")
    if ratios:
        print(f"  area do corpo vs antes: p5={q(0.05):.2f} mediana={q(0.5):.2f} "
              f"p95={q(0.95):.2f} max={ratios[-1]:.2f}")
    for r in examples:
        print("   %-26s %6.2fx%6.2f -> %6.2fx%6.2f  (x%.2f)"
              % (r["name"], r["old"][0], r["old"][1], r["new"][0], r["new"][1], r["ratio"]))
    for n, e in errors[:20]:
        print("   ERRO", n, e)


if __name__ == "__main__":
    main()
