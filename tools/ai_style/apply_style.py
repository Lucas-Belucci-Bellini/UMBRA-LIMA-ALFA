"""Aplica o estilo "feito por IA" em todo o catálogo do UMBRA LIMA ALFA.

Pipeline por chip:
  1. autolayout.layout()  -> colunas por profundidade de sinal, folga >= 5
     quadrados, fios ortogonais uma trilha por rede em cada vão.
  2. colorize.apply()     -> uma cor por sinal na origem da rede (pinos de
     entrada), como nas capturas de referência.
  3. verify()             -> PROVA estrutural de que a lógica não mudou: o
     netlist (pontas dos fios), IDs, nomes, bitcounts, tamanho e dados internos
     têm que ser byte-a-byte idênticos; só posição, traçado do fio e cor podem
     diferir.
  4. --write              -> backup + gravação.

Uso:
  python tools/ai_style/apply_style.py --limit 60            # dry-run, amostra
  python tools/ai_style/apply_style.py --all --write         # catálogo inteiro
  python tools/ai_style/apply_style.py --names "ALU-8,ADD3" --write
"""

import argparse
import copy
import json
import os
import random
import shutil
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import autolayout as A  # noqa: E402
import colorize as C    # noqa: E402
import dlssim as S      # noqa: E402

# Campos que o redesenho tem PERMISSÃO de tocar. Tudo o mais tem que continuar
# idêntico -- é assim que se prova que o chip faz a mesma coisa sem simular.
MUTABLE = {
    "InputPins": {"Position", "Colour"},
    "OutputPins": {"Position"},
    "SubChips": {"Position"},
    "Wires": {"Points", "ConnectionType", "ConnectedWireIndex",
              "ConnectedWireSegmentIndex"},
}

G = 0.125


def strip_mutable(d):
    """Cópia normalizada: remove os campos que o estilo pode mudar."""
    out = {}
    for k, v in d.items():
        if k in MUTABLE and isinstance(v, list):
            out[k] = [{kk: vv for kk, vv in item.items() if kk not in MUTABLE[k]}
                      for item in v]
        else:
            out[k] = v
    return out


def verify(before, after):
    """Levanta se qualquer coisa além de posição/traçado/cor mudou."""
    if list(before.keys()) != list(after.keys()):
        raise AssertionError("conjunto de chaves do JSON mudou")
    if strip_mutable(before) != strip_mutable(after):
        raise AssertionError("netlist/identidade do chip mudou (não é só layout)")
    for key in ("InputPins", "OutputPins", "SubChips", "Wires"):
        if len(before.get(key, [])) != len(after.get(key, [])):
            raise AssertionError(f"{key}: contagem mudou")
        for b, a in zip(before.get(key, []), after.get(key, [])):
            if b.get("ID") != a.get("ID"):
                raise AssertionError(f"{key}: ordem/ID mudou")
    # as pontas dos fios, item por item
    sig = lambda d: [(w["SourcePinAddress"]["PinOwnerID"], w["SourcePinAddress"]["PinID"],
                      w["TargetPinAddress"]["PinOwnerID"], w["TargetPinAddress"]["PinID"])
                     for w in d["Wires"]]
    if sig(before) != sig(after):
        raise AssertionError("alguma ligação foi reordenada ou trocada")
    return True


def min_gap_squares(d):
    """Menor distância entre dois subchips, em quadrados da grade."""
    boxes = []
    for s in d["SubChips"]:
        w, h = A.chip_info(s["Name"])["size"]
        boxes.append((s["Position"]["x"], s["Position"]["y"], w, h))
    worst = 99.0
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            dx = abs(a[0] - b[0]) - (a[2] + b[2]) / 2
            dy = abs(a[1] - b[1]) - (a[3] + b[3]) / 2
            worst = min(worst, max(dx, dy) / G)
    return worst


def foreign_subchips(d):
    exist = {f[:-5] for f in os.listdir(S.CHIPS) if f.endswith(".json")}
    return sorted({s["Name"] for s in d["SubChips"]
                   if s["Name"] not in exist and s["Name"] not in A.BUILTIN})


def truth_signature(name, d, budget=4096):
    """Saídas para todas as entradas (ou amostra, se o espaço for grande)."""
    S._memo.clear()
    ins = d["InputPins"]
    total_bits = sum(p["BitCount"] for p in ins)
    rnd = random.Random(20261106)
    if total_bits <= 12:
        cases = range(1 << total_bits)
    else:
        cases = [rnd.getrandbits(total_bits) for _ in range(budget)]
    res = []
    S.EXTRA[name] = d
    try:
        for n in cases:
            vals, shift = {}, 0
            for p in ins:
                vals[p["ID"]] = (n >> shift) & ((1 << p["BitCount"]) - 1)
                shift += p["BitCount"]
            S.DISPLAY_LOG.clear()
            r = S.run(name, vals)
            res.append((tuple(sorted(r.items())), tuple(S.DISPLAY_LOG)))
    finally:
        S.EXTRA.pop(name, None)
    return hash(tuple(res))


def min_pin_height(d):
    """Altura que o corpo precisa ter para todos os pinos caberem dentro dele.

    Mesma conta de SubChipInstance.CalculateDefaultPinLayout: 2 grids por pino
    de 1 bit, 3 por pino de 4 bits, 4 por pino de 8 bits.
    """
    grids = {1: 2, 4: 3, 8: 4}

    def side(pins):
        if not pins:
            return 0.0
        return sum(grids.get(p.get("BitCount", 1), 4) for p in pins) * G

    return max(side(d["InputPins"]), side(d["OutputPins"]))


def fit_size(d):
    """Engrossa Size.y (nunca afina) ate os pinos caberem no corpo. Sem isso o
    DLS desenha pino fora do retangulo -- ex. MUX-16 com Size.y=4 e 20 pinos."""
    need = min_pin_height(d)
    old = d["Size"]["y"]
    if need <= old + 1e-9:
        return False
    d["Size"]["y"] = round(round(need / G) * G, 6)
    return True


def process_sizes(name, write, backup_dir):
    path = os.path.join(S.CHIPS, name + ".json")
    try:
        with open(path, encoding="utf-8-sig") as f:
            before = json.load(f)
    except Exception as e:
        return {"name": name, "status": "read-error", "err": f"{type(e).__name__}: {e}"}
    after = copy.deepcopy(before)
    if not fit_size(after):
        return {"name": name, "status": "unchanged"}
    # so o Size.y pode ter mudado
    after["Size"]["y"] = before["Size"]["y"]
    if before != after:
        return {"name": name, "status": "error", "err": "fit_size mexeu em mais que Size.y"}
    after = copy.deepcopy(before)
    grew = fit_size(after)
    if write and grew:
        bk = os.path.join(backup_dir, name + ".json")
        if not os.path.exists(bk):
            shutil.copyfile(path, bk)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(after, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    return {"name": name, "status": "ok", "from": before["Size"]["y"], "to": after["Size"]["y"]}


def process(name, write, do_truth, backup_dir):
    sys.setrecursionlimit(30000)
    path = os.path.join(S.CHIPS, name + ".json")
    try:
        with open(path, encoding="utf-8-sig") as f:
            before = json.load(f)
    except Exception as e:  # arquivo ilegável: intocável
        return {"name": name, "status": "read-error", "err": f"{type(e).__name__}: {e}"}

    if before.get("ChipType", 0) != 0:
        return {"name": name, "status": "skipped", "why": "builtin/nao-editavel"}

    foreign = foreign_subchips(before)
    if foreign:
        return {"name": name, "status": "skipped", "why": "subchip ausente: " + ",".join(foreign)}

    try:
        after = A.layout(copy.deepcopy(before))
        dangling = after.pop("_dangling", None)
        groups = C.apply(after)
        verify(before, after)
        worst = min_gap_squares(after)
        if do_truth:
            if truth_signature(name, before) != truth_signature(name, after):
                raise AssertionError("tabela-verdade mudou!")
    except RecursionError:
        return {"name": name, "status": "skipped", "why": "recursao profunda"}
    except Exception as e:
        return {"name": name, "status": "error", "err": f"{type(e).__name__}: {e}"[:160]}

    if write:
        bk = os.path.join(backup_dir, name + ".json")
        if not os.path.exists(bk):
            shutil.copyfile(path, bk)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(after, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)

    n_coloured = sum(1 for p in after["InputPins"] if p["Colour"])
    return {"name": name, "status": "ok", "gap": round(worst, 2),
            "subs": len(after["SubChips"]), "wires": len(after["Wires"]),
            "groups": len(groups), "coloured": n_coloured,
            "dangling": dangling or []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="catalogo inteiro")
    ap.add_argument("--names", help="lista separada por virgula")
    ap.add_argument("--limit", type=int, help="so os primeiros N (ordem aleatoria)")
    ap.add_argument("--write", action="store_true", help="gravar (sem isso: dry-run)")
    ap.add_argument("--truth", action="store_true", help="simular tabela-verdade (lento)")
    ap.add_argument("--phase", choices=["sizes", "style", "both"], default="style")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--report", default=os.path.join(HERE, "last-report.json"))
    args = ap.parse_args()

    all_names = sorted(f[:-5] for f in os.listdir(S.CHIPS) if f.endswith(".json"))
    if args.names:
        names = [n for n in args.names.split(",") if n in set(all_names)]
    elif args.all:
        names = all_names
    else:
        rnd = random.Random(7)
        names = sorted(rnd.sample(all_names, min(args.limit or 60, len(all_names))))
    if args.limit and args.all:
        names = names[:args.limit]

    backup_dir = os.path.join(HERE, "backup_chips")
    os.makedirs(backup_dir, exist_ok=True)

    mode = "GRAVANDO" if args.write else "dry-run"
    report = {"mode": mode, "phase": args.phase, "passes": []}

    def run_pass(label, runner, extra):
        print(f"{mode} | fase={label} | {len(names)} chips | {args.jobs} processos")
        t0 = time.time()
        stats, gaps, errors, skipped = {"ok": 0, "skipped": 0, "error": 0,
                                       "unchanged": 0}, [], [], []
        dangling = []
        done = 0
        with ProcessPoolExecutor(max_workers=args.jobs) as ex:
            futs = {ex.submit(runner, n, args.write, *extra): n for n in names}
            for fut in as_completed(futs):
                r = fut.result()
                stats[r["status"]] = stats.get(r["status"], 0) + 1
                if r["status"] == "ok":
                    if "gap" in r:
                        gaps.append(r["gap"])
                    if r.get("dangling"):
                        dangling.append((r["name"], len(r["dangling"])))
                elif r["status"] == "skipped":
                    skipped.append((r["name"], r["why"]))
                elif r["status"] == "error":
                    errors.append((r["name"], r["err"]))
                done += 1
                if done % 1000 == 0 or done == len(names):
                    el = time.time() - t0
                    print(f"  {done}/{len(names)}  ok={stats['ok']} skip={stats['skipped']} "
                          f"err={stats['error']} unchanged={stats['unchanged']} "
                          f"{done/el:.0f} chips/s", flush=True)
        el = time.time() - t0
        print(f"\n[{label}] tempo {el:.1f}s | ok={stats['ok']} "
              f"unchanged={stats['unchanged']} skip={stats['skipped']} err={stats['error']}")
        if gaps:
            gaps.sort()
            q = lambda p: gaps[min(len(gaps) - 1, int(len(gaps) * p))]
            print(f"  folga minima entre chips (quadrados): p5={q(0.05):.1f} "
                  f"mediana={q(0.5):.1f} p95={q(0.95):.1f} max={gaps[-1]:.1f}")
            print(f"  abaixo de 5 quadrados: {len([g for g in gaps if g < 4.9])}")
        if skipped:
            print("  PULADOS:", len(skipped))
            for n, w in skipped[:20]:
                print("    ", n, "->", w)
        if errors:
            print("  ERROS:", len(errors))
            for n, e in errors[:20]:
                print("    ", n, "->", e)
        if dangling:
            print(f"  FIOS COM PINO INEXISTENTE (defeito ja existente, nao criado aqui): {len(dangling)}")
            for n, k in dangling[:20]:
                print("    ", n, f"({k} fio(s))")
        report["passes"].append({"label": label, "elapsed": el, "stats": stats,
                                 "skipped": skipped, "errors": errors,
                                 "dangling": dangling})

    phases = {"sizes": ["sizes"], "style": ["style"], "both": ["sizes", "style"]}[args.phase]
    for label in phases:
        if label == "sizes":
            run_pass("sizes", process_sizes, (backup_dir,))
        else:
            run_pass("style", process, (args.truth, backup_dir))

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print("\nrelatorio:", args.report)


if __name__ == "__main__":
    main()
