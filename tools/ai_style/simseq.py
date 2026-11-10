"""Simulador clockado para chips sequenciais do DLS.

O dlssim.py so resolve circuitos combinatorios (recursao sobre a netlist);
qualquer realimentacao por latch vira RecursionError. Aqui a netlist eh
achatada (subchips custom recursivamente; builtins de bit viram nos de
copia/permuta) e os DFF ficam como elementos de estado: a nuvem
combinatoria entre eles eh um DAG, avaliado em ordem topologica, uma vez
por fase do relogio.

Modelo: cada pino carrega um FEIXE de sinais de 1 bit (lista, bit 0 = LSB).
Nos:
  src   fonte externa (pino de entrada do topo, CLOCK, KEY): outs = bits do
        valor em meta["value"]
  nand  out = !(a&b); entrada nao fiada le 0
  dff   ins D, CLK; out Q = estado; captura D na borda de subida de CLK
  copy  outs[i] = ins[perm[i]]  (fiação de pino, splitters, merges, bus,
        portas de subchip, pinos de saida)
  seg   7-SEGMENT: so leitura (guarda o feixe de 8 entradas)

Uso:
    sim = SimSeq(desc)                 # desc do chip de topo (dict ja lido)
    sim.set_input("NOME", valor)       # pino de entrada do topo
    sim.hold_key(indice, ticks)        # KEY builtin pressionada
    sim.tick()                         # fase clk=0 + fase clk=1 + borda
    sim.digit(i) / sim.out("NOME")     # leituras
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CHIPS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Chips")

SEG_DIGITS = {  # padrao dos segmentos a..g (bits 0..6) -> digito
    0b0111111: 0, 0b0000110: 1, 0b1011011: 2, 0b1001111: 3, 0b1100110: 4,
    0b1101101: 5, 0b1111101: 6, 0b0000111: 7, 0b1111111: 8, 0b1101111: 9,
    0b1111001: "E", 0b1110111: "A", 0b0000000: " ",
}


class Node:
    __slots__ = ("kind", "ins", "outs", "perm", "name", "meta")

    def __init__(self, kind, nins, nouts, name="", perm=None):
        self.kind = kind
        self.ins = [None] * nins
        self.outs = [None] * nouts
        self.perm = perm
        self.name = name
        self.meta = {}


class SimSeq:
    def __init__(self, desc, chips_dir=CHIPS, extra=None):
        self.chips_dir = chips_dir
        self.extra = extra or {}
        self.nodes = []
        self.dffs = []
        self.clocks = []
        self.keys = []
        self.segs = []
        self.ext_in = {}
        self.ext_out = {}
        self.val = [0]
        self.sig_n = 1
        recv, srcs = self._build(desc, "")
        self._resolve(desc, recv, srcs)
        self._topo()
        self.cur = [0] * (self.sig_n + 1)
        self.eval()                      # estado inicial assentado

    # ---------------------------------------------------------------- build
    def sig(self):
        self.sig_n += 1
        return self.sig_n

    def add(self, n):
        self.nodes.append(n)
        return n

    def _build(self, desc, prefix):
        """Devolve (recv, srcs) do nivel: chaves -> (no, slot) / feixe."""
        recv, srcs = {}, {}
        for p in desc["InputPins"]:
            w = p["BitCount"]
            n = self.add(Node("src", 0, w, name=prefix + p["Name"]))
            n.outs = [self.sig() for _ in range(w)]
            n.meta["value"] = 0
            srcs[("in", p["ID"])] = n.outs
            if prefix == "":
                self.ext_in[p["Name"]] = n
        for s in desc["SubChips"]:
            sid, nm = s["ID"], s["Name"]
            if nm == "NAND":
                n = self.add(Node("nand", 2, 1, name=prefix + "N"))
                n.outs[0] = self.sig()
                recv[(sid, 0)], recv[(sid, 1)] = [(n, 0)], [(n, 1)]
                srcs[(sid, 2)] = n.outs
            elif nm == "DFF":
                # DFF ideal (borda de subida).  Resolve os pinos POR NOME do
                # DFF.json real: Q eh criado por ultimo e ganha ID alto (13),
                # nao 3.  Hardcodar 3 ligava o pino errado no DLS de verdade.
                if not hasattr(self, "_dff_pm"):
                    with open(os.path.join(self.chips_dir, "DFF.json"),
                              encoding="utf-8") as f:
                        dd = json.load(f)
                    self._dff_pm = {p["Name"]: p["ID"]
                                    for p in dd["InputPins"] + dd["OutputPins"]}
                pm = self._dff_pm
                n = self.add(Node("dff", 2, 1, name=prefix + "DFF"))
                n.outs[0] = self.sig()
                n.meta["state"] = 0
                n.meta["pclk"] = 0
                recv[(sid, pm["D"])], recv[(sid, pm["CLK"])] = [(n, 0)], [(n, 1)]
                srcs[(sid, pm["Q"])] = n.outs
                self.dffs.append(n)
            elif nm == "CLOCK":
                n = self.add(Node("src", 0, 1, name=prefix + "CLOCK"))
                n.outs[0] = self.sig()
                n.meta["value"] = 0
                n.meta["clock"] = True
                srcs[(sid, 0)] = n.outs
                self.clocks.append(n)
            elif nm == "KEY":
                n = self.add(Node("src", 0, 1, name=prefix + "KEY"))
                n.outs[0] = self.sig()
                n.meta["value"] = 0
                n.meta["key"] = True
                srcs[(sid, 0)] = n.outs
                self.keys.append(n)
            elif nm == "7-SEGMENT":
                n = self.add(Node("seg", 8, 0, name=prefix + "7SEG"))
                for i in range(8):
                    recv[(sid, i)] = [(n, i)]
                self.segs.append(n)
            elif nm == "LED":
                n = self.add(Node("seg", 1, 0, name=prefix + "LED"))
                recv[(sid, 0)] = [(n, 0)]
                self.segs.append(n)
            elif nm == "8-1BIT":
                n = self.add(Node("copy", 8, 8, name=prefix + "8-1BIT",
                                  perm=[7 - j for j in range(8)]))
                n.outs = [self.sig() for _ in range(8)]
                recv[(sid, 0)] = [(n, i) for i in range(8)]
                for k in range(8):            # pino k+1 = bit 7-k
                    srcs[(sid, k + 1)] = [n.outs[k]]
            elif nm == "4-1BIT":
                n = self.add(Node("copy", 4, 4, name=prefix + "4-1BIT",
                                  perm=[3 - j for j in range(4)]))
                n.outs = [self.sig() for _ in range(4)]
                recv[(sid, 0)] = [(n, i) for i in range(4)]
                for k in range(4):
                    srcs[(sid, k + 1)] = [n.outs[k]]
            elif nm == "1-8BIT":
                n = self.add(Node("copy", 8, 8, name=prefix + "1-8BIT",
                                  perm=[7 - i for i in range(8)]))
                n.outs = [self.sig() for _ in range(8)]
                for k in range(8):            # pino k = bit 7-k
                    recv[(sid, k)] = [(n, k)]
                srcs[(sid, 8)] = list(n.outs)
            elif nm == "1-4BIT":
                n = self.add(Node("copy", 4, 4, name=prefix + "1-4BIT",
                                  perm=[3 - i for i in range(4)]))
                n.outs = [self.sig() for _ in range(4)]
                for k in range(4):
                    recv[(sid, k)] = [(n, k)]
                srcs[(sid, 4)] = list(n.outs)
            elif nm == "8-4BIT":
                n = self.add(Node("copy", 8, 8, name=prefix + "8-4BIT",
                                  perm=list(range(8))))
                n.outs = [self.sig() for _ in range(8)]
                recv[(sid, 0)] = [(n, i) for i in range(8)]
                srcs[(sid, 1)] = n.outs[4:8]      # bits 7-4
                srcs[(sid, 2)] = n.outs[0:4]      # bits 3-0
            elif nm == "4-8BIT":
                n = self.add(Node("copy", 8, 8, name=prefix + "4-8BIT",
                                  perm=list(range(8))))
                n.outs = [self.sig() for _ in range(8)]
                recv[(sid, 0)] = [(n, i) for i in range(4)]   # bits 7-4
                recv[(sid, 1)] = [(n, i) for i in range(4, 8)]
                srcs[(sid, 2)] = list(n.outs)
            elif nm in ("BUS-1", "BUS-4", "BUS-8"):
                w = int(nm[-1])
                n = self.add(Node("copy", w, w, name=prefix + nm,
                                  perm=list(range(w))))
                n.outs = [self.sig() for _ in range(w)]
                recv[(sid, 0)] = [(n, i) for i in range(w)]
                srcs[(sid, 1)] = list(n.outs)
            elif nm == "BUZZER" or nm in ("DOT DISPLAY", "RGB DISPLAY"):
                raise ValueError("builtin nao suportado pelo simseq: " + nm)
            else:
                child = self.extra.get(nm)
                if child is None:
                    with open(os.path.join(self.chips_dir, nm + ".json"),
                              encoding="utf-8") as f:
                        child = json.load(f)
                crecv, csrcs = self._build(child, prefix + nm + ".")
                for p in child["InputPins"]:      # portas: copia no pai
                    n = self.add(Node("copy", p["BitCount"], p["BitCount"],
                                      name=prefix + nm + "<in " + p["Name"] + ">",
                                      perm=list(range(p["BitCount"]))))
                    n.outs = csrcs[("in", p["ID"])]
                    recv[(sid, p["ID"])] = [(n, i) for i in range(p["BitCount"])]
                for p in child["OutputPins"]:
                    n = self.add(Node("copy", p["BitCount"], p["BitCount"],
                                      name=prefix + nm + "<out " + p["Name"] + ">",
                                      perm=list(range(p["BitCount"]))))
                    n.outs = [self.sig() for _ in range(p["BitCount"])]
                    crecv[("out", p["ID"])] = [(n, i) for i in range(p["BitCount"])]
                    srcs[(sid, p["ID"])] = n.outs
                # re-resolve o filho agora que as portas de saida existem
                self._resolve(child, crecv, csrcs)
        for p in desc["OutputPins"]:
            if prefix != "":
                continue            # o pai cria a copia de porta dele
            w = p["BitCount"]
            n = self.add(Node("copy", w, w, name=prefix + "OUT:" + p["Name"],
                              perm=list(range(w))))
            n.outs = [self.sig() for _ in range(w)]
            recv[("out", p["ID"])] = [(n, i) for i in range(w)]
            self.ext_out[p["Name"]] = n
        return recv, srcs

    def _wire_map(self, wires, recv, srcs, desc):
        for w in wires:
            sa, ta = w["SourcePinAddress"], w["TargetPinAddress"]
            sk = ("in", sa["PinOwnerID"]) if sa["PinOwnerID"] == 0 else (sa["PinOwnerID"], sa["PinID"])
            tk = ("out", ta["PinOwnerID"]) if ta["PinOwnerID"] == 0 else (ta["PinOwnerID"], ta["PinID"])
            src = srcs.get(sk)
            dst = recv.get(tk)
            if src is None or dst is None:
                continue
            for i, (node, slot) in enumerate(dst):
                if i < len(src):
                    node.ins[slot] = src[i]

    def _resolve(self, desc, recv, srcs):
        in_ids = {p["ID"] for p in desc["InputPins"]}
        out_ids = {p["ID"] for p in desc["OutputPins"]}
        for w in desc["Wires"]:
            sa, ta = w["SourcePinAddress"], w["TargetPinAddress"]
            sk = ("in", sa["PinOwnerID"]) if sa["PinOwnerID"] in in_ids \
                else (sa["PinOwnerID"], sa["PinID"])
            tk = ("out", ta["PinOwnerID"]) if ta["PinOwnerID"] in out_ids \
                else (ta["PinOwnerID"], ta["PinID"])
            src = srcs.get(sk)
            dst = recv.get(tk)
            if src is None or dst is None:
                continue
            for i, (node, slot) in enumerate(dst):
                if i < len(src):
                    node.ins[slot] = src[i]

    # ---------------------------------------------------------------- eval
    def _topo(self):
        """Ordem de avaliacao dos nos nand/copy.

        Kahn puro DESCARTA nos em ciclo e tudo que esta a jusante deles: o
        BIT-CELL (NANDs cruzados) forma ciclo, entao o latch inteiro e a arvore
        de leitura sumiriam da ordem e DOUT ficaria sempre 0.  Aqui, quando o
        Kahn trava, forcamos a entrada de um no ainda nao colocado (quebrando o
        ciclo) e continuamos; assim TODOS os nand/copy entram na ordem.  A
        realimentacao converge por iteracao de ponto fixo em eval().
        """
        drv = {}
        for n in self.nodes:
            for s in n.outs:
                if s:
                    drv[s] = n
        ev = [n for n in self.nodes if n.kind in ("nand", "copy")]
        indeg = {id(n): 0 for n in self.nodes}
        adj = {}
        for n in ev:
            seen = set()
            for s in n.ins:
                d = drv.get(s) if s is not None else None
                if d is not None and id(d) not in seen:
                    seen.add(id(d))
                    adj.setdefault(id(d), []).append(n)
                    indeg[id(n)] += 1
        order = []
        placed = set()
        ready = [n for n in ev if indeg[id(n)] == 0]
        total = len(ev)
        while len(placed) < total:
            while ready:
                n = ready.pop()
                if id(n) in placed:
                    continue
                order.append(n)
                placed.add(id(n))
                for m in adj.get(id(n), []):
                    indeg[id(m)] -= 1
                    if indeg[id(m)] == 0 and id(m) not in placed:
                        ready.append(m)
            if len(placed) < total:      # ciclo: força um no e retoma o Kahn
                for n in ev:
                    if id(n) not in placed:
                        ready.append(n)
                        break
        self.order = order
        self.drv = drv

    def eval(self, settle=64):
        """Semeia fontes/DFF e avalia a nuvem combinacional.

        `settle` iteracoes ate estabilizar: circuitos aciclicos (a calculadora)
        convergem em 1 passada e a 2a nao muda nada -> para cedo.  Latches
        (BIT-CELL = NANDs cruzados) formam ciclo; iterar a partir de self.cur
        (que retém o estado anterior) os resolve e preserva a memoria no hold.
        """
        cur = self.cur
        for n in self.nodes:
            if n.kind == "src":
                v = n.meta["value"]
                for i, s in enumerate(n.outs):
                    cur[s] = (v >> i) & 1
            elif n.kind == "dff":
                cur[n.outs[0]] = n.meta["state"]
        for _ in range(settle):
            changed = False
            for n in self.order:
                if n.kind == "nand":
                    a = cur[n.ins[0]] if n.ins[0] else 0
                    bb = cur[n.ins[1]] if n.ins[1] else 0
                    nv = 0 if (a and bb) else 1
                    if cur[n.outs[0]] != nv:
                        cur[n.outs[0]] = nv
                        changed = True
                elif n.kind == "copy":
                    for i, s in enumerate(n.outs):
                        j = n.perm[i]
                        nv = cur[n.ins[j]] if (j < len(n.ins) and n.ins[j]) else 0
                        if cur[s] != nv:
                            cur[s] = nv
                            changed = True
            if not changed:
                break


    def tick(self):
        clks = self.clocks or ([self.ext_in["CLK"]] if "CLK" in self.ext_in
                               else [])
        for c in clks:
            c.meta["value"] = 0
        self.eval()
        # clk de cada DFF na fase baixa: a borda de subida acontece DENTRO
        # deste tick (o relogio e forcado 0 -> 1), entao capturamos quando o
        # clk do DFF estava 0 antes e 1 depois.  Um "pclk" pegajoso entre
        # ticks falharia: o relogio termina alto todo tick e a borda nunca
        # seria re-detectada.
        pre = [self.cur[n.ins[1]] if n.ins[1] else 0 for n in self.dffs]
        for c in clks:
            c.meta["value"] = 1
        self.eval()
        for i, n in enumerate(self.dffs):
            clk = self.cur[n.ins[1]] if n.ins[1] else 0
            d = self.cur[n.ins[0]] if n.ins[0] else 0
            if clk == 1 and pre[i] == 0:
                n.meta["state"] = d


    def run(self, ticks):
        for _ in range(ticks):
            self.tick()

    # ---------------------------------------------------------------- API
    def set_input(self, name, value):
        self.ext_in[name].meta["value"] = value

    def press(self, key_index, ticks=2):
        """Segura a KEY de indice key_index por `ticks` ticks inteiros."""
        self.keys[key_index].meta["value"] = 1
        self.run(ticks)
        self.keys[key_index].meta["value"] = 0
        self.run(1)

    def out(self, name):
        n = self.ext_out[name]
        v = 0
        for i, s in enumerate(n.outs):
            v |= self.cur[s] << i
        return v

    def seg_bits(self, i):
        n = self.segs[i]
        v = 0
        for k, s in enumerate(n.ins):
            v |= (self.cur[s] if s else 0) << k
        return v

    def digit(self, i):
        return SEG_DIGITS.get(self.seg_bits(i) & 0x7F, "?")
