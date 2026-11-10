"""Re-aplica o auto-layout nos chips da calculadora (gerados flat).

Igual ao relayout_ram.py: so geometria muda; autolayout.check() asserta
fiacao identica.  Pula a sim dlssim (REG-17/CALC-CORE tem DFF/latch ->
recursao).  Tolerante a falha por chip: reporta e continua.

    python tools/ai_style/relayout_calc.py --write
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import autolayout as A  # noqa: E402
import dlssim as S  # noqa: E402

NAMES = ["DFF", "REG-17", "ADD-17", "BCD-SEG", "CALC-KEYPAD", "CALC CIENTIFICA",
         "CALC-ALU", "CALC-CORE", "MUL-17", "SQRT-17", "DD-17", "DIV-17"]


def main(write):
    ok, fail = [], []
    for name in NAMES:
        try:
            before = S.load(name)
            after = A.layout(before)
            worst = A.check(before, after)
            if write:
                path = os.path.join(S.CHIPS, name + ".json")
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    json.dump(after, f, indent=2, ensure_ascii=False)
                S._cache.pop(name, None)
            ok.append(name)
            print(f"  ok   {name:16s} {len(after['SubChips']):5d} sub; "
                  f"dist {worst / A.G:.1f}", flush=True)
        except Exception as e:
            fail.append((name, type(e).__name__ + ": " + str(e)[:80]))
            print(f"  FAIL {name:16s} {type(e).__name__}: {str(e)[:80]}", flush=True)
    print(f"relayout calc: {len(ok)} ok, {len(fail)} falhas; "
          + ("GRAVADO" if write else "dry-run"), flush=True)
    for n, e in fail:
        print("  falha:", n, e, flush=True)


if __name__ == "__main__":
    main("--write" in sys.argv)