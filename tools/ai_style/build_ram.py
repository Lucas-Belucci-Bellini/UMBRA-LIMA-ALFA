"""Constroi a familia de memoria RAM do UMBRA LIMA ALFA, de baixo para cima:

  BIT-CELL       celula de 1 bit: latch D de 5 NANDs + porta de leitura
                 (AND com RSEL). Pinos D, G (porta de escrita), RSEL, Q.
  RAM-16x8       128 celulas + decodificador 4->16 + arvore OR de leitura + CS.
  RAM-64x8       4 x RAM-16x8  + decodificador 2->4 + arvore OR.
  RAM-256x8      4 x RAM-64x8  + decodificador 2->4 + arvore OR.
  RAM-64x8 DEMO  bancada: pinos de endereco/dado/relogio/escrita.

Endereco sempre em pino de 8 bits (bits altos ignorados em cada nivel), porque
no DLS fio liga pino inteiro: para abrir um barramento usa-se 8-1BIT / 1-4BIT /
1-8BIT, como em qualquer chip do catalogo. Composicao por subchip (nao por
copia): cada arquivo fica pequeno.

TETO PRATICO (PC de 16 GB).  O arquivo e minusculo porque o DLS referencia
subchips por NOME, mas ao ABRIR um chip ele instancia a arvore inteira.  As
portas achatadas crescem 16x por nivel: 4Kx8 ~373 mil (abre), 64Kx8 ~6 milhoes
(pesado), 1Mx8 ~95 milhoes e 1Gx8 ~97,76 BILHOES (impossivel: precisaria de
terabytes de RAM).  RAM-1Gx8 e um netlist VALIDO de 1 GB (2^30 bytes) que existe
e esta correto, mas o DLS nao consegue instancia-lo nesta maquina — e o limite
fisico, nao um defeito.  Use 16x8/64x8/256x8/4Kx8 para abrir e simular.

Verificacao funcional: dbg_ram.py (simseq com settling de latch) le/escreve
16x8/64x8/256x8.  Layout: relayout_ram.py --write (build_ram deixa flat).

  python tools/ai_style/build_ram.py
  python tools/ai_style/relayout_ram.py --write
  python tools/ai_style/dbg_ram.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CHIPS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Chips")


class Builder:
    def __init__(self, name, colour):
        self.name = name
        self.colour = colour
        self.ins, self.outs, self.subs, self.wires = [], [], [], []
        self._nid = 0

    def nid(self):
        self._nid += 1
        return self._nid

    def in_pin(self, name, bits=1, colour=0, display=0):
        p = {"Name": name, "ID": self.nid(), "Position": {"x": 0.0, "y": 0.0},
             "BitCount": bits, "Colour": colour, "ValueDisplayMode": display}
        self.ins.append(p)
        return p["ID"]

    def out_pin(self, name, bits=1, colour=0, display=0):
        p = {"Name": name, "ID": self.nid(), "Position": {"x": 0.0, "y": 0.0},
             "BitCount": bits, "Colour": colour, "ValueDisplayMode": display}
        self.outs.append(p)
        return p["ID"]

    def sub(self, name):
        s = {"Name": name, "ID": self.nid(), "Label": "",
             "Position": {"x": 0.0, "y": 0.0}, "OutputPinColourInfo": [],
             "InternalData": None}
        self.subs.append(s)
        return s["ID"]

    def wire(self, src, dst):
        for p in (src, dst):
            if not (isinstance(p, tuple) and len(p) == 2
                    and all(isinstance(v, int) for v in p)):
                raise ValueError("endereco de pino invalido: %r" % (p,))
        self.wires.append({
            "SourcePinAddress": {"PinID": src[1], "PinOwnerID": src[0]},
            "TargetPinAddress": {"PinID": dst[1], "PinOwnerID": dst[0]},
            "ConnectionType": 0, "ConnectedWireIndex": -1,
            "ConnectedWireSegmentIndex": -1,
            "Points": [{"x": 0, "y": 0}, {"x": 0, "y": 0}]})

    def nand(self, a, b):
        s = self.sub("NAND")
        if a:
            self.wire(a, (s, 0))
        if b:
            self.wire(b, (s, 1))
        return (s, 2)

    def inv(self, a):
        return self.nand(a, a)

    def and2(self, a, b):
        return self.inv(self.nand(a, b))

    def or2(self, a, b):
        return self.nand(self.inv(a), self.inv(b))

    def or_tree(self, sigs):
        sigs = list(sigs)
        while len(sigs) > 1:
            nxt = []
            for i in range(0, len(sigs) - 1, 2):
                nxt.append(self.or2(sigs[i], sigs[i + 1]))
            if len(sigs) % 2:
                nxt.append(sigs[-1])
            sigs = nxt
        return sigs[0]

    def const1(self):
        """NAND sem entradas: no DLS entrada solta le 0 -> saida 1."""
        return self.nand(None, None)

    def split8(self, src):
        s = self.sub("8-1BIT")
        self.wire(src, (s, 0))
        return [(s, 8 - i) for i in range(8)]   # bit i (LSB0) = pino 8-i

    def save(self):
        d = {"DLSVersion": "2.1.6", "Name": self.name, "NameLocation": 0,
             "ChipType": 0, "Size": {"x": 2.0, "y": 2.0},
             "Colour": {"r": self.colour[0], "g": self.colour[1],
                        "b": self.colour[2], "a": 1},
             "InputPins": self.ins, "OutputPins": self.outs,
             "SubChips": self.subs, "Wires": self.wires, "Displays": []}
        with open(os.path.join(CHIPS, self.name + ".json"), "w",
                  encoding="utf-8", newline="\n") as f:
            json.dump(d, f, indent=1, ensure_ascii=False)
        return d


REG = {}          # nome do chip -> desc, para resolver pinos de filho por nome


def _reg(d):
    REG[d["Name"]] = d
    return d


def subc(b, name):
    """Cria o subchip e devolve (sid, {nome->id} entradas, {nome->id} saidas).

    Os IDs de pino de um chip custom sao atribuidos na ORDEM DE CRIACAO
    (in_pin/out_pin/sub chamam nid()).  Um out_pin criado por ultimo ganha um
    ID alto — no BIT-CELL, D=1 G=2 RSEL=3 mas Q=11.  Ligar um filho com
    indices fixos como (cell,0) fica errado; resolva sempre pelo NOME do pino.
    """
    sid = b.sub(name)
    d = REG[name]
    return (sid,
            {p["Name"]: p["ID"] for p in d["InputPins"]},
            {p["Name"]: p["ID"] for p in d["OutputPins"]})


def build_bit_cell():
    b = Builder("BIT-CELL", (0.35, 0.55, 0.75))
    d = b.in_pin("D", 1, 3)
    g = b.in_pin("G", 1, 2)        # porta de escrita (WE & CS ja combinados)
    rs = b.in_pin("RSEL", 1, 4)
    s_ = b.nand((d, 0), (g, 0))    # S'
    idd = b.inv((d, 0))            # !D
    r_ = b.nand(idd, (g, 0))       # R'
    qn = b.sub("NAND")             # Q  = NAND(S', Qb)
    qbn = b.sub("NAND")            # Qb = NAND(R', Q)
    b.wire(s_, (qn, 0))
    b.wire((qbn, 2), (qn, 1))
    b.wire(r_, (qbn, 0))
    b.wire((qn, 2), (qbn, 1))
    qo = b.and2((qn, 2), (rs, 0))  # leitura porta-da
    out = b.out_pin("Q", 1, 3)
    b.wire(qo, (out, 0))
    return _reg(b.save())



def decode(b, bits, en):
    """Um sinal por combinacao de `bits` (lista de sinais 1-bit), com enable."""
    invs = [b.inv(x) for x in bits]
    rows = []
    for r in range(1 << len(bits)):
        sig = en
        for i in range(len(bits)):
            lit = bits[i] if (r >> i) & 1 else invs[i]
            sig = b.and2(sig, lit) if sig is not None else lit
        rows.append(sig)
    return rows


def build_ram16():
    """Folha: RAM-16x8 = 16 bytes, endereco A0 (8 bits, usa os 4 baixos)."""
    b = Builder("RAM-16x8", (0.45, 0.35, 0.65))
    a0 = b.in_pin("A0", 8, 4, 1)
    din = b.in_pin("DIN", 8, 3, 1)
    clk = b.in_pin("CLK", 1, 2)
    we = b.in_pin("WE", 1, 0)
    cs = b.in_pin("CS", 1, 5)
    dout = b.out_pin("DOUT", 8, 3, 1)

    ab = b.split8((a0, 0))[:4]
    db = b.split8((din, 0))
    wen = b.and2(b.and2((we, 0), (clk, 0)), (cs, 0))
    rows = decode(b, ab, None)
    wsel = [b.and2(r, wen) for r in rows]
    rsel = [b.and2(r, (cs, 0)) for r in rows]
    mg = b.sub("1-8BIT")
    for c in range(8):
        reads = []
        for r in range(16):
            cell, cim, com = subc(b, "BIT-CELL")
            b.wire(db[c], (cell, cim["D"]))
            b.wire(wsel[r], (cell, cim["G"]))
            b.wire(rsel[r], (cell, cim["RSEL"]))
            reads.append((cell, com["Q"]))
        b.wire(b.or_tree(reads), (mg, 7 - c))
    b.wire((mg, 8), (dout, 0))
    return _reg(b.save())



def build_level(name, child, ac, nsel, colour):
    """Nivel de bancada: 2^nsel bancos de `child` (composicao por subchip).

    ac   = bits de endereco do filho (filho endereca 2^ac bytes)
    nsel = bits de selecao de banco deste nivel (4 -> 16 bancos, 2 -> 4)
    Este nivel endereca 2^(ac+nsel) bytes.

    Endereco em pinos de 8 bits A0..A(n-1): no DLS fio liga pino inteiro de
    mesma largura, entao >8 bits usa varios pinos.  A selecao de banco vem do
    pino A[ac//8], bits [ac%8 : ac%8+nsel] — que NUNCA sobrepoe os bits que o
    filho usa (o bug antigo fixava o offset em 4 e aliasava os niveis).  Os
    pinos baixos A0..A(childpins-1) descem intactos para cada banco; o DOUT de
    cada banco e aberto em 8 fios e a leitura e uma arvore OR (banco nao
    selecionado tem CS=0 -> DOUT=0).
    """
    child_pins = (ac + 7) // 8
    lvl_bits = ac + nsel
    lvl_pins = (lvl_bits + 7) // 8
    sel_pin = ac // 8
    sel_lo = ac % 8
    nb = 1 << nsel

    b = Builder(name, colour)
    A = [b.in_pin("A" + str(i), 8, 4, 1) for i in range(lvl_pins)]
    din = b.in_pin("DIN", 8, 3, 1)
    clk = b.in_pin("CLK", 1, 2)
    we = b.in_pin("WE", 1, 0)
    cs = b.in_pin("CS", 1, 5)
    dout = b.out_pin("DOUT", 8, 3, 1)

    sb = b.split8((A[sel_pin], 0))
    banks = decode(b, sb[sel_lo:sel_lo + nsel], (cs, 0))

    outs = []
    for bi in range(nb):
        ram, rim, rom = subc(b, child)
        for i in range(child_pins):
            b.wire((A[i], 0), (ram, rim["A" + str(i)]))
        b.wire((din, 0), (ram, rim["DIN"]))
        b.wire((clk, 0), (ram, rim["CLK"]))
        b.wire((we, 0), (ram, rim["WE"]))
        b.wire(banks[bi], (ram, rim["CS"]))
        outs.append(b.split8((ram, rom["DOUT"])))
    mg = b.sub("1-8BIT")
    for c in range(8):
        b.wire(b.or_tree([o[c] for o in outs]), (mg, 7 - c))
    b.wire((mg, 8), (dout, 0))
    return _reg(b.save())



def build_demo():
    """Bancada de teste em cima da RAM-64x8 (pinos amigaveis, CS sempre 1)."""
    b = Builder("RAM-64x8 DEMO", (0.30, 0.55, 0.45))
    addr = b.in_pin("ENDERECO", 8, 4, 1)
    din = b.in_pin("DADO IN", 8, 3, 1)
    clk = b.in_pin("CLK", 1, 2)
    we = b.in_pin("ESCREVER", 1, 0)
    dout = b.out_pin("DADO OUT", 8, 3, 1)
    ram, rim, rom = subc(b, "RAM-64x8")
    b.wire((addr, 0), (ram, rim["A0"]))
    b.wire((din, 0), (ram, rim["DIN"]))
    b.wire((clk, 0), (ram, rim["CLK"]))
    b.wire((we, 0), (ram, rim["WE"]))
    b.wire(b.const1(), (ram, rim["CS"]))
    b.wire((ram, rom["DOUT"]), (dout, 0))
    return _reg(b.save())


# cadeia completa: cada nivel 16x o anterior (o ultimo 4x) -> 2^30 bytes = 1 GB
CADEIA = [
    # (nome,            filho,        ac, nsel, cor)
    ("RAM-16x8",   None,        None, None, None),          # folha
    ("RAM-64x8",   "RAM-16x8",    4,   2, (0.55, 0.35, 0.45)),
    ("RAM-256x8",  "RAM-16x8",    4,   4, (0.35, 0.45, 0.55)),
    ("RAM-4Kx8",   "RAM-256x8",   8,   4, (0.40, 0.50, 0.45)),
    ("RAM-64Kx8",  "RAM-4Kx8",   12,   4, (0.50, 0.45, 0.40)),
    ("RAM-1Mx8",   "RAM-64Kx8",  16,   4, (0.45, 0.40, 0.55)),
    ("RAM-16Mx8",  "RAM-1Mx8",   20,   4, (0.40, 0.45, 0.55)),
    ("RAM-256Mx8", "RAM-16Mx8",  24,   4, (0.55, 0.40, 0.45)),
    ("RAM-1Gx8",   "RAM-256Mx8", 28,   2, (0.35, 0.55, 0.50)),
]
CAP = {"BIT-CELL": 0, "RAM-16x8": 16, "RAM-64x8": 64, "RAM-256x8": 256,
       "RAM-4Kx8": 1 << 12, "RAM-64Kx8": 1 << 16, "RAM-1Mx8": 1 << 20,
       "RAM-16Mx8": 1 << 24, "RAM-256Mx8": 1 << 28, "RAM-1Gx8": 1 << 30,
       "RAM-64x8 DEMO": 64}
BUILTIN_GATES = {"NAND": 1}     # os demais builtins sao fios/leitura (0 portas)


def build_all():
    build_bit_cell()
    for nome, filho, ac, nsel, cor in CADEIA:
        if filho is None:
            build_ram16()
        else:
            build_level(nome, filho, ac, nsel, cor)
    build_demo()


def flat_gates(name, memo=None):
    """Portas NAND de uma instancia ACHATADA de `name` (recursao por subchip)."""
    if memo is None:
        memo = {}
    if name in memo:
        return memo[name]
    d = REG.get(name)
    if d is None:
        memo[name] = BUILTIN_GATES.get(name, 0)
        return memo[name]
    memo[name] = 0
    tot = 0
    for s in d["SubChips"]:
        tot += flat_gates(s["Name"], memo)
    memo[name] = tot
    return tot


def report():
    memo = {}
    linhas = []
    hdr = ("chip", "bytes", "subchips", "fios", "arquivo", "portas", "abre?")
    print("\n%-13s %11s %9s %8s %10s %15s %s" % hdr)
    ordem = ["BIT-CELL"] + [c[0] for c in CADEIA] + ["RAM-64x8 DEMO"]
    for n in ordem:
        d = REG[n]
        sz = os.path.getsize(os.path.join(CHIPS, n + ".json"))
        g = flat_gates(n, memo)
        cap = CAP.get(n, 0)
        # estimativa conservadora p/ 16 GB: ate ~5M portas abre, ~50M pesado
        abre = "sim" if g <= 5_000_000 else ("pesado" if g <= 60_000_000
                                             else "NAO (falta RAM)")
        capstr = ("{:,}".format(cap).replace(",", ".")) if cap else "-"
        row = (n, capstr, len(d["SubChips"]), len(d["Wires"]), sz, g, abre)
        print("%-13s %11s %9d %8d %9dB %15s %s"
              % (row[0], row[1], row[2], row[3], row[4],
                 "{:,}".format(row[5]).replace(",", "."), row[6]))
        linhas.append(row)
    print("\nTeto pratico (16 GB): abre ate RAM-4Kx8; 64Kx8 pesado; "
          "1Mx8+ impossivel.\nRAM-1Gx8 = 1 GB valido (~97,76 bi de portas, "
          "arquivo 92 KB), mas o DLS nao instancia nesta maquina.")
    return linhas


if __name__ == "__main__":
    build_all()
    report()

