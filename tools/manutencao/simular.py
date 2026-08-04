#!/usr/bin/env python3
"""
Simulador de chips do UMBRA LIMA ALFA, usado como rede de seguranca da
manutencao: captura o comportamento de um conjunto de chips antes e depois de
uma alteracao e compara.

Le os JSON exatamente como o Digital Logic Sim leria e resolve cada chip
customizado recursivamente ate os chips embutidos.

Uso:
    python3 tools/manutencao/simular.py captura  antes.json  CHIP [CHIP ...]
    python3 tools/manutencao/simular.py compara  antes.json  depois.json
"""

from __future__ import annotations

import itertools
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHIPS = os.path.join(ROOT, "Chips")

# Chips embutidos puramente combinacionais que sabemos simular.
# Os pinos de um embutido sao indices sequenciais: entradas 0..n-1, saidas n..
BUILTIN = {
    "NAND":   {"in": [0, 1],                   "out": [2]},
    "4-1BIT": {"in": [0],                      "out": [1, 2, 3, 4]},
    "1-4BIT": {"in": [0, 1, 2, 3],             "out": [4]},
    "8-1BIT": {"in": [0],                      "out": list(range(1, 9))},
    "1-8BIT": {"in": list(range(8)),           "out": [8]},
    "8-4BIT": {"in": [0],                      "out": [1, 2]},
    "4-8BIT": {"in": [0, 1],                   "out": [2]},
}

_cache: dict[str, dict] = {}


def chip(name):
    if name not in _cache:
        with open(os.path.join(CHIPS, name + ".json"), encoding="utf-8") as f:
            _cache[name] = json.load(f)
    return _cache[name]


def pins(name):
    if name in BUILTIN:
        return BUILTIN[name]
    d = chip(name)
    return {"in": [p["ID"] for p in d["InputPins"]],
            "out": [p["ID"] for p in d["OutputPins"]]}


def builtin_eval(name, ins):
    if name == "NAND":
        return [1 - (ins[0] & ins[1])]
    if name in ("8-1BIT", "4-1BIT"):
        n = 8 if name == "8-1BIT" else 4
        return [(ins[0] >> (n - 1 - i)) & 1 for i in range(n)]
    if name in ("1-8BIT", "1-4BIT"):
        n = 8 if name == "1-8BIT" else 4
        v = 0
        for i, b in enumerate(ins):
            v |= (b & 1) << (n - 1 - i)
        return [v]
    if name == "8-4BIT":
        return [(ins[0] >> 4) & 0xF, ins[0] & 0xF]
    if name == "4-8BIT":
        return [((ins[0] & 0xF) << 4) | (ins[1] & 0xF)]
    raise KeyError(name)


class Unsupported(Exception):
    """Chip usa um embutido sequencial/nao suportado."""


def simulate(name, inputs):
    d = chip(name)
    subs = {s["ID"]: s for s in d.get("SubChips") or []}
    drv = {}
    for w in d.get("Wires") or []:
        s, t = w["SourcePinAddress"], w["TargetPinAddress"]
        drv[(t["PinOwnerID"], t["PinID"])] = (s["PinOwnerID"], s["PinID"])

    val = {}
    for p, v in zip(d["InputPins"], inputs):
        val[(p["ID"], 0)] = v
    done, stack = set(), set()

    def src(k):
        if k in val:
            return val[k]
        if k[0] in subs:
            ev(k[0])
            return val.get(k, 0)
        return 0

    def inp(k):
        return src(drv[k]) if k in drv else 0

    def ev(sid):
        if sid in done:
            return
        if sid in stack:
            raise Unsupported("ciclo combinacional")
        stack.add(sid)
        s = subs[sid]
        nm = s["Name"]
        if nm not in BUILTIN and not os.path.exists(
                os.path.join(CHIPS, nm + ".json")):
            raise Unsupported(f"embutido nao suportado: {nm}")
        pn = pins(nm)
        iv = [inp((sid, p)) for p in pn["in"]]
        ov = builtin_eval(nm, iv) if nm in BUILTIN else simulate(nm, iv)
        for p, v in zip(pn["out"], ov):
            val[(sid, p)] = v
        stack.discard(sid)
        done.add(sid)

    return [inp((p["ID"], 0)) for p in d["OutputPins"]]


def cases_for(name, limit=256):
    d = chip(name)
    bits = [p["BitCount"] for p in d["InputPins"]]
    if not bits:
        return [()]
    total = 1
    for b in bits:
        total *= (1 << b)
        if total > limit:
            break
    if total <= limit:
        return list(itertools.product(*[range(1 << b) for b in bits]))
    # Espaco grande demais: amostragem determinista.
    out = []
    for k in range(limit):
        case = []
        for i, b in enumerate(bits):
            m = (1 << b) - 1
            case.append((k * (i * 37 + 1) + i * 11) & m)
        out.append(tuple(case))
    return out


def capture(names, limit=256):
    snap = {}
    for n in names:
        try:
            snap[n] = {"cases": [[list(c), simulate(n, list(c))]
                                 for c in cases_for(n, limit)]}
        except Unsupported as e:
            snap[n] = {"skipped": str(e)}
        except Exception as e:
            snap[n] = {"error": f"{type(e).__name__}: {e}"}
    return snap


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    mode = sys.argv[1]

    if mode == "captura":
        args = sys.argv[3:]
        limit = 256
        if args and args[0].startswith("--limit="):
            limit = int(args[0].split("=", 1)[1])
            args = args[1:]
        out = sys.argv[2]
        # "todos" captura o projeto inteiro (os nao suportados sao pulados).
        names = (sorted(f[:-5] for f in os.listdir(CHIPS) if f.endswith(".json"))
                 if args == ["todos"] else args)
        snap = capture(names, limit)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(snap, f)
        ok = sum(1 for v in snap.values() if "cases" in v)
        sk = sum(1 for v in snap.values() if "skipped" in v)
        er = sum(1 for v in snap.values() if "error" in v)
        print(f"capturados {ok} chip(s), {sk} pulado(s), {er} com erro -> {out}")
        for n, v in snap.items():
            if "cases" in v:
                print(f"   {n:<28} {len(v['cases'])} casos")
            else:
                print(f"   {n:<28} {v.get('skipped') or v.get('error')}")
        return 0

    if mode == "compara":
        a = json.load(open(sys.argv[2], encoding="utf-8"))
        b = json.load(open(sys.argv[3], encoding="utf-8"))
        diff = []
        for n in sorted(set(a) | set(b)):
            va, vb = a.get(n), b.get(n)
            if va is None or vb is None:
                diff.append(f"{n}: presente em apenas um dos lados")
                continue
            if "cases" not in va or "cases" not in vb:
                continue
            if va["cases"] != vb["cases"]:
                bad = [(x, y) for x, y in zip(va["cases"], vb["cases"]) if x != y]
                diff.append(f"{n}: {len(bad)} caso(s) divergentes, "
                            f"ex.: {bad[0] if bad else '?'}")
        if diff:
            print("DIVERGENCIAS:")
            for d in diff:
                print("  -", d)
            return 1
        n = sum(1 for v in a.values() if "cases" in v)
        tot = sum(len(v["cases"]) for v in a.values() if "cases" in v)
        print(f"COMPORTAMENTO IDENTICO — {n} chip(s), {tot} casos conferidos")
        return 0

    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
