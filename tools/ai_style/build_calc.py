"""Constroi a base aritmetica da calculadora cientifica do UMBRA LIMA-ALFA.

Convencao de barramento: nao existe pino de 17 bits nem splitter de 17 no DLS
(e fio liga pino inteiro, de mesma largura), entao todo valor de 17 bits
(0..99999, cinco digitos) viaja como TRES pinos: LO8 (bits 0-7), MID8
(bits 8-15), HI1 (bit 16). Dentro de cada chip os tres viram 17 fios de 1 bit
via 8-1BIT, e o carry atravessa os estagios normalmente.

Chips gerados aqui (combinacionais, menos DFF/REG-17 que sao sequenciais):
  DFF      flip-flop D de borda de subida (master-slave, 10 NAND)
  REG-17   registro de 17 bits com enable (triplo de pinos)
  ADD-17   soma com carry-in / carry-out
  MUL-17   A*B truncado em 17 bits + flag OV (bit descartado != 0)
  DIV-17   divisao restauradora: quociente, resto, ERR (B=0)
  SQRT-17  raiz inteira por restauracao (9 iteracoes)
  DD-17    double dabble: 17 bits -> 5 digitos BCD (5 pinos de 4 bits)

Uso: python tools/ai_style/build_calc.py [--write]
Sem --write so simula contra um modelo Python; com --write grava os JSONs.
"""

import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_ram import Builder, CHIPS  # noqa: E402
import dlssim as S  # noqa: E402

MASK17 = (1 << 17) - 1


# ---------------------------------------------------------------- primitivas

def xor2(b, a, c):
    t = b.nand(a, c)
    return b.nand(b.nand(a, t), b.nand(c, t))


def fa(b, a, c, cin):
    """Somador completo: retorna (soma, carry-out)."""
    ax = xor2(b, a, c)
    return xor2(b, ax, cin), b.or2(b.and2(a, c), b.and2(cin, ax))


def addN(b, A, B, cin):
    out, c = [], cin
    for a, bb in zip(A, B):
        s, c = fa(b, a, bb, c)
        out.append(s)
    return out, c


def subN(b, A, B):
    """A - B: retorna (diferenca, borrow_out)."""
    s, cout = addN(b, A, [b.inv(x) for x in B], b.const1())
    return s, b.inv(cout)


def mux2(b, sel, a, c):
    """sel=0 -> a, sel=1 -> c."""
    return b.or2(b.and2(b.inv(sel), a), b.and2(sel, c))


def and_tree(b, sigs):
    sigs = list(sigs)
    while len(sigs) > 1:
        nxt = [b.and2(sigs[i], sigs[i + 1]) for i in range(0, len(sigs) - 1, 2)]
        if len(sigs) % 2:
            nxt.append(sigs[-1])
        sigs = nxt
    return sigs[0]


def eq0(b, bits):
    return b.inv(b.or_tree(list(bits)))


def _src(x):
    """Aceita ID de pino do topo ou tupla (dono, pino) de subchip."""
    return x if isinstance(x, tuple) else (x, 0)


def split_triple(b, lo, mid, hi):
    """IDs/tuplas de tres pinos (8,8,1) -> 17 sinais, bit 0 primeiro."""
    sl, sm = b.sub("8-1BIT"), b.sub("8-1BIT")
    b.wire(_src(lo), (sl, 0))
    b.wire(_src(mid), (sm, 0))
    out = [(sl, 8 - i) for i in range(8)] + [(sm, 8 - i) for i in range(8)]
    out.append(_src(hi))
    return out


def merge_triple(b, bits):
    """17 sinais -> tres sinais de pino (8,8,1)."""
    ml, mm = b.sub("1-8BIT"), b.sub("1-8BIT")
    for i in range(8):                      # pino 0 do 1-8BIT eh o MSB
        b.wire(bits[i], (ml, 7 - i))
        b.wire(bits[8 + i], (mm, 7 - i))
    return (ml, 8), (mm, 8), bits[16]


def triple_in(b, name, colour=0):
    return (b.in_pin(name + ".LO", 8, colour), b.in_pin(name + ".MID", 8, colour),
            b.in_pin(name + ".HI", 1, colour))


def triple_out(b, name, colour=0, display=0):
    return (b.out_pin(name + ".LO", 8, colour, display),
            b.out_pin(name + ".MID", 8, colour, display),
            b.out_pin(name + ".HI", 1, colour, display))


def wire_triple(b, srcs, dst_ids):
    for s, d in zip(srcs, dst_ids):
        b.wire(s, (d, 0))


def pack_vals(d, **kw):
    """Nomes de pino -> IDs, para o dlssim."""
    mp = {p["Name"]: p["ID"] for p in d["InputPins"]}
    return {mp[k]: v for k, v in kw.items()}


def unpack_out(d, r, name):
    return r[name + ".LO"] | (r[name + ".MID"] << 8) | (r[name + ".HI"] << 16)


def put(d, **kw):
    """Nomes de pino de entrada -> valores, na ordem do dlssim."""
    mp = {p["Name"]: p["ID"] for p in d["InputPins"]}
    return {mp[k]: v for k, v in kw.items()}


def trin(name, v):
    return {name + ".LO": v & 255, name + ".MID": (v >> 8) & 255,
            name + ".HI": (v >> 16) & 1}


# ---------------------------------------------------------------- chips


def build_dff():
    b = Builder("DFF", (0.75, 0.45, 0.45))
    d, clk = b.in_pin("D", 1, 3), b.in_pin("CLK", 1, 2)
    ic, nd = b.inv((clk, 0)), b.inv((d, 0))
    m1 = b.nand((d, 0), ic)                 # master S'
    m2 = b.nand(nd, ic)                     # master R'
    mq, mqb = b.sub("NAND"), b.sub("NAND")
    b.wire(m1, (mq, 0)); b.wire((mqb, 2), (mq, 1))
    b.wire(m2, (mqb, 0)); b.wire((mq, 2), (mqb, 1))
    s1, s2 = b.nand((mq, 2), (clk, 0)), b.nand((mqb, 2), (clk, 0))
    q, qb = b.sub("NAND"), b.sub("NAND")
    b.wire(s1, (q, 0)); b.wire((qb, 2), (q, 1))
    b.wire(s2, (qb, 0)); b.wire((q, 2), (qb, 1))
    b.wire((q, 2), (b.out_pin("Q", 1, 4), 0))
    return b.save()


def build_reg17():
    b = Builder("REG-17", (0.35, 0.5, 0.7))
    din = triple_in(b, "D", 3)
    en, clk = b.in_pin("EN", 1, 2), b.in_pin("CLK", 1, 2)
    dout = triple_out(b, "Q", 4)
    bits = []
    for bit in split_triple(b, *din):
        f = b.sub("DFF")                    # DFF: D=1 CLK=2 Q=3
        b.wire((clk, 0), (f, 2))
        b.wire(mux2(b, (en, 0), (f, 3), bit), (f, 1))
        bits.append((f, 3))
    wire_triple(b, merge_triple(b, bits), dout)
    return b.save()


def build_add17():
    b = Builder("ADD-17", (0.3, 0.6, 0.4))
    A = split_triple(b, *triple_in(b, "A", 3))
    B = split_triple(b, *triple_in(b, "B", 5))
    cin = b.in_pin("CIN", 1, 2)
    s, cout = addN(b, A, B, (cin, 0))
    wire_triple(b, merge_triple(b, s), triple_out(b, "S", 4))
    b.wire(cout, (b.out_pin("COUT", 1, 6), 0))
    return b.save()


def build_mul17():
    b = Builder("MUL-17", (0.6, 0.4, 0.6))
    A = split_triple(b, *triple_in(b, "A", 3))
    B = split_triple(b, *triple_in(b, "B", 5))
    zero = b.inv(b.const1())
    discarded = []
    acc = None
    for i in range(17):                     # linha i: (B[i] ? A : 0) << i
        row = [b.and2(A[j], B[i]) for j in range(17 - i)]
        discarded += [b.and2(A[j], B[i]) for j in range(17 - i, 17)]
        if acc is None:
            acc = row
        else:
            s, c = addN(b, acc[i:], row, zero)
            discarded.append(c)             # carry para o bit 17: fora da faixa
            acc = acc[:i] + s
    wire_triple(b, merge_triple(b, acc), triple_out(b, "S", 4))
    b.wire(b.or_tree(discarded), (b.out_pin("OV", 1, 6), 0))
    return b.save()


def build_div17():
    b = Builder("DIV-17", (0.7, 0.5, 0.3))
    A = split_triple(b, *triple_in(b, "A", 3))
    B = split_triple(b, *triple_in(b, "B", 5))
    zero = b.inv(b.const1())
    R = [zero] * 17
    Q = [None] * 17
    for k in reversed(range(17)):           # R = (R<<1)|A[k]; se R>=B: R-=B, Q[k]=1
        rsh = [A[k]] + R[:16]
        diff, borrow = subN(b, rsh, B)
        ge = b.inv(borrow)
        R = [mux2(b, ge, rsh[t], diff[t]) for t in range(17)]
        Q[k] = ge
    wire_triple(b, merge_triple(b, Q), triple_out(b, "Q", 4))
    wire_triple(b, merge_triple(b, R), triple_out(b, "R", 6))
    b.wire(eq0(b, B), (b.out_pin("ERR", 1, 1), 0))
    return b.save()


def build_sqrt17():
    b = Builder("SQRT-17", (0.4, 0.6, 0.6))
    A = split_triple(b, *triple_in(b, "A", 3))
    zero = b.inv(b.const1())
    W = 13                                  # largura do resto durante o laco
    rem = [zero] * W
    root = [zero] * 9                       # raiz <= 362 < 512
    for k in reversed(range(9)):
        hi = A[2 * k + 1] if 2 * k + 1 < 17 else zero
        rem = [A[2 * k]] + [hi] + rem[:W - 2]              # rem<<2 | dois bits
        trial = [b.const1(), zero] + root + [zero] * (W - 11)   # (root<<2)|1
        diff, borrow = subN(b, rem, trial)
        ge = b.inv(borrow)
        rem = [mux2(b, ge, rem[t], diff[t]) for t in range(W)]
        root = [ge] + root[:8]              # root<<1 | ge
    out = root + [zero] * 8
    wire_triple(b, merge_triple(b, out), triple_out(b, "R", 4))
    return b.save()


def build_dd17():
    b = Builder("DD-17", (0.5, 0.5, 0.5))
    A = split_triple(b, *triple_in(b, "A", 3))
    zero = b.inv(b.const1())
    nib = [zero] * 20
    for step in range(17):
        for dg in range(5):                 # soma 3 em todo digito >= 5
            n = nib[dg * 4:dg * 4 + 4]
            ge5 = b.or2(n[3], b.and2(n[2], b.or2(n[1], n[0])))
            s, _ = addN(b, n, [ge5, ge5, zero, zero], zero)
            nib[dg * 4:dg * 4 + 4] = s
        nib = [A[16 - step]] + nib[:19]     # desloca 1 bit para a esquerda
    outs = []
    for dg in reversed(range(5)):           # D4 = dezena de milhar primeiro
        m = b.sub("1-4BIT")
        for i in range(4):
            b.wire(nib[dg * 4 + i], (m, 3 - i))
        outs.append(b.out_pin("D" + str(dg), 4, 4, 1))
        b.wire((m, 4), (outs[-1], 0))
    return b.save()


# ---------------------------------------------------------------- testes

def model_dd(v):
    nib = [0] * 5
    for step in range(17):
        nib = [n + 3 if n >= 5 else n for n in nib]
        bits = 0
        for dg in range(5):
            bits |= nib[dg] << (4 * dg)
        bits = (bits << 1) | ((v >> (16 - step)) & 1)
        nib = [(bits >> (4 * dg)) & 15 for dg in range(5)]
    return nib


def test(d, fn, cases):
    S.EXTRA[d["Name"]] = d
    oname = {p["ID"]: p["Name"] for p in d["OutputPins"]}
    bad = 0
    for cw in cases:
        raw = S.run(d["Name"], put(d, **cw["in"]))
        r = {oname[i]: v for i, v in raw.items()}
        if not fn(cw, r):
            bad += 1
            if bad == 1:
                print("   falhou:", cw["in"], "->", r)
    S.EXTRA.pop(d["Name"], None)
    return bad


def main(write):
    sys.setrecursionlimit(60000)
    rnd = random.Random(7)
    chips = [build_dff(), build_reg17(), build_add17(), build_mul17(),
             build_div17(), build_sqrt17(), build_dd17()]
    ok = True

    d = chips[2]
    cs = [{"in": {**trin("A", a), **trin("B", c), "CIN": k}}
          for a, c, k in [(rnd.randrange(1 << 17), rnd.randrange(1 << 17), rnd.randrange(2))
                          for _ in range(300)]]
    def f_add(cw, r):
        exp = val(cw, "A") + val(cw, "B") + cw["in"]["CIN"]
        return ((r["S.LO"] | r["S.MID"] << 8 | r["S.HI"] << 16) == exp & MASK17
                and r["COUT"] == exp >> 17)
    bad = test(d, f_add, cs)
    print(f"ADD-17  {len(d['SubChips']):5d} subchips  erros: {bad}")
    ok &= bad == 0

    d = chips[3]
    cs = [{"in": {**trin("A", a), **trin("B", c)}}
          for a, c in [(rnd.randrange(1 << 17), rnd.randrange(1 << 17)) for _ in range(300)]]
    bad = test(d, lambda cw, r: (
        (r["S.LO"] | r["S.MID"] << 8 | r["S.HI"] << 16) ==
        ((val(cw, "A") * val(cw, "B")) & MASK17) and
        r["OV"] == (val(cw, "A") * val(cw, "B") > MASK17)), cs)
    print(f"MUL-17  {len(d['SubChips']):5d} subchips  erros: {bad}")
    ok &= bad == 0

    d = chips[4]
    cs = [{"in": {**trin("A", a), **trin("B", c)}}
          for a, c in [(rnd.randrange(1 << 17), rnd.randrange(1, 1 << 17)) for _ in range(200)]]
    cs += [{"in": {**trin("A", 12345), **trin("B", 0)}}]
    bad = test(d, lambda cw, r: (
        r["ERR"] == (val(cw, "B") == 0)) and (val(cw, "B") == 0 or (
        (r["Q.LO"] | r["Q.MID"] << 8 | r["Q.HI"] << 16) == val(cw, "A") // val(cw, "B") and
        (r["R.LO"] | r["R.MID"] << 8 | r["R.HI"] << 16) == val(cw, "A") % val(cw, "B"))), cs)
    print(f"DIV-17  {len(d['SubChips']):5d} subchips  erros: {bad}")
    ok &= bad == 0

    d = chips[5]
    cs = [{"in": trin("A", a)} for a in
          ([rnd.randrange(1 << 17) for _ in range(200)] + [i * i for i in range(0, 363, 7)])]
    bad = test(d, lambda cw, r: (
        (r["R.LO"] | r["R.MID"] << 8 | r["R.HI"] << 16) == isqrt(val(cw, "A"))), cs)
    print(f"SQRT-17 {len(d['SubChips']):5d} subchips  erros: {bad}")
    ok &= bad == 0

    d = chips[6]
    cs = [{"in": trin("A", a)} for a in
          ([rnd.randrange(1 << 17) for _ in range(200)] + [0, 9, 99999, MASK17, 10000, 42])]
    bad = test(d, lambda cw, r: [r["D4"], r["D3"], r["D2"], r["D1"], r["D0"]] ==
               list(reversed(model_dd(val(cw, "A")))), cs)
    print(f"DD-17   {len(d['SubChips']):5d} subchips  erros: {bad}")
    ok &= bad == 0

    if write and ok:
        for d in chips:
            with open(os.path.join(CHIPS, d["Name"] + ".json"), "w",
                      encoding="utf-8", newline="\n") as f:
                import json
                json.dump(d, f, indent=1, ensure_ascii=False)
        print("gravados:", ", ".join(d["Name"] for d in chips))
    elif write:
        print("NAO gravou: ha teste falhando")
    return 0 if ok else 1


def val(cw, name):
    i = cw["in"]
    return i[name + ".LO"] | i[name + ".MID"] << 8 | i[name + ".HI"] << 16


def isqrt(v):
    x = v
    y = (x + 1) // 2
    while y < x:
        x = y
        y = (x + v // x) // 2
    return x


if __name__ == "__main__":
    sys.exit(main("--write" in sys.argv))
