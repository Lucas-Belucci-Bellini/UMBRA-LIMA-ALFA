"""Testa GPU-DEMO: fases exatas, bounce, ligacoes e geometria da matriz.

Amostra DEPOIS da captura dos DFFs (tick + eval), com partida em zero no
modelo ideal. Verifica 8 ticks por fase, zero pixels no clear e exatamente
um no draw, sem assumir que uma sequencia de readback valida comprova LEDs.
Este teste nao valida atrasos de propagacao nem partida no motor DLS.
    python tools/ai_style/dbg_gpu_demo.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from simseq import SimSeq, CHIPS  # noqa: E402

ROW = 3
DIV = 3
TICKS = 320


def load(name):
    with open(os.path.join(CHIPS, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def bounce_seq(n):
    seq, p, d = [], 0, 1
    for _ in range(n):
        seq.append(p)
        if p == 7:
            d = -1
        elif p == 0:
            d = 1
        p += d
    return seq


def check_leds(desc):
    subs = {s["ID"]: s for s in desc["SubChips"]}
    leds = [s for s in desc["SubChips"] if s["Name"] == "LED"]
    assert len(leds) == 64, "faltam LEDs no topo"
    gpu = next(s for s in desc["SubChips"] if s["Name"] == "GPU-MONO")
    row_pins = {p["ID"]: int(p["Name"][1:]) for p in load("GPU-MONO")["OutputPins"]
                if p["Name"] in ["R" + str(r) for r in range(8)]}
    by_target = {}
    for w in desc["Wires"]:
        target = (w["TargetPinAddress"]["PinOwnerID"], w["TargetPinAddress"]["PinID"])
        assert target not in by_target, f"pino com duas fontes: {target}"
        by_target[target] = w["SourcePinAddress"]
    mapping = []
    for led in leds:
        src = by_target[(led["ID"], 0)]
        splitter = subs[src["PinOwnerID"]]
        assert splitter["Name"] == "8-1BIT"
        bus = by_target[(splitter["ID"], 0)]
        assert bus["PinOwnerID"] == gpu["ID"]
        row, col = row_pins[bus["PinID"]], 8 - src["PinID"]
        assert 0 <= col < 8
        mapping.append((row, col, led["Position"]))
    assert {(r, c) for r, c, _ in mapping} == {
        (r, c) for r in range(8) for c in range(8)}, "bits repetidos ou faltantes"
    xs, ys = {}, {}
    for r, c, pos in mapping:
        xs.setdefault(c, set()).add(pos["x"])
        ys.setdefault(r, set()).add(pos["y"])
    assert all(len(values) == 1 for values in list(xs.values()) + list(ys.values()))
    assert all(next(iter(xs[c])) < next(iter(xs[c + 1])) for c in range(7))
    assert all(next(iter(ys[r])) > next(iter(ys[r + 1])) for r in range(7))
    return [(r, c) for r, c, _ in mapping]


def main():
    desc = load("GPU-DEMO")
    mapping = check_leds(desc)
    print("  ok  matriz 8x8: 64 LEDs, cada bit ligado uma vez, linhas/colunas ordenadas")
    sim = SimSeq(desc)
    top_leds = [n for n in sim.segs if n.name == "LED"]
    assert len(top_leds) == 64
    phase_ticks = 1 << DIV
    move_ticks = 2 * phase_ticks
    positions = bounce_seq(TICKS // move_ticks + 1)
    cols, clear_count, draw_count = [], 0, 0
    for tick in range(1, TICKS + 1):
        sim.tick()
        sim.eval()   # tick captura meta.state; eval disponibiliza os novos Q
        phase = (tick // phase_ticks) % 2
        px = positions[tick // move_ticks]
        assert sim.out("DESENHAR") == phase, f"fase incorreta no tick {tick}"
        assert sim.out("PX") == px, f"PX incorreto no tick {tick}"
        expected = [0] * 8
        if phase:
            expected[ROW] = 1 << px
            draw_count += 1
            if not cols or cols[-1] != px:
                cols.append(px)
        else:
            clear_count += 1
        rows = [sim.out("R" + str(r)) for r in range(8)]
        assert rows == expected, f"framebuffer incorreto no tick {tick}: {rows}"
        for node, (row, col) in zip(top_leds, mapping):
            actual = sim.cur[node.ins[0]]
            assert actual == ((expected[row] >> col) & 1), f"LED {col},{row} incorreto"
    assert cols == bounce_seq(len(cols)) and len(cols) >= 15
    assert clear_count == draw_count == TICKS // 2
    print(f"  ok  {clear_count} ticks clear (tudo apagado), {draw_count} draw (1 pixel)")
    print(f"  ok  fases de {phase_ticks} ticks; PX muda a cada {move_ticks}, sem rastros")
    print(f"  ok  framebuffer E LEDs conferidos a cada tick: {cols}")
    print("GPU-DEMO: TUDO OK (modelo simseq; DLS nao validado)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
