"""Bancada demo auto-executavel da GPU monocromatica (GPU-DEMO).

Abre no DLS, aperta play, e um ponto percorre a linha 3 da matriz de LEDs
batendo nas bordas e voltando (0..7..0..), sem nenhum pino de entrada: um
CLOCK interno toca tudo.

Arquitetura (tudo sincronizado pelo CLOCK interno):
  - divisor de n bits (upcounter livre) -> `step` pulsa 1 vez a cada 2^n ticks
  - fase `ph` (DFF) alterna a cada step: ph=0 limpa, ph=1 desenha
  - posicao `px` (3 bits) + sentido `dir` (1 bit) avancam a cada 2 steps
    (upd = step & ph), com bounce nas bordas 0 e 7
  - GPU-MONO recebe CLR=!ph, WE=ph, X=px, Y=3, D=1 -> framebuffer de 1 ponto
  - grade de 64 LEDs no topo (R0..R7 do GPU-MONO) mostra o ponto ao vivo

O ponto fica estavel durante toda a fase de desenho (px so muda na borda
ph 1->0), entao a animacao e limpa: desenha px, limpa, desenha px+/-1, ...
Verificacao: dbg_gpu_demo.py (simseq) confirma que so a linha 3 acende,
um pixel por vez, e que a sequencia de posicoes bate e volta (0..7..0).

Pinos de filho resolvidos POR NOME (DFF Q=13, GPU-MONO X/Y/WE/CLR/R0..).

  python build_gpu_demo.py
  python relayout_gpu.py --write        # FB-8x8 / GPU-MONO / GPU-DEMO
  python dbg_gpu_demo.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_ram import Builder, CHIPS, REG, _reg, subc  # noqa: E402
from build_calc import xor2, mux2, addN, and_tree, eq0  # noqa: E402
from build_gpu import merge8  # noqa: E402

# carrega os filhos direto do disco para resolver pinos por nome (sem regravar)
for _nm in ("DFF", "GPU-MONO"):
    if _nm not in REG:
        with open(os.path.join(CHIPS, _nm + ".json"), encoding="utf-8") as _f:
            REG[_nm] = json.load(_f)

DIV = 3          # divisor: step a cada 8 ticks, px avanca a cada 16
ROW = 3          # linha do ponto


def upcounter(b, clk, n):
    """Upcounter livre de n bits (DFF), clock=clk.  Devolve qs LSB0."""
    ff = [subc(b, "DFF") for _ in range(n)]
    qs = [(f, om["Q"]) for f, im, om in ff]
    carry = b.const1()
    for i, (f, im, om) in enumerate(ff):
        b.wire(xor2(b, qs[i], carry), (f, im["D"]))
        b.wire(clk, (f, im["CLK"]))
        if i < n - 1:
            carry = b.and2(carry, qs[i])
    return qs


def build_demo():
    b = Builder("GPU-DEMO", (0.30, 0.50, 0.60))
    # sem pinos de entrada: auto-executavel
    rows = [b.out_pin("R" + str(r), 8, 3, 1) for r in range(8)]
    video = b.out_pin("VIDEO", 1, 3)
    hs = b.out_pin("HSYNC", 1, 4)
    vs = b.out_pin("VSYNC", 1, 5)
    pxout = b.out_pin("PX", 8, 4, 1)
    drawout = b.out_pin("DESENHAR", 1, 3)

    clkid = b.sub("CLOCK")
    clk = (clkid, 0)
    one = b.const1()
    zero = b.inv(one)

    # divisor livre -> step (1 tick a cada 2^DIV)
    dv = upcounter(b, clk, DIV)
    step = and_tree(b, dv)

    # fase ph: alterna a cada step (0=limpa, 1=desenha)
    phf, phim, phom = subc(b, "DFF")
    ph = (phf, phom["Q"])
    b.wire(ph, (drawout, 0))
    b.wire(mux2(b, step, ph, b.inv(ph)), (phf, phim["D"]))
    b.wire(clk, (phf, phim["CLK"]))

    # sentido e posicao com bounce, atualizam em upd = step & ph
    dirf, dirim, dirom = subc(b, "DFF")
    dr = (dirf, dirom["Q"])
    pxf = [subc(b, "DFF") for _ in range(3)]
    px = [(f, om["Q"]) for f, im, om in pxf]

    at_right = and_tree(b, px)                 # px == 7
    at_left = eq0(b, px)                       # px == 0
    bounce_left = b.and2(at_right, b.inv(dr))  # bateu a direita indo -> esquerda
    bounce_right = b.and2(at_left, dr)         # bateu a esquerda indo -> direita
    dir_next = b.or2(bounce_left, b.and2(dr, b.inv(bounce_right)))
    # px_next = px + (dir_next ? -1 : +1); -1 = 111 (mod 8), +1 = 001
    px_next, _ = addN(b, px, [one, dir_next, dir_next], zero)

    upd = b.and2(step, ph)
    b.wire(mux2(b, upd, dr, dir_next), (dirf, dirim["D"]))
    b.wire(clk, (dirf, dirim["CLK"]))
    for (f, im, om), q, dn in zip(pxf, px, px_next):
        b.wire(mux2(b, upd, q, dn), (f, im["D"]))
        b.wire(clk, (f, im["CLK"]))

    # GPU-MONO: CLR=!ph, WE=ph, X=px, Y=ROW, D=1
    gpu, gim, gom = subc(b, "GPU-MONO")
    b.wire(clk, (gpu, gim["CLK"]))
    b.wire(merge8(b, px + [zero] * 5), (gpu, gim["X"]))
    ybits = [(one if (ROW >> i) & 1 else zero) for i in range(8)]
    b.wire(merge8(b, ybits), (gpu, gim["Y"]))
    b.wire(one, (gpu, gim["D"]))
    b.wire(ph, (gpu, gim["WE"]))
    b.wire(b.inv(ph), (gpu, gim["CLR"]))

    R = [(gpu, gom["R" + str(r)]) for r in range(8)]
    for r in range(8):
        b.wire(R[r], (rows[r], 0))
    b.wire((gpu, gom["VIDEO"]), (video, 0))
    b.wire((gpu, gom["HSYNC"]), (hs, 0))
    b.wire((gpu, gom["VSYNC"]), (vs, 0))
    b.wire(merge8(b, px + [zero] * 5), (pxout, 0))

    # grade de 64 LEDs no topo (imagem ao vivo do framebuffer)
    for r in range(8):
        rb = b.split8(R[r])
        for c in range(8):
            led = b.sub("LED")
            b.wire(rb[c], (led, 0))
    d = b.save(write=False)
    # Altura suficiente para todos os pinos do bloco salvo (nao achata 13
    # saidas em Size=2). A matriz interna e organizada por relayout_gpu.py.
    d["Size"] = {"x": 2.0, "y": 6.0}
    with open(os.path.join(CHIPS, d["Name"] + ".json"), "w",
              encoding="utf-8", newline="\n") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
    return _reg(d)


if __name__ == "__main__":
    build_demo()
    d = REG["GPU-DEMO"]
    print(f"GPU-DEMO   sub={len(d['SubChips']):4d} wires={len(d['Wires']):4d} "
          f"arquivo={os.path.getsize(os.path.join(CHIPS, 'GPU-DEMO.json'))}B  "
          f"DIV={DIV} ROW={ROW}")