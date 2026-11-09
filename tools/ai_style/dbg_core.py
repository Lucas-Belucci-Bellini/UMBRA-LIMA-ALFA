"""Sonda o CALC-CORE diretamente (sem teclado) para achar onde X nao latcha."""
import sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_calc2 as B2
import build_calc as BC
from simseq import SimSeq

# popula REG
for fn in (BC.build_dff, BC.build_reg17, BC.build_add17, BC.build_mul17,
           BC.build_div17, BC.build_sqrt17, BC.build_dd17):
    B2.reg(fn())
B2.build_alu(); B2.build_keypad(); B2.build_core(); B2.build_seg(); B2.build_top()

core = B2.REG["CALC-CORE"]
print("CORE inputs:", [p["Name"] for p in core["InputPins"]])
print("CORE outputs:", [p["Name"] for p in core["OutputPins"]])

sim = SimSeq(core, extra=B2.REG)
print("ext_in:", list(sim.ext_in), " ext_out:", list(sim.ext_out))
print("n dffs:", len(sim.dffs), " n clocks:", len(sim.clocks))


def setcode(c):
    for j in range(5):
        sim.set_input("KC" + str(j), (c >> j) & 1)


def pulse(c):
    setcode(c)
    sim.set_input("KP", 1)
    sim.tick()
    sim.set_input("KP", 0)
    sim.tick()


def dump(tag):
    xlo = sim.out("X.LO"); xmid = sim.out("X.MID"); xhi = sim.out("X.HI")
    x = xlo | (xmid << 8) | (xhi << 16)
    print(f"{tag:18s} X={x:6d} DIG={sim.out('DBG_DIG')} SAT={sim.out('DBG_SAT')} "
          f"ACC0={sim.out('DBG_ACC0')} ACCV0={sim.out('DBG_ACCV0')} "
          f"DX0={sim.out('DBG_DX0')} KP={sim.out('DBG_KP')} "
          f"USE={sim.out('DBG_USE')} BIN={sim.out('DBG_BIN')}")
    print("   D0..D4:", [sim.out("D" + str(i)) for i in range(5)])


sim.run(2)
dump("reset")
# digito 1: KC0=1, KP pulso
setcode(1)
sim.set_input("KP", 1)
print("--- tick com KP=1, code=1 ---")
sim.tick()
dump("apos 1o tick")
sim.set_input("KP", 0)
sim.tick()
dump("code1 KP baixo")
# digito 2 em cima
setcode(2)
sim.set_input("KP", 1)
sim.tick()
sim.set_input("KP", 0)
sim.tick()
dump("code2 -> espera 12")
