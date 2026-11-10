"""Layout da familia GPU, com matriz 8x8 explicita para os LEDs internos.

A.check compara a fiacao antes/depois. As coordenadas da matriz sao derivadas
dos pinos R0..R7 e dos bits dos divisores, nao da ordem de criacao dos LEDs.
Testes funcionais: dbg_gpu.py / dbg_gpu_demo.py (modelo sem atrasos simseq;
nao demonstram partida ou comportamento temporal no motor DLS).

    python tools/ai_style/relayout_gpu.py --write
    python tools/ai_style/relayout_gpu.py --name GPU-DEMO --write
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import autolayout as A  # noqa: E402
import dlssim as S  # noqa: E402

NAMES = ["FB-8x8", "GPU-MONO", "GPU-DEMO"]


def led_matrix(d):
    """Organiza apenas posicoes e pontos dos fios dos 64 LEDs (sem religar)."""
    subs = {s["ID"]: s for s in d["SubChips"]}
    leds = {sid: s for sid, s in subs.items() if s["Name"] == "LED"}
    if not leds:
        return
    if len(leds) != 64:
        raise ValueError("matriz GPU requer exatamente 64 LEDs")
    incoming = {w["TargetPinAddress"]["PinOwnerID"]: w for w in d["Wires"]
                if w["TargetPinAddress"]["PinOwnerID"] in subs
                and subs[w["TargetPinAddress"]["PinOwnerID"]]["Name"] == "8-1BIT"}
    mapping = []
    for w in d["Wires"]:
        ta, sa = w["TargetPinAddress"], w["SourcePinAddress"]
        if ta["PinOwnerID"] not in leds:
            continue
        splitter = subs[sa["PinOwnerID"]]
        assert splitter["Name"] == "8-1BIT" and ta["PinID"] == 0
        bus = incoming[splitter["ID"]]["SourcePinAddress"]
        provider = S.load(subs[bus["PinOwnerID"]]["Name"])
        pin = next(p for p in provider["OutputPins"] if p["ID"] == bus["PinID"])
        assert pin["Name"] in ["R" + str(r) for r in range(8)]
        row, col = int(pin["Name"][1:]), 8 - sa["PinID"]
        assert 0 <= col < 8
        mapping.append((leds[ta["PinOwnerID"]], splitter, row, col, w))
    assert len(mapping) == 64
    assert {(r, c) for _, _, r, c, _ in mapping} == {
        (r, c) for r in range(8) for c in range(8)}

    # Painel fora do envelope da logica: nao sobrepoe chips ou pinos.
    right = max([s["Position"]["x"] + A.chip_info(s["Name"])["size"][0] / 2
                 for sid, s in subs.items() if sid not in leds]
                + [p["Position"]["x"] + A.DEVPIN_W / 2
                   for p in d["InputPins"] + d["OutputPins"]])
    left = round(right + 3.5, 4)
    for led, splitter, row, col, wire in mapping:
        lx, ly = left + col, 3.5 - row
        led["Position"] = {"x": lx, "y": ly}
        led["Label"] = f"PIXEL {col},{row}"
        width, height = A.chip_info("8-1BIT")["size"]
        offsets = A.pin_offsets(height, [1] * 8)
        sx = splitter["Position"]["x"] + width / 2
        sy = splitter["Position"]["y"] + offsets[7 - col]
        track_x = right + 1.0 + row * A.G
        track_y = ly + 0.25 + col * 0.03125
        points = [(sx + A.G, sy), (track_x, sy), (track_x, track_y),
                  (lx - 0.375, track_y), (lx - 0.375, ly)]
        wire["Points"] = ([{"x": 0, "y": 0}]
                          + [{"x": round(x, 4), "y": round(y, 4)} for x, y in points]
                          + [{"x": 0, "y": 0}])


def main(write, names=None):
    for name in (NAMES if names is None else names):
        before = S.load(name)
        after = A.layout(before)
        led_matrix(after)
        worst = A.check(before, after)
        assert worst >= 5 * A.G - 1e-4, "espacamento insuficiente entre chips"
        print(f"  {name:10s} fiacao identica; menor distancia "
              f"{worst / A.G:.1f} quadrados; {len(after['SubChips'])} subchips")
        if write:
            path = os.path.join(S.CHIPS, name + ".json")
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(after, f, indent=2, ensure_ascii=False)
            S._cache.pop(name, None)
    print("relayout GPU:", "GRAVADO" if write else "dry-run ok")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--name", action="append", choices=NAMES)
    args = parser.parse_args()
    main(args.write, args.name)
