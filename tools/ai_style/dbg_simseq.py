"""Regressoes de ordenacao e ponto fixo do simseq (sem gravação de chips).

Cobre DAG profundo em ordem invertida, fronteiras DFF, latches NAND reais,
cascata transparente, clear com D=1 e falha explicita se nao convergir.
    python tools/ai_style/dbg_simseq.py
"""
import json
import unittest
from pathlib import Path

from build_ram import Builder, CHIPS
from simseq import SimSeq


def load(name):
    return json.loads((Path(CHIPS) / (name + ".json")).read_text(encoding="utf-8"))


def chain(n, use_dff=False):
    b = Builder("TEST-CHAIN", (0.3, 0.5, 0.6))
    a = b.in_pin("A")
    source = (a, 0)
    if use_dff:
        clk = b.in_pin("CLK")
        child = load("DFF")
        pins = {p["Name"]: p["ID"] for p in child["InputPins"] + child["OutputPins"]}
        ff = b.sub("DFF")
        b.wire(source, (ff, pins["D"]))
        b.wire((clk, 0), (ff, pins["CLK"]))
        source = (ff, pins["Q"])
    for _ in range(n):
        source = b.inv(source)
    b.wire(source, (b.out_pin("Q"), 0))
    d = b.save(write=False)
    d["SubChips"].reverse()  # ordem de listagem nunca deve ser ordem de avaliacao
    return d


class SimSeqTest(unittest.TestCase):
    def assert_nands_settled(self, sim):
        for node in sim.nodes:
            if node.kind == "nand":
                a, b = [sim.cur[s] if s else 0 for s in node.ins]
                self.assertEqual(sim.cur[node.outs[0]], int(not (a and b)))

    def test_deep_dag_reversed(self):
        sim = SimSeq(chain(101))
        self.assertEqual(sim.out("Q"), 1)
        for a in (1, 0, 1):
            sim.set_input("A", a)
            sim.eval()
            self.assertEqual(sim.out("Q"), 1 - a)
            self.assert_nands_settled(sim)

    def test_dff_is_available_boundary(self):
        sim = SimSeq(chain(101, use_dff=True))
        sim.set_input("A", 1)
        sim.tick()
        sim.eval()
        self.assertEqual(sim.out("Q"), 0)
        self.assert_nands_settled(sim)

    def test_bit_cell_hold_keeps_complementary_state(self):
        sim = SimSeq(load("BIT-CELL"))
        sim.set_input("RSEL", 1)
        sim.eval()
        self.assert_nands_settled(sim)
        for value in (0, 1, 0):
            sim.set_input("D", value)
            sim.set_input("G", 1)
            sim.eval()
            self.assertEqual(sim.out("Q"), value)
            sim.set_input("G", 0)
            sim.set_input("D", 1 - value)
            sim.eval()
            self.assertEqual(sim.out("Q"), value)
            self.assert_nands_settled(sim)

    def test_transparent_cells_in_cascade(self):
        b = Builder("TEST-CASCADE", (0.3, 0.5, 0.6))
        a = b.in_pin("A")
        one = b.const1()
        source = (a, 0)
        child = load("BIT-CELL")
        pins = {p["Name"]: p["ID"] for p in child["InputPins"] + child["OutputPins"]}
        for _ in range(2):
            cell = b.sub("BIT-CELL")
            b.wire(source, (cell, pins["D"]))
            b.wire(one, (cell, pins["G"]))
            b.wire(one, (cell, pins["RSEL"]))
            source = (cell, pins["Q"])
        b.wire(source, (b.out_pin("Q"), 0))
        sim = SimSeq(b.save(write=False))
        for value in (1, 0, 1):
            sim.set_input("A", value)
            sim.eval()
            self.assertEqual(sim.out("Q"), value)
            self.assert_nands_settled(sim)

    def test_framebuffer_clear_release_with_d_high(self):
        sim = SimSeq(load("FB-8x8"))
        sim.set_input("D", 1)
        sim.set_input("CLR", 1)
        sim.eval()
        sim.set_input("CLR", 0)
        sim.eval()
        self.assertEqual([sim.out("R" + str(r)) for r in range(8)], [0] * 8)
        self.assert_nands_settled(sim)

    def test_oscillation_raises_instead_of_silent_output(self):
        b = Builder("TEST-OSC", (0.3, 0.5, 0.6))
        gate = b.sub("NAND")
        b.wire((gate, 2), (gate, 0))
        b.wire((gate, 2), (gate, 1))
        with self.assertRaisesRegex(RuntimeError, "nao convergiu"):
            SimSeq(b.save(write=False))


if __name__ == "__main__":
    unittest.main(verbosity=2)
