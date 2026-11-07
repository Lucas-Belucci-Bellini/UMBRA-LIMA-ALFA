"""Validacao em escala: original (backup_chips/) vs redesenhado (Chips/).

Para cada um dos 30k chips prova-se, sem simular, que a LOGICA nao mudou:

  * o netlist -- IDs, nomes, bitcounts, InternalData, pontas dos fios na ordem
    -- tem que ser byte a byte identico;
  * so Position / Points / cor / ConnectionType podem diferir (o que o
    apply_style declara como MUTABLE);
  * Size so pode CRESCER em y (a fase sizes), nunca afinar nem mexer em x.

A--truth acrescenta, numa amostra, a assinatura simulada de saidas+displays
(old vs new) -- caro, entao opcional.
"""
import argparse
import copy
import json
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import apply_style as AP        # noqa: E402
import dlssim as S              # noqa: E402

BK = os.path.join(HERE, "backup_chips")
BK_SC = os.path.join(HERE, "backup_showcase")


def load(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def check(name, do_truth):
    cur_p = os.path.join(S.CHIPS, name + ".json")
    old_p = os.path.join(BK, name + ".json")
    out = {"name": name, "status": "ok"}
    try:
        cur = load(cur_p)
        if not os.path.exists(old_p):
            out["status"] = "no-backup"
            return out
        old = load(old_p)
        if cur["Size"]["x"] != old["Size"]["x"]:
            raise AssertionError("Size.x mudou")
        if cur["Size"]["y"] < old["Size"]["y"] - 1e-9:
            raise AssertionError("Size.y afinou")
        ref = copy.deepcopy(old)
        ref["Size"] = copy.deepcopy(cur["Size"])
        AP.verify(ref, cur)
        if do_truth:
            if AP.truth_signature(name, old) != AP.truth_signature(name, cur):
                raise AssertionError("assinatura simulada divergiu")
    except Exception as e:
        out["status"] = "error"
        out["err"] = f"{type(e).__name__}: {e}"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth", action="store_true")
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--exclude", default="",
                    help="nomes virgula-ou-espaco-separados a pular (ex.: os "
                         "vitrine, que mudam de netlist de proposito)")
    ap.add_argument("--names-file", default="",
                    help="JSON com lista de nomes (usa no lugar de varrer tudo)")
    ap.add_argument("--report", default=os.path.join(HERE, "report-scale.json"))
    args = ap.parse_args()

    # nomes podem ter espaco, entao o separador e SO virgula
    skip = {n.strip() for n in args.exclude.split(",") if n.strip()}
    if args.names_file:
        with open(args.names_file, encoding="utf-8") as f:
            names = [n for n in json.load(f) if n not in skip]
    else:
        names = sorted(f[:-5] for f in os.listdir(S.CHIPS)
                       if f.endswith(".json") and f[:-5] not in skip)
    if args.sample:
        names = random.Random(11).sample(names, args.sample)
    t0 = time.time()
    stats, errors = {}, []
    done = 0
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(check, n, args.truth): n for n in names}
        for fut in as_completed(futs):
            r = fut.result()
            stats[r["status"]] = stats.get(r["status"], 0) + 1
            if r["status"] != "ok":
                errors.append((r["name"], r.get("err", "")))
            done += 1
            if done % 2000 == 0 or done == len(names):
                el = time.time() - t0
                print(f"  {done}/{len(names)}  {stats}  {done / el:.0f} chips/s",
                      flush=True)
    el = time.time() - t0
    print(f"\ntempo {el:.1f}s | {len(names)} chips | {stats}")
    if errors:
        print("\nFALHAS:", len(errors))
        for n, e in errors[:30]:
            print("  ", n, "->", e)
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump({"elapsed": el, "count": len(names), "stats": stats,
                   "errors": errors, "truth": args.truth},
                  f, indent=2, ensure_ascii=False)
    print("relatorio:", args.report)


if __name__ == "__main__":
    main()
