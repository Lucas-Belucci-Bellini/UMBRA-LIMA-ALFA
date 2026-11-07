"""Prova de que a reescrita topologica dos vitrine e transparente PARA OS PAIS.

Monta cada chip-pai duas vezes: com os filhos ORIGINAIS (backup_showcase/) e
com os filhos NOVOS (Chips/), e compara a assinatura simulada (saidas + o que
apareceu nos displays de 7 segmentos). Se bater, nenhum circuito que usa os
vitrine mudou de comportamento.
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import apply_style as AP   # noqa: E402
import dlssim as D         # noqa: E402

SHOW = ["Full Adder", "DECOD 7-SEG", "ADD3", "DECODE-4x16", "COMPARE-4", "EQUAL-4"]
BK = os.path.join(HERE, "backup_showcase")


def load(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def sig(parent, use_original_children):
    D.EXTRA.clear()
    D._memo.clear()
    D._has_disp.clear()
    if use_original_children:
        for n in SHOW:
            p = os.path.join(BK, n + ".json")
            if os.path.exists(p):
                D.EXTRA[n] = load(p)
    d = load(os.path.join(D.CHIPS, parent + ".json"))
    try:
        return AP.truth_signature(parent, d)
    finally:
        D.EXTRA.clear()
        D._memo.clear()
        D._has_disp.clear()


def check(parent):
    try:
        a, b = sig(parent, True), sig(parent, False)
        return {"name": parent, "ok": a == b, "a": a, "b": b}
    except Exception as e:
        return {"name": parent, "ok": False, "err": f"{type(e).__name__}: {e}"}


def main():
    names = json.load(open(os.path.join(HERE, "list-showcase-parents.json"),
                           encoding="utf-8"))
    bad = []
    with ProcessPoolExecutor(max_workers=7) as ex:
        for r in as_completed([ex.submit(check, n) for n in names]):
            v = r.result()
            if not v["ok"]:
                bad.append(v)
            print(("  ok   " if v["ok"] else "  FAIL ") + v["name"], flush=True)
    print(f"\n{len(names) - len(bad)}/{len(names)} pais identicos "
          f"com filhos antigos e novos")
    for v in bad:
        detail = v.get("err") or f"assinaturas {v.get('a')} != {v.get('b')}"
        print("  ", v["name"], detail)
    with open(os.path.join(HERE, "report-showcase-parents.json"), "w",
              encoding="utf-8") as f:
        json.dump({"total": len(names), "failures": bad}, f, indent=2,
                  ensure_ascii=False)


if __name__ == "__main__":
    main()
