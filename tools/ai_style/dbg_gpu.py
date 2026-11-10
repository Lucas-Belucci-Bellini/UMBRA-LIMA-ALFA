"""Teste funcional da GPU monocromatica 8x8 (GPU-MONO).

- CLR zera o framebuffer
- escrita de pixel (X,Y,D) com WE; readback exato pelas linhas R0..R7
- scan-out: num quadro de 64 ticks, VIDEO alto == nº de pixels acesos,
  HSYNC pulsa 8x (inicio de linha), VSYNC 1x (inicio de quadro)
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


class GPU:
    def __init__(self):
        self.sim = SimSeq(load("GPU-MONO"))
        for nm in ("WE", "CLR", "D", "X", "Y", "CLK"):
            self.sim.set_input(nm, 0)
        self.clear()

    def clear(self):
        self.sim.set_input("CLR", 1)
        self.sim.eval()
        self.sim.set_input("CLR", 0)
        self.sim.eval()

    def write(self, x, y, d):
        self.sim.set_input("X", x)
        self.sim.set_input("Y", y)
        self.sim.set_input("D", d)
        self.sim.set_input("WE", 1)
        self.sim.eval()
        self.sim.set_input("WE", 0)
        self.sim.eval()

    def image(self):
        lit = set()
        for y in range(8):
            row = self.sim.out("R" + str(y))
            for x in range(8):
                if (row >> x) & 1:
                    lit.add((x, y))
        return lit


def main():
    g = GPU()
    ok = True
    if g.image():
        print("  ERRO: CLR nao zerou", g.image())
        ok = False
    else:
        print("  ok  CLR zera o framebuffer")

    # desenha um padrao: borda + diagonal
    pts = set()
    for i in range(8):
        pts.add((i, 0)); pts.add((i, 7)); pts.add((0, i)); pts.add((7, i))
        pts.add((i, i))
    for (x, y) in sorted(pts):
        g.write(x, y, 1)
    got = g.image()
    if got != pts:
        print("  ERRO readback: faltam", sorted(pts - got), "sobram", sorted(got - pts))
        ok = False
    else:
        print(f"  ok  {len(pts)} pixels escritos e lidos exato (borda+diagonal)")

    # apaga um pixel
    g.write(3, 3, 0)
    pts.discard((3, 3))
    if g.image() != pts:
        print("  ERRO: apagar pixel (3,3) falhou")
        ok = False
    else:
        print("  ok  apagar pixel (D=0) funciona")

    # scan-out num quadro completo
    vhi = hcnt = vcnt = 0
    for _ in range(64):
        g.sim.tick()
        vhi += g.sim.out("VIDEO")
        hcnt += g.sim.out("HSYNC")
        vcnt += g.sim.out("VSYNC")
    if vhi != len(pts):
        print(f"  ERRO: VIDEO altos={vhi}, esperado {len(pts)}")
        ok = False
    else:
        print(f"  ok  scan-out VIDEO: {vhi} altos = pixels acesos")
    if hcnt != 8 or vcnt != 1:
        print(f"  ERRO: HSYNC={hcnt} (esperado 8), VSYNC={vcnt} (esperado 1)")
        ok = False
    else:
        print("  ok  HSYNC 8 pulsos/quadro, VSYNC 1 pulso/quadro")

    print("GPU:", "TUDO OK" if ok else "HOUVE ERRO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())