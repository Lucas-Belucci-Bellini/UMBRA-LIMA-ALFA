"""Re-aplica o auto-layout na familia RAM (regenerada flat pelo build_ram).

So geometria muda: autolayout.layout() reassenta pinos/subchips/fios e
autolayout.check() ASSERTA que a assinatura de fiacao (origem/destino de
cada fio) e identica antes/depois -> a logica e preservada por construcao.

Nao chamamos autolayout.truth(): o BIT-CELL e um latch de NANDs cruzados e
o dlssim (combinatorio) recursaria ate estourar a pilha.  A prova funcional
fica com dbg_ram.py (simseq, com settling de latch).

    python tools/ai_style/relayout_ram.py            # dry-run (so confere)
    python tools/ai_style/relayout_ram.py --write    # grava os chips
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import autolayout as A  # noqa: E402
import dlssim as S  # noqa: E402

NAMES = ["BIT-CELL", "RAM-16x8", "RAM-64x8", "RAM-256x8", "RAM-4Kx8",
         "RAM-64Kx8", "RAM-1Mx8", "RAM-16Mx8", "RAM-256Mx8", "RAM-1Gx8",
         "RAM-64x8 DEMO"]


def main(write):
    for name in NAMES:
        before = S.load(name)
        after = A.layout(before)
        worst = A.check(before, after)        # AssertionError se fiacao mudou
        print(f"  {name:13s} fiacao identica; menor distancia "
              f"{worst / A.G:.1f} quadrados; {len(after['SubChips'])} subchips")
        if write:
            path = os.path.join(S.CHIPS, name + ".json")
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(after, f, indent=2, ensure_ascii=False)
            S._cache.pop(name, None)
    print("relayout RAM:", "GRAVADO" if write else "dry-run ok")


if __name__ == "__main__":
    main("--write" in sys.argv)