"""Teste funcional de leitura/escrita das RAMs pequenas (com settling de latch).

Dirige A0/DIN/WE/CS/CLK como entradas externas e eval()手动; o latch BIT-CELL
estabiliza por iteracao.  Prova que a fiacao corrigida guarda e devolve dados.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CHIPS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Chips")
from simseq import SimSeq  # noqa: E402


def load(name):
    with open(os.path.join(CHIPS, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


class RAM:
    def __init__(self, name, addr_pins):
        self.sim = SimSeq(load(name))
        self.addr_pins = addr_pins
        self.sim.set_input("CS", 1)
        self.sim.set_input("WE", 0)
        self.sim.set_input("CLK", 0)
        self.sim.eval()

    def _setaddr(self, a):
        for i, p in enumerate(self.addr_pins):
            self.sim.set_input(p, (a >> (8 * i)) & 255)

    def write(self, a, v):
        self._setaddr(a)
        self.sim.set_input("DIN", v & 255)
        self.sim.set_input("WE", 1)
        self.sim.set_input("CLK", 1)
        self.sim.eval()                 # CLK alto + WE -> celula escrita
        self.sim.set_input("WE", 0)
        self.sim.set_input("CLK", 0)
        self.sim.eval()                 # hold

    def read(self, a):
        self._setaddr(a)
        self.sim.set_input("WE", 0)
        self.sim.set_input("CLK", 0)
        self.sim.eval()
        return self.sim.out("DOUT")


def test(name, addr_pins, addrs):
    r = RAM(name, addr_pins)
    ok = True
    vals = {}
    for i, a in enumerate(addrs):
        v = (0xA5 + 37 * i) & 255
        r.write(a, v)
        vals[a] = v
    for a in addrs:
        got = r.read(a)
        want = vals[a]
        mark = "ok " if got == want else "ERRO"
        if got != want:
            ok = False
        print(f"  {mark} {name:11s}[{a:3d}] le {got:3d}  esperado {want:3d}")
    return ok


if __name__ == "__main__":
    allok = True
    allok &= test("RAM-16x8", ["A0"], [0, 1, 5, 15])
    allok &= test("RAM-64x8", ["A0"], [0, 10, 63])
    allok &= test("RAM-256x8", ["A0"], [0, 16, 100, 255])
    print("RAM:", "TUDO OK" if allok else "HOUVE ERRO")
    sys.exit(0 if allok else 1)
