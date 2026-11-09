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

  python tools/ai_style/build_ram.py
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
    b.save()


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
    b = Builder("RAM-16x8", (0.45, 0.35, 0.65))
    addr = b.in_pin("ADDR", 8, 4, 1)
    din = b.in_pin("DIN", 8, 3, 1)
    clk = b.in_pin("CLK", 1, 2)
    we = b.in_pin("WE", 1, 0)
    cs = b.in_pin("CS", 1, 5)
    dout = b.out_pin("DOUT", 8, 3, 1)

    ab = b.split8((addr, 0))[:4]
    db = b.split8((din, 0))
    wen = b.and2(b.and2((we, 0), (clk, 0)), (cs, 0))
    rows = decode(b, ab, None)
    wsel = [b.and2(r, wen) for r in rows]
    rsel = [b.and2(r, (cs, 0)) for r in rows]
    mg = b.sub("1-8BIT")
    for c in range(8):
        reads = []
        for r in range(16):
            cell = b.sub("BIT-CELL")
            b.wire(db[c], (cell, 0))
            b.wire(wsel[r], (cell, 1))
            b.wire(rsel[r], (cell, 2))
            reads.append((cell, 3))
        b.wire(b.or_tree(reads), (mg, 7 - c))
    b.wire((mg, 8), (dout, 0))
    b.save()


def build_bank(name, child, high_bits, colour):
    """RAM-64x8 (high=2) e RAM-256x8 (high=4) por composicao."""
    b = Builder(name, colour)
    addr = b.in_pin("ADDR", 8, 4, 1)
    din = b.in_pin("DIN", 8, 3, 1)
    clk = b.in_pin("CLK", 1, 2)
    we = b.in_pin("WE", 1, 0)
    cs = b.in_pin("CS", 1, 5)
    dout = b.out_pin("DOUT", 8, 3, 1)

    ab = b.split8((addr, 0))
    hb = ab[4:4 + high_bits]
    banks = decode(b, hb, (cs, 0))
    rams = []
    outs = []
    for bsel in banks:
        ram = b.sub(child)
        b.wire((addr, 0), (ram, 1))
        b.wire((din, 0), (ram, 2))
        b.wire((clk, 0), (ram, 3))
        b.wire((we, 0), (ram, 4))
        b.wire(bsel, (ram, 5))
        rams.append(ram)
        outs.append(b.split8((ram, 6)))      # abre o DOUT(8) do banco em 8 fios 1-bit
    mg = b.sub("1-8BIT")
    for c in range(8):
        b.wire(b.or_tree([o[c] for o in outs]), (mg, 7 - c))
    b.wire((mg, 8), (dout, 0))
    b.save()


def build_demo():
    b = Builder("RAM-64x8 DEMO", (0.30, 0.55, 0.45))
    addr = b.in_pin("ENDERECO", 8, 4, 1)
    din = b.in_pin("DADO IN", 8, 3, 1)
    clk = b.in_pin("CLK", 1, 2)
    we = b.in_pin("ESCREVER", 1, 0)
    dout = b.out_pin("DADO OUT", 8, 3, 1)
    ram = b.sub("RAM-64x8")
    b.wire((addr, 0), (ram, 1))
    b.wire((din, 0), (ram, 2))
    b.wire((clk, 0), (ram, 3))
    b.wire((we, 0), (ram, 4))
    b.wire(b.const1(), (ram, 5))
    b.wire((ram, 6), (dout, 0))
    b.save()


if __name__ == "__main__":
    build_bit_cell()
    build_ram16()
    build_bank("RAM-64x8", "RAM-16x8", 2, (0.55, 0.35, 0.45))
    build_bank("RAM-256x8", "RAM-64x8", 4, (0.35, 0.45, 0.55))
    build_demo()
    for n in ("BIT-CELL", "RAM-16x8", "RAM-64x8", "RAM-256x8", "RAM-64x8 DEMO"):
        d = json.load(open(os.path.join(CHIPS, n + ".json"), encoding="utf-8"))
        print("%-14s subchips=%5d fios=%5d pinos=%d/%d"
              % (n, len(d["SubChips"]), len(d["Wires"]),
                 len(d["InputPins"]), len(d["OutputPins"])))
