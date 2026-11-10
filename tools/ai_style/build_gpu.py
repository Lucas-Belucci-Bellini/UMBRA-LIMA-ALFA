"""GPU monocromatica 8x8 do UMBRA LIMA-ALFA (1 bit por pixel).

  FB-8x8     framebuffer de 64 bits (8 linhas x 8 colunas).  Escrita de pixel
             por endereco A(6 bits = Y*8+X), dado D, WE; CLR zera tudo.
             Saida R0..R7 (8 bits cada) = as 8 linhas, para display/scan.
             Cada pixel e um BIT-CELL (latch) com RSEL=1 (leitura sempre).
  GPU-MONO   adaptador de video completo:
             - entrada X,Y (3 bits), D, WE, CLR -> escreve pixel no framebuffer
             - grade de 64 LEDs (8x8) mostra a imagem latchada (estavel)
             - contador raster de 6 bits (0..63) varre o framebuffer e gera
               VIDEO serie + HSYNC (inicio de linha) + VSYNC (inicio de quadro)
             - saidas R0..R7 (framebuffer), VIDEO, HSYNC, VSYNC

Tudo simulavel no simseq (LED/DFF/1-8BIT suportados; BIT-CELL assenta por
ponto fixo).  Abre no DLS (~2 mil portas).  Workflow:
    python build_gpu.py && python relayout_ram.py --write  # (FB/GPU via relayout)
    python dbg_gpu.py

Pinos de filho resolvidos POR NOME (BIT-CELL Q=11, DFF Q=13).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_ram import Builder, CHIPS, REG, _reg, subc, decode  # noqa: E402
from build_calc import xor2, mux2  # noqa: E402

# primitives resolvidas por nome (nao regravar os chips ja layoutados)
for _nm in ("BIT-CELL", "DFF"):
    if _nm not in REG:
        with open(os.path.join(CHIPS, _nm + ".json"), encoding="utf-8") as _f:
            REG[_nm] = json.load(_f)


def merge8(b, bits):
    """8 sinais (LSB0) -> fonte de 8 bits via 1-8BIT (pino 7-i = bit i)."""
    mg = b.sub("1-8BIT")
    for i in range(8):
        b.wire(bits[i], (mg, 7 - i))
    return (mg, 8)


def mux8(b, sel3, ins8):
    """8:1 com sel3 LSB0: indice = sel0 + 2*sel1 + 4*sel2."""
    lvl = list(ins8)
    for s in sel3:
        lvl = [mux2(b, s, lvl[i], lvl[i + 1]) for i in range(0, len(lvl), 2)]
    return lvl[0]


def build_fb():
    b = Builder("FB-8x8", (0.40, 0.50, 0.60))
    a = b.in_pin("A", 8, 4, 1)
    d = b.in_pin("D", 1, 3)
    we = b.in_pin("WE", 1, 0)
    clr = b.in_pin("CLR", 1, 1)
    rows = [b.out_pin("R" + str(r), 8, 3, 1) for r in range(8)]

    ab = b.split8((a, 0))[:6]
    sel = decode(b, ab, None)                 # sel[p] alto quando A(6)==p
    one = b.const1()
    dval = b.and2((d, 0), b.inv((clr, 0)))    # CLR forca dado 0
    qs = []
    for p in range(64):
        cell, cim, com = subc(b, "BIT-CELL")
        g = b.or2(b.and2(sel[p], (we, 0)), (clr, 0))   # escreve pixel ou zera
        b.wire(dval, (cell, cim["D"]))
        b.wire(g, (cell, cim["G"]))
        b.wire(one, (cell, cim["RSEL"]))
        qs.append((cell, com["Q"]))
    for r in range(8):
        b.wire(merge8(b, qs[r * 8:r * 8 + 8]), (rows[r], 0))
    return _reg(b.save())


def build_gpu():
    b = Builder("GPU-MONO", (0.30, 0.55, 0.50))
    clk = b.in_pin("CLK", 1, 2)
    x = b.in_pin("X", 8, 4, 1)
    y = b.in_pin("Y", 8, 4, 1)
    d = b.in_pin("D", 1, 3)
    we = b.in_pin("WE", 1, 0)
    clr = b.in_pin("CLR", 1, 1)
    video = b.out_pin("VIDEO", 1, 3)
    hs = b.out_pin("HSYNC", 1, 4)
    vs = b.out_pin("VSYNC", 1, 5)
    rows = [b.out_pin("R" + str(r), 8, 3, 1) for r in range(8)]

    # endereco do pixel = (Y << 3) | X
    xb = b.split8((x, 0))[:3]
    yb = b.split8((y, 0))[:3]
    zero = b.inv(b.const1())
    addr = merge8(b, xb + yb + [zero, zero])
    fb, fim, fom = subc(b, "FB-8x8")
    b.wire(addr, (fb, fim["A"]))
    b.wire((d, 0), (fb, fim["D"]))
    b.wire((we, 0), (fb, fim["WE"]))
    b.wire((clr, 0), (fb, fim["CLR"]))
    R = [(fb, fom["R" + str(r)]) for r in range(8)]
    for r in range(8):
        b.wire(R[r], (rows[r], 0))

    # grade de LEDs 8x8 (imagem latchada, estavel)
    for r in range(8):
        rb = b.split8(R[r])
        for c in range(8):
            led = b.sub("LED")
            b.wire(rb[c], (led, 0))

    # contador raster sincrono de 6 bits (0..63), clock = CLK
    ff = [subc(b, "DFF") for _ in range(6)]
    qs = [(f, om["Q"]) for f, im, om in ff]
    carry = b.const1()
    for i, (f, im, om) in enumerate(ff):
        b.wire(xor2(b, qs[i], carry), (f, im["D"]))
        b.wire((clk, 0), (f, im["CLK"]))
        if i < 5:
            carry = b.and2(carry, qs[i])
    sc = qs                                   # sc[0..5] LSB0

    # scan-out: linha = sc[5:3], coluna = sc[2:0]
    Rb = [b.split8(R[r]) for r in range(8)]
    selcol = [mux8(b, sc[3:6], [Rb[r][c] for r in range(8)]) for c in range(8)]
    b.wire(mux8(b, sc[0:3], selcol), (video, 0))

    invsc = [b.inv(s) for s in sc]
    hsync = invsc[0]
    for s in invsc[1:3]:
        hsync = b.and2(hsync, s)              # coluna 0
    vsync = hsync
    for s in invsc[3:6]:
        vsync = b.and2(vsync, s)              # linha 0 e coluna 0
    b.wire(hsync, (hs, 0))
    b.wire(vsync, (vs, 0))
    return _reg(b.save())


def build_all():
    build_fb()
    build_gpu()


if __name__ == "__main__":
    build_all()
    for n in ("FB-8x8", "GPU-MONO"):
        d = REG[n]
        print(f"{n:10s} sub={len(d['SubChips']):4d} wires={len(d['Wires']):4d} "
              f"arquivo={os.path.getsize(os.path.join(CHIPS, n + '.json'))}B")