"""Estagios B e C da calculadora cientifica do UMBRA LIMA-ALFA:

  CALC-ALU        A, B (triplos de 17 bits), OP0..OP2 -> R (triplo), ERR
                  0 ADD  1 SUB  2 MUL  3 DIV  4 SQRT  5 SQ  6 LOG2  7 1/X
  CALC-KEYPAD     20 KEY builtins -> KC0..KC4 (codigo) + KP (pulso de 1 tick)
                  tecla i = codigo i: 0-9 digitos, 10 +, 11 -, 12 *, 13 /,
                  14 =, 15 C, 16 raiz, 17 x^2, 18 log2, 19 1/x
  CALC-CORE       CLK + codigo + pulso -> registros X/Y/OP/PEND/ERR,
                  acumulador de digito (X*10+d, satura em 99999),
                  DD-17 -> D0..D4 (BCD) + ERR + X (triplo, para depurar)
  BCD-SEG         4 bits -> 7 pinos de segmento (a..g), por mintermos
  CALC CIENTIFICA teclado + nucleo + 5 x (mux de branco/erro + BCD-SEG +
                  7-SEGMENT) + LED de erro; Displays fazem os digitos
                  aparecerem na visao de bloco

Uso: python tools/ai_style/build_calc2.py [--write]
Sem --write roda o roteiro de teclas no simseq; com --write grava os JSONs.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_ram import Builder, CHIPS  # noqa: E402
import build_calc as BC  # noqa: E402
from build_calc import addN, subN, mux2, eq0, split_triple, merge_triple, \
    triple_in, triple_out, wire_triple, MASK17  # noqa: E402

REG = {}          # nome do chip -> desc, para o simseq e para os pinos
SUF = (".LO", ".MID", ".HI")
E_PATTERN = [1, 0, 0, 1, 1, 1, 1]      # segmentos a..g do digito "E"
SEG_ON = {
    "a": [0, 2, 3, 5, 6, 7, 8, 9], "b": [0, 1, 2, 3, 4, 7, 8, 9],
    "c": [0, 1, 3, 4, 5, 6, 7, 8, 9], "d": [0, 2, 3, 5, 6, 8, 9],
    "e": [0, 2, 6, 8], "f": [0, 4, 5, 6, 8, 9], "g": [2, 3, 4, 5, 6, 8, 9],
}


def reg(d):
    REG[d["Name"]] = d
    return d


def sub(b, name):
    """Cria o subchip e devolve (sid, pinos de entrada, pinos de saida)."""
    sid = b.sub(name)
    d = REG[name]
    return (sid,
            {p["Name"]: p["ID"] for p in d["InputPins"]},
            {p["Name"]: p["ID"] for p in d["OutputPins"]})


def w3(b, sigs, sid, im, base):
    for s, su in zip(sigs, SUF):
        b.wire(s, (sid, im[base + su]))


def r3(sid, om, base):
    return [(sid, om[base + su]) for su in SUF]


def const_bits(b, value, n):
    one, zero = b.const1(), b.inv(b.const1())
    return [one if (value >> i) & 1 else zero for i in range(n)]


# ---------------------------------------------------------------- CALC-ALU

def build_alu():
    b = Builder("CALC-ALU", (0.55, 0.4, 0.65))
    A = split_triple(b, *triple_in(b, "A", 3))
    B = split_triple(b, *triple_in(b, "B", 5))
    op = [(b.in_pin("OP" + str(i), 1, 2), 0) for i in range(3)]
    one, zero = b.const1(), b.inv(b.const1())

    ad, im, om = sub(b, "ADD-17")
    w3(b, merge_triple(b, A), ad, im, "A")
    w3(b, merge_triple(b, B), ad, im, "B")
    b.wire(zero, (ad, im["CIN"]))
    s_add = split_triple(b, *r3(ad, om, "S"))

    sb, im, om = sub(b, "ADD-17")
    w3(b, merge_triple(b, A), sb, im, "A")
    w3(b, merge_triple(b, [b.inv(x) for x in B]), sb, im, "B")
    b.wire(one, (sb, im["CIN"]))
    s_sub = split_triple(b, *r3(sb, om, "S"))

    ml, im, om = sub(b, "MUL-17")
    w3(b, merge_triple(b, A), ml, im, "A")
    w3(b, merge_triple(b, B), ml, im, "B")
    s_mul = split_triple(b, *r3(ml, om, "S"))

    dv, im, om = sub(b, "DIV-17")
    rec = b.and2(op[2], b.and2(op[1], op[0]))          # op 7 = 1/x
    # 1/x = DIV(1, X): forza A = 1 (bit0 alto, resto zero), nao todos os bits.
    w3(b, merge_triple(b, [mux2(b, rec, a, one if i == 0 else zero)
                           for i, a in enumerate(A)]), dv, im, "A")
    w3(b, merge_triple(b, B), dv, im, "B")
    s_div = split_triple(b, *r3(dv, om, "Q"))
    err_div = (dv, om["ERR"])

    sq, im, om = sub(b, "SQRT-17")
    w3(b, merge_triple(b, A), sq, im, "A")
    s_sq = split_triple(b, *r3(sq, om, "R"))

    higher = zero                                      # LOG2 = posicao do MSB
    onehot = []
    for k in reversed(range(17)):
        onehot.append((k, b.and2(A[k], b.inv(higher))))
        higher = b.or2(higher, A[k])
    log = [zero] * 17
    for j in range(5):
        log[j] = b.or_tree([oh for k, oh in onehot if (k >> j) & 1])

    sel = []
    for k in range(8):
        t = one
        for j in range(3):
            t = b.and2(t, op[j] if (k >> j) & 1 else b.inv(op[j]))
        sel.append(t)
    R = []
    for i in range(17):
        cands = [s_add[i], s_sub[i], s_mul[i], s_div[i], s_sq[i], s_mul[i],
                 log[i], s_div[i]]
        v = cands[0]
        for k in range(1, 8):
            v = mux2(b, sel[k], v, cands[k])
        R.append(v)
    wire_triple(b, merge_triple(b, R), triple_out(b, "R", 4))
    b.wire(b.and2(err_div, b.or2(sel[3], sel[7])), (b.out_pin("ERR", 1, 1), 0))
    return reg(b.save())


# ---------------------------------------------------------------- teclado

def build_keypad():
    b = Builder("CALC-KEYPAD", (0.45, 0.45, 0.5))
    clk = b.in_pin("CLK", 1, 2)
    keys = [(b.sub("KEY"), 0) for _ in range(20)]
    code = []
    for j in range(5):
        code.append(b.or_tree([k for i, k in enumerate(keys) if (i >> j) & 1]))
    any_ = b.or_tree(keys)
    f, fim, fom = sub(b, "DFF")
    b.wire(any_, (f, fim["D"]))
    b.wire((clk, 0), (f, fim["CLK"]))
    b.wire(b.and2(any_, b.inv((f, fom["Q"]))), (b.out_pin("KP", 1, 6), 0))
    for j in range(5):
        b.wire(code[j], (b.out_pin("KC" + str(j), 1, 3), 0))
    return reg(b.save())


# ---------------------------------------------------------------- nucleo

def build_core():
    b = Builder("CALC-CORE", (0.35, 0.55, 0.6))
    clk = (b.in_pin("CLK", 1, 2), 0)
    kc = [(b.in_pin("KC" + str(i), 1, 3), 0) for i in range(5)]
    kp = (b.in_pin("KP", 1, 6), 0)
    one, zero = b.const1(), b.inv(b.const1())
    k0, k1, k2, k3, k4 = kc
    ge10 = b.and2(k3, b.or2(k2, k1))
    digit = b.and2(b.inv(k4), b.inv(ge10))
    binop = b.and2(b.and2(b.inv(k4), ge10), b.inv(b.and2(k2, k1)))
    eq = b.and2(b.inv(k4), b.and2(k3, b.and2(k2, b.and2(k1, b.inv(k0)))))
    clr = b.and2(b.inv(k4), b.and2(k3, b.and2(k2, b.and2(k1, k0))))
    unary = k4
    recu = b.and2(unary, b.and2(k1, k0))

    xr, im, om = sub(b, "REG-17")
    b.wire(clk, (xr, im["CLK"]))
    yr, im2, om2 = sub(b, "REG-17")
    b.wire(clk, (yr, im2["CLK"]))
    X = r3(xr, om, "Q")
    Y = r3(yr, om2, "Q")
    Xs, Ys = split_triple(b, *X), split_triple(b, *Y)

    # X*10 + d, com saturacao em 99999.  Deslocar a esquerda = prepend zeros
    # (bit i do resultado = bit i-k de X); anexar no fim e truncar [:17]
    # devolveria Xs sem deslocar.
    sh3 = [zero, zero, zero] + Xs            # X << 3  (X*8)
    sh1 = [zero] + Xs                        # X << 1  (X*2)
    a1, imA, omA = sub(b, "ADD-17")
    w3(b, merge_triple(b, sh3[:17]), a1, imA, "A")
    w3(b, merge_triple(b, sh1[:17]), a1, imA, "B")
    b.wire(zero, (a1, imA["CIN"]))
    t = split_triple(b, *r3(a1, omA, "S"))
    a2, imA, omA = sub(b, "ADD-17")
    w3(b, merge_triple(b, t), a2, imA, "A")
    dext = kc[:4] + [zero] * 13
    w3(b, merge_triple(b, dext), a2, imA, "B")
    b.wire(zero, (a2, imA["CIN"]))
    acc = split_triple(b, *r3(a2, omA, "S"))
    # Com o invariante X <= 99999,  X*10+d > 99999  <=>  X >= 10000.  Nessa
    # faixa (X < 10000) X*10+d < 100000 cabe em 17 bits, entao acc eh exato;
    # caso contrario saturamos para 99999 e acc e ignorado.
    _dif, borrow = subN(b, Xs, const_bits(b, 10000, 17))
    sat = b.inv(borrow)                      # X >= 10000
    mx = const_bits(b, 99999, 17)
    accv = [mux2(b, sat, acc[i], mx[i]) for i in range(17)]

    al, imL, omL = sub(b, "CALC-ALU")
    ysel = b.or2(binop, eq)
    # recu (1/x): A deve ser a constante 1 = bit0 alto, demais zero.
    Asel = [mux2(b, recu, mux2(b, ysel, Xs[i], Ys[i]), one if i == 0 else zero)
            for i in range(17)]
    w3(b, merge_triple(b, Asel), al, imL, "A")
    w3(b, merge_triple(b, Xs), al, imL, "B")
    # OPSEL: binarios usam codigo 10..13 -> seletor 0..3, ou seja OP0=k0 e
    # OP1=k2 (NAO k1).  '=' replay o registro; unario usa 4+(k1,k0).
    opr0, o0im, o0om = sub(b, "DFF")
    opr1, o1im, o1om = sub(b, "DFF")
    b.wire(clk, (opr0, o0im["CLK"])); b.wire(clk, (opr1, o1im["CLK"]))
    b.wire(mux2(b, b.and2(kp, binop), (opr0, o0om["Q"]), k0), (opr0, o0im["D"]))
    b.wire(mux2(b, b.and2(kp, binop), (opr1, o1om["Q"]), k2), (opr1, o1im["D"]))
    s0 = b.or2(b.and2(eq, (opr0, o0om["Q"])), b.and2(unary, k0))
    s1 = b.or2(b.and2(eq, (opr1, o1om["Q"])), b.and2(unary, k1))
    s2 = unary
    b.wire(s0, (al, imL["OP0"]))
    b.wire(s1, (al, imL["OP1"]))
    b.wire(s2, (al, imL["OP2"]))
    Rs = split_triple(b, *r3(al, omL, "R"))
    aerr = (al, omL["ERR"])

    pend, pim, pom = sub(b, "DFF")
    b.wire(clk, (pend, pim["CLK"]))
    b.wire(mux2(b, b.and2(kp, b.or2(b.or2(binop, eq), clr)), (pend, pom["Q"]), binop),
           (pend, pim["D"]))
    errf, eim, eom = sub(b, "DFF")
    b.wire(clk, (errf, eim["CLK"]))
    den = b.and2(kp, b.or2(b.or2(eq, recu), clr))
    b.wire(mux2(b, den, (errf, eom["Q"]), b.and2(aerr, b.and2(b.or2(eq, recu), b.inv(clr)))),
           (errf, eim["D"]))

    # D de X: digito -> accv; binop/clr -> 0; unario -> R; '=' com pend -> R
    useR = b.or2(unary, b.and2(eq, (pend, pom["Q"])))
    zsel = b.or2(binop, clr)                 # zera X ao iniciar operando ou C
    DX = [mux2(b, digit, mux2(b, useR, mux2(b, zsel, Xs[i], zero), Rs[i]),
               accv[i]) for i in range(17)]
    b.wire(kp, (xr, im["EN"]))
    w3(b, merge_triple(b, DX), xr, im, "D")
    b.wire(b.and2(kp, binop), (yr, im2["EN"]))
    w3(b, merge_triple(b, Xs), yr, im2, "D")

    dd, imD, omD = sub(b, "DD-17")
    w3(b, X, dd, imD, "A")
    for i in range(5):
        b.wire((dd, omD["D" + str(i)]), (b.out_pin("D" + str(i), 4, 4, 1), 0))
    b.wire((errf, eom["Q"]), (b.out_pin("ERR", 1, 1), 0))
    wire_triple(b, X, triple_out(b, "X", 4))
    for nm, sig in (("DBG_DIG", digit), ("DBG_SAT", sat), ("DBG_ACC0", acc[0]),
                    ("DBG_ACCV0", accv[0]), ("DBG_DX0", DX[0]), ("DBG_KP", kp),
                    ("DBG_USE", useR), ("DBG_BIN", binop)):
        b.wire(sig, (b.out_pin(nm, 1, 6), 0))
    return reg(b.save())


# ---------------------------------------------------------------- BCD-SEG

def build_seg():
    b = Builder("BCD-SEG", (0.6, 0.5, 0.35))
    x = [(b.in_pin("B" + str(i), 1, 3), 0) for i in range(4)]
    mint = []
    for k in range(10):
        t = b.const1()
        for j in range(4):
            t = b.and2(t, x[j] if (k >> j) & 1 else b.inv(x[j]))
        mint.append(t)
    for i, name in enumerate("abcdefg"):
        b.wire(b.or_tree([mint[k] for k in SEG_ON[name]]),
               (b.out_pin("S" + name, 1, 4), 0))
    return reg(b.save())


# ---------------------------------------------------------------- topo

def build_top():
    b = Builder("CALC CIENTIFICA", (0.3, 0.45, 0.55))
    clk = b.sub("CLOCK")
    kp_, imk, omk = sub(b, "CALC-KEYPAD")
    b.wire((clk, 0), (kp_, imk["CLK"]))
    co, imc, omc = sub(b, "CALC-CORE")
    b.wire((clk, 0), (co, imc["CLK"]))
    for i in range(5):
        b.wire((kp_, omk["KC" + str(i)]), (co, imc["KC" + str(i)]))
    b.wire((kp_, omk["KP"]), (co, imc["KP"]))
    zero = b.inv(b.const1())
    digs = [split4(b, (co, omc["D" + str(i)])) for i in range(5)]
    eqz = [eq0(b, d) for d in digs]
    blanks = [None] * 5                     # branco se este digito e os
    blanks[4] = eqz[4]                      # mais significativos sao zero
    for i in (3, 2, 1):
        blanks[i] = b.and2(blanks[i + 1], eqz[i])
    blanks[0] = zero
    segs = []
    ten = [zero, b.const1(), zero, b.const1()]     # BCD 10: nenhum segmento
    for i in range(5):
        show = [mux2(b, blanks[i], digs[i][j], ten[j]) for j in range(4)]
        sg, ims, oms = sub(b, "BCD-SEG")
        for j in range(4):
            b.wire(show[j], (sg, ims["B" + str(j)]))
        disp = b.sub("7-SEGMENT")
        for j, nm in enumerate("abcdefg"):
            ebit = E_PATTERN[j] if i == 0 else 0
            v = mux2(b, (co, omc["ERR"]), (sg, oms["S" + nm]),
                     b.const1() if ebit else zero)
            b.wire(v, (disp, j))
        b.wire(zero, (disp, 7))
        segs.append(disp)
    led = b.sub("LED")
    b.wire((co, omc["ERR"]), (led, 0))
    d = b.save()
    d["NameLocation"] = 1
    d["Displays"] = [{"SubChipID": sid,
                      "Position": {"x": 0.8 - 0.4 * i, "y": -0.15},
                      "Scale": 0.3} for i, sid in enumerate(segs)]
    return reg(d)


def split4(b, src):
    s = b.sub("4-1BIT")
    b.wire(src, (s, 0))
    return [(s, 4 - i) for i in range(4)]


# ---------------------------------------------------------------- testes

def digits_of(sim):
    out = []
    for i in range(5):
        d = sim.digit(i)
        out.append(d)
    return out


def shown(sim):
    ds = digits_of(sim)
    if ds[0] == "E":
        return "E"
    s = "".join(" " if d == " " else str(d) for d in reversed(ds))
    return s.strip() or "0"


def main(write):
    for fn in (BC.build_dff, BC.build_reg17, BC.build_add17, BC.build_mul17,
               BC.build_div17, BC.build_sqrt17, BC.build_dd17):
        reg(fn())
    chips = [build_alu(), build_keypad(), build_core(), build_seg(),
             build_top()]
    if write:
        for d in chips:
            with open(os.path.join(CHIPS, d["Name"] + ".json"), "w",
                      encoding="utf-8", newline="\n") as f:
                json.dump(d, f, indent=1, ensure_ascii=False)
        print("gravados:", ", ".join(d["Name"] for d in chips))
        return 0
    from simseq import SimSeq
    top = REG["CALC CIENTIFICA"]
    sim = SimSeq(top, extra=REG)
    sim.run(2)

    def press(code):
        sim.press(code, ticks=2)

    def expect(label, want):
        got = shown(sim)
        mark = "ok " if got == want else "ERRO"
        print(f"  {mark} {label:28s} mostra {got:>6s}  esperado {want:>6s}")
        return got == want

    ok = True
    press(1); press(2)
    ok &= expect("12", "12")
    press(10); press(7)
    ok &= expect("12+7 (mostra B)", "7")
    press(14)
    ok &= expect("=", "19")
    press(15)
    ok &= expect("C", "0")
    press(1); press(4); press(4); press(16)
    ok &= expect("144 raiz", "12")
    press(15); press(9); press(17)
    ok &= expect("9 ao quadrado", "81")
    press(15)
    for c in (1, 0, 0, 0, 0, 0):
        press(c)
    ok &= expect("100000 satura", "99999")
    press(15); press(9); press(13); press(0); press(14)
    ok &= expect("9/0", "E")
    press(15); press(2); press(5); press(5); press(18)
    ok &= expect("255 log2 (piso)", "7")
    press(15)
    for c in (1, 2, 3, 4, 5):
        press(c)
    press(10)
    for c in (5, 4, 3, 2, 1):
        press(c)
    press(14)
    ok &= expect("12345+54321", "66666")
    press(15); press(7); press(12); press(8); press(14)
    ok &= expect("7*8", "56")
    press(15); press(1); press(19)
    ok &= expect("1/1", "1")
    print("roteiro:", "TUDO OK" if ok else "HOUVE ERRO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main("--write" in sys.argv))
