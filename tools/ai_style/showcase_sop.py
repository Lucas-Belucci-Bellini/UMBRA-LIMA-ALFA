"""Redesenho topologico "feito por IA" dos chips-vitrine.

Descobre a funcao booleana REAL de um chip varrendo sua tabela-verdade com o
simulador dlssim, minimiza com Quine-McCluskey e reconstruye a netlist na forma
canonica de dois niveis:

    entradas -> coluna NOT -> coluna AND (produtos) -> arvore de OR -> saidas

Regras inegociaveis:
  * InputPins[].ID e OutputPins[].ID sao preservados byte a byte. Os chips-pai
    ligam fios nesses IDs; mexer neles quebraria todos que usam este chip.
  * So SubChips, Wires, Size e cor sao reescritos.
  * Antes de gravar, a tabela-verdade nova e comparada com a antiga, caso a caso.
  * Backup vai para backup_showcase/ (o backup_chips/ original nao pode ser
    sobrescrito: ele guarda a versao pre-estilo do `apply_style`).
"""
import argparse
import copy
import itertools
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import apply_style as S          # noqa: E402
import autolayout as A           # noqa: E402
import colorize as C             # noqa: E402
import dlssim as D               # noqa: E402

AND_BY_FANIN = {2: "AND", 3: "AND-3", 4: "AND-4", 8: "AND-8", 16: "AND-16", 32: "AND-32"}
OR_BY_FANIN = {2: "OR", 3: "OR-3", 4: "OR-4", 8: "OR-8", 16: "OR-16", 32: "OR-32"}
NOT_CHIP, ZERO_CHIP, ONE_CHIP = "NOT", "0", None

# Pinos dos builtins do motor (nao existem como arquivo em Chips/).
BUILTIN_PINS = {
    "4-1BIT": ([0], [1, 2, 3, 4]),
    "8-1BIT": ([0], list(range(1, 9))),
    "1-4BIT": ([1, 2, 3, 4], [0]),
    "1-8BIT": ([1, 2, 3, 4, 5, 6, 7, 8], [0]),
}

# Um pino de bus do chip NAO e w pinos de 1 bit: e um unico pino que carrega o
# valor inteiro. Para virar literal de porta tem que passar por um divisor.
SPLIT_BY_WIDTH = {1: None, 4: "4-1BIT", 8: "8-1BIT"}

# Camadas de cor (indice do PinColour do DLS):
#   6 Rosa   = literais complementados (coluna NOT)
#   5 Violeta= termos produto (coluna AND)
#   2..4/3   = escolhidos por C.PALETTE para as entradas, Vermelho p/ saidas
COL_NOT, COL_AND, COL_CONST = 6, 5, 1


# ------------------------------------------------------------- pinos/casos ----
def input_vars(d):
    return [(p["Name"], p["ID"], int(p.get("BitCount", 1))) for p in d["InputPins"]]


def flatten(pinvals):
    """Valores por pino -> vetor de bits (MSB primeiro dentro de um bus)."""
    bits = []
    for (_n, _i, w), v in pinvals:
        bits += [(v >> (w - 1 - j)) & 1 for j in range(w)]
    return bits


def var_labels(d):
    vs = input_vars(d)
    dup = len({n for n, _p, _w in vs}) != len(vs)
    labs = []
    for i, (name, _pid, w) in enumerate(vs):
        base = f"P{i}.{name}" if dup else name
        labs += [base] if w == 1 else [f"{base}{w - 1 - j}" for j in range(w)]
    return labs


def all_cases(d):
    vs = input_vars(d)
    for combo in itertools.product(*[range(1 << w) for _n, _i, w in vs]):
        pinvals = list(zip(vs, combo))
        yield {pid: v for (_n, pid, _w), v in pinvals}, flatten(pinvals)


def truth_table(name):
    d = D.load(name)
    outs = [(p["Name"], p["ID"], int(p.get("BitCount", 1))) for p in d["OutputPins"]]
    rows = {}
    for case, bits in all_cases(d):
        res = D.run(name, case)
        rows[tuple(bits)] = {oid: res.get(oid) for _n, oid, _w in outs}
    return d, rows, outs, var_labels(d)


# ------------------------------------------------------- Quine-McCluskey -----
def prime_implicants(minterms, nvars):
    terms = {(m, 0) for m in minterms}
    primes = set()
    while terms:
        used, merged = set(), set()
        tl = sorted(terms)
        for i, a in enumerate(tl):
            for b in tl[i + 1:]:
                if a[1] != b[1]:
                    continue
                x = a[0] ^ b[0]
                if x == 0 or (x & (x - 1)) != 0:
                    continue
                merged.add((a[0] | x, a[1] | x))
                used.add(a)
                used.add(b)
        primes |= terms - used
        terms = merged - primes
    return sorted(primes)


def cover_min(minterms, primes, nvars):
    """Menor cobertura exata: essenciais primeiro, depois DFS com poda."""
    cov = [frozenset(m for m in minterms if (m & ~pm) == (pv & ~pm))
           for pv, pm in primes]
    chosen = set()
    for pi, c in enumerate(cov):
        if not c:
            continue
        # PI essencial = cobre ao menos um minterm que nenhum outro cobre
        if any(sum(1 for cq in cov if m in cq) == 1 for m in c):
            chosen.add(pi)
    need = (set(minterms) - set().union(*[cov[p] for p in chosen])
            if chosen else set(minterms))
    cand = sorted((p for p in range(len(cov)) if p not in chosen and cov[p] & need),
                  key=lambda p: -len(cov[p]))
    best = None
    budget = [400_000]

    def dfs(i, uncovered, acc):
        nonlocal best
        budget[0] -= 1
        if budget[0] <= 0:
            raise TimeoutError("DFS de cobertura estourou o orcamento")
        if not uncovered:
            if best is None or len(acc) < len(best):
                best = list(acc)
            return
        if i >= len(cand) or (best is not None and len(acc) + 1 >= len(best)):
            return
        for j in range(i, len(cand)):
            gain = cov[cand[j]] & uncovered      # o que este termo AINDA cobre
            if not gain:
                continue
            acc.append(cand[j])
            dfs(j + 1, uncovered - gain, acc)
            acc.pop()

    if need:
        try:
            dfs(0, set(need), [])
        except TimeoutError:
            # fallback guloso: continua correto, so nao e o minimo absoluto
            best, left = [], set(need)
            pool = list(cand)
            while left:
                p = max(pool, key=lambda q: len(cov[q] & left))
                if not (cov[p] & left):
                    break
                best.append(p)
                pool.remove(p)
                left -= cov[p]
            if left:
                raise RuntimeError("cobertura gulosa falhou")
        if best is None:
            raise RuntimeError("cobertura exata falhou")
        chosen |= set(best)
    out = []
    for pi in sorted(chosen):
        pv, pm = primes[pi]
        out.append([(k, (pv >> (nvars - 1 - k)) & 1)
                    for k in range(nvars) if not (pm >> (nvars - 1 - k)) & 1])
    out.sort(key=lambda t: (len(t), t))
    return out


# ------------------------------------------------------------- construtor ----
class Net:
    __slots__ = ("owner", "pin", "colour")

    def __init__(self, owner, pin, colour):
        self.owner, self.pin, self.colour = owner, pin, colour


class Builder:
    def __init__(self, base):
        self.d = copy.deepcopy(base)
        self.used = ({p["ID"] for p in base["InputPins"]} |
                    {p["ID"] for p in base["OutputPins"]} |
                    {s["ID"] for s in base["SubChips"]})
        self.subs, self.wires = [], []
        self._pin_cache = {}
        self.zero = None
        self.one = None

    def pins(self, name):
        if name not in self._pin_cache:
            if name in BUILTIN_PINS:
                self._pin_cache[name] = BUILTIN_PINS[name]
            else:
                c = D.load(name)
                self._pin_cache[name] = ([p["ID"] for p in c["InputPins"]],
                                         [p["ID"] for p in c["OutputPins"]])
        return self._pin_cache[name]

    def new_id(self, label):
        h = 2654435761
        for ch in (label + "|" + str(len(self.subs))).encode():
            h = ((h ^ ch) * 16777619) & 0x7FFFFFFF
        h = h % 1900000000 + 10000000
        while h in self.used:
            h = (h * 31 + 7) % 1900000000 + 1
        self.used.add(h)
        return h

    def add(self, name, colour=0):
        ins, outs = self.pins(name)
        sid = self.new_id(name)
        self.subs.append({"Name": name, "ID": sid, "Label": "",
                          "Position": {"x": 0, "y": 0},
                          "OutputPinColourInfo": [{"PinColour": colour, "PinID": oid}
                                                  for oid in outs],
                          "InternalData": None})
        return sid, outs

    def connect(self, src, dst_owner, dst_pin):
        self.wires.append({
            "SourcePinAddress": {"PinID": src.pin, "PinOwnerID": src.owner},
            "TargetPinAddress": {"PinID": dst_pin, "PinOwnerID": dst_owner},
            "ConnectionType": 0, "ConnectedWireIndex": -1,
            "ConnectedWireSegmentIndex": -1, "Points": [{"x": 0, "y": 0}]})

    def const0(self):
        """Constante 0 = o chip `0` (nenhuma entrada, saida sempre baixa)."""
        if self.zero is None:
            zid, zouts = self.add(ZERO_CHIP, COL_CONST)
            self.zero = Net(zid, zouts[0], COL_CONST)
        return self.zero

    def const1(self):
        """Constante 1 = NOT(0). So e instanciada se algum gate precisar de
        entradas sobrando (AND-8 com 5 literais, por exemplo)."""
        if self.one is None:
            z = self.const0()
            nid, nouts = self.add(NOT_CHIP, COL_CONST)
            self.connect(z, nid, self.pins(NOT_CHIP)[0][0])
            self.one = Net(nid, nouts[0], COL_CONST)
        return self.one

    def gate(self, table, literals, colour):
        fanin = len(literals)
        if fanin == 1:
            return literals[0]
        cand = [s for s in table if s >= fanin]
        if not cand:
            raise RuntimeError(f"gate de {fanin} entradas fora do repertorio")
        size = min(cand)
        name = table[size]
        sid, outs = self.add(name, colour)
        din = self.pins(name)[0]
        for i, L in enumerate(literals):
            self.connect(L, sid, din[i])
        for i in range(fanin, size):
            self.connect(self.const1(), sid, din[i])
        return Net(sid, outs[0], colour)


# ------------------------------------------------------------------ rebuild ----
def rebuild(name, verbose=True):
    before, rows, outs, labels = truth_table(name)
    if any(w != 1 for _n, _i, w in outs):
        raise RuntimeError("saida multi-bit ainda nao e expandida por bit")
    nvars = len(labels)
    if nvars > 10:
        raise RuntimeError(f"{nvars} variaveis: variante demais para varrer")

    cases = list(rows)
    if len(cases) > 20000:
        raise RuntimeError(f"{len(cases)} casos: acima do teto de varredura exaustiva")
    per_out = {}
    for o_name, o_id, _w in outs:
        ones = [int("".join(map(str, b)), 2) for b in cases if rows[b][o_id]]
        per_out[o_name] = cover_min(ones, prime_implicants(ones, nvars), nvars) \
            if ones else []

    if verbose:
        print(f"  {len(cases)} casos | {nvars} var {labels}")
        for o_name, terms in per_out.items():
            txt = " + ".join("".join(labels[i] + ("" if v else "'") for i, v in t)
                             for t in terms) or "0"
            print(f"    {o_name} = {txt}")

    b = Builder(before)
    C.apply(b.d)                                  # pinta entradas/saidas do novo dict
    srcs = []
    for pin in b.d["InputPins"]:
        w = int(pin.get("BitCount", 1))
        col, pid = pin["Colour"], pin["ID"]
        if w == 1:
            srcs.append(Net(pid, 0, col))
            continue
        splitter = SPLIT_BY_WIDTH.get(w)
        if splitter is None:
            raise RuntimeError(f"bus de {w} bits sem divisor no repertorio")
        sid, outs_ = b.add(splitter, col)
        b.connect(Net(pid, 0, col), sid, b.pins(splitter)[0][0])
        srcs += [Net(sid, oid, col) for oid in outs_]

    notnets = {}

    def literal(k, val):
        if val:
            return srcs[k]
        if k not in notnets:
            sid, outs_ = b.add(NOT_CHIP, COL_NOT)
            b.connect(srcs[k], sid, b.pins(NOT_CHIP)[0][0])
            notnets[k] = Net(sid, outs_[0], COL_NOT)
        return notnets[k]

    term_cache = {}

    def and_net(term):
        key = tuple(term)
        if key not in term_cache:
            lits = [literal(i, v) for i, v in term]
            # termo vazio = o produto constante 1 (funcao sempre verdadeira)
            term_cache[key] = b.gate(AND_BY_FANIN, lits, COL_AND) if lits \
                else b.const1()
        return term_cache[key]

    for o_name, o_id, _w in outs:
        terms = per_out[o_name]
        nets = []
        for t in terms:
            n = and_net(t)
            k = (n.owner, n.pin)
            if k not in {(x.owner, x.pin) for x in nets}:
                nets.append(n)
        if not nets:                       # saida sempre 0
            b.connect(b.const0(), o_id, 0)
            continue
        src = nets[0] if len(nets) == 1 else _or_tree(b, nets)
        b.connect(src, o_id, 0)

    after = b.d
    after["SubChips"] = b.subs
    after["Wires"] = b.wires
    # Displays preservado como estava (alguns chips gravam null, outros [])
    after["Displays"] = copy.deepcopy(before.get("Displays", []))
    # Size PRESERVADO: o footprint do filho e o que os pais ja redesenharam.
    # Mexer aqui deslocaria os pinos e descolaria os fios de todos os pais.
    # Como os pinos de entrada/saida nao mudaram, a altura que ja servia serve.
    after["Size"] = dict(before["Size"])
    after = A.layout(after)
    assert S.min_pin_height(after) <= after["Size"]["y"] + 1e-9, \
        "corpo nao comporta os pinos"
    return before, after, per_out, rows, outs, labels


def _or_tree(b, nets):
    cur = list(nets)
    while len(cur) > 1:
        nxt = []
        for i in range(0, len(cur), 4):
            grp = cur[i:i + 4]
            nxt.append(b.gate(OR_BY_FANIN, grp, C.PIN_RED) if len(grp) > 1 else grp[0])
        cur = nxt
    return cur[0]


# ---------------------------------------------------------------- verifica ----
def check_pins(before, after):
    sig = lambda d, k: [(p["Name"], p["ID"], int(p.get("BitCount", 1))) for p in d[k]]
    for k in ("InputPins", "OutputPins"):
        if sig(before, k) != sig(after, k):
            raise RuntimeError(f"{k} mudou (nome/ID/ordem) -- quebraria os chips-pai")
    bi, ai = {p["ID"] for p in before["InputPins"]}, {p["ID"] for p in after["InputPins"]}
    if bi != ai:
        raise RuntimeError("IDs de entrada divergem")


def check_truth(name, before, after, rows, outs):
    orig = D._cache.get(name)
    D._memo.clear()
    D.EXTRA[name] = after
    try:
        bad = 0
        for case, bits in all_cases(before):
            res = D.run(name, case)
            for _on, oid, _ow in outs:
                if res.get(oid) != rows[tuple(bits)][oid]:
                    bad += 1
                    if bad <= 5:
                        print(f"    DIVERGE bits={''.join(map(str, bits))} out={oid}: "
                              f"novo={res.get(oid)} antigo={rows[tuple(bits)][oid]}")
    finally:
        D.EXTRA.pop(name, None)
        D._cache[name] = orig
        D._memo.clear()
    if bad:
        raise RuntimeError(f"{bad} divergencias na tabela-verdade")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--names", nargs="+", required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    backup = os.path.join(HERE, "backup_showcase")
    os.makedirs(backup, exist_ok=True)
    for name in args.names:
        print(f"\n### {name}")
        bk = os.path.join(backup, name + ".json")
        # Re-rodar tem que ser idempotente: a fonte da verdade e o backup da
        # primeira passagem, nao o arquivo ja reescrito em Chips/.
        src = bk if os.path.exists(bk) else os.path.join(D.CHIPS, name + ".json")
        try:
            with open(src, encoding="utf-8-sig") as f:
                before = json.load(f)
            D._cache[name] = before
            D._has_disp.pop(name, None)
            D._memo.clear()
            _b, after, per_out, rows, outs, labels = rebuild(name)
            check_pins(before, after)
            check_truth(name, before, after, rows, outs)
        except Exception as e:
            print("  FALHA:", e)
            continue
        kinds = Counter(s["Name"] for s in after["SubChips"])
        print(f"  subs={len(after['SubChips'])} {dict(kinds)}")
        print(f"  wires={len(after['Wires'])} size={after['Size']} "
              f"gap={S.min_gap_squares(after):.1f}  EQUIVALENTE (exaustivo)")
        if args.write:
            if not os.path.exists(bk):
                with open(bk, "w", encoding="utf-8") as f:
                    json.dump(before, f, indent=2, ensure_ascii=False)
            dst = os.path.join(D.CHIPS, name + ".json")
            tmp = dst + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(after, f, indent=2, ensure_ascii=False)
            os.replace(tmp, dst)
            print("  gravado:", dst)


if __name__ == "__main__":
    main()
