#!/usr/bin/env python3
"""
Limpeza e reorganizacao do projeto UMBRA LIMA ALFA.

Corrige defeitos concretos encontrados na auditoria e reorganiza as colecoes
que viraram gaveta de bagunca (LOGIC e OTHER), sem tocar nas colecoes geradas
por `tools/generate-chips.js`, que ja sao consistentes.

O que faz:

  1. Funde 'OR-4 ' em 'OR-4'          (duplicata exata, IDs de pino diferentes,
                                       10 chips referenciam -> remapeia os pinos)
  2. Remove 'Half Adder '             (duplicata exata, mesmos IDs, 0 referencias)
  3. Renomeia 'Buffer ' -> 'Buffer'   (0 referencias, sem homonimo)
  4. Registra 'EXERCICIO-ROL8'        (arquivo existia sem entrada -> invisivel)
  5. Tira 'Full/Half Subtractor' das colecoes duplicadas
  6. Normaliza DLSVersion de todos os chips
  7. Reorganiza LOGIC / OTHER / BASIC / ARITHMETIC em colecoes com sentido

NAO mexe na ordem de AllCustomChipNames: o ChipLibrary indexa por nome num
Dictionary, entao a ordem nao afeta o carregamento.

Uso:
    python3 tools/manutencao/organizar.py [--dry-run]
"""

from __future__ import annotations

import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHIPS = os.path.join(ROOT, "Chips")
PROJ = os.path.join(ROOT, "ProjectDescription.json")

DLS_VERSION = "2.1.6"          # versao declarada pelo proprio projeto

DRY = "--dry-run" in sys.argv
log: list[str] = []


def say(msg):
    log.append(msg)
    print(msg)


def load_chip(name):
    with open(os.path.join(CHIPS, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def save_chip(name, desc):
    if DRY:
        return
    with open(os.path.join(CHIPS, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(desc, f, indent=2, ensure_ascii=False)


def all_chip_files():
    return sorted(f[:-5] for f in os.listdir(CHIPS) if f.endswith(".json"))


# ==========================================================================
# 1. Fundir 'OR-4 ' em 'OR-4'
#
# As duas sao o mesmo OR de 4 entradas (verificado por simulacao nas 16
# combinacoes), mas com IDs de pino diferentes. Trocar so o nome quebraria a
# fiacao dos chips que a usam, entao os IDs sao remapeados por posicao.
# ==========================================================================
def merge_or4(names):
    old, new = "OR-4 ", "OR-4"
    if old not in names:
        return names

    d_old, d_new = load_chip(old), load_chip(new)
    pin_map = {}
    for a, b in zip(d_old["InputPins"], d_new["InputPins"]):
        pin_map[a["ID"]] = b["ID"]
    for a, b in zip(d_old["OutputPins"], d_new["OutputPins"]):
        pin_map[a["ID"]] = b["ID"]

    touched = 0
    for cname in all_chip_files():
        if cname == old:
            continue
        d = load_chip(cname)
        subs = d.get("SubChips") or []
        ids = {s["ID"] for s in subs if s["Name"] == old}
        if not ids:
            continue

        for s in subs:
            if s["Name"] == old:
                s["Name"] = new
                for info in s.get("OutputPinColourInfo") or []:
                    info["PinID"] = pin_map.get(info["PinID"], info["PinID"])

        for w in d.get("Wires") or []:
            for key in ("SourcePinAddress", "TargetPinAddress"):
                a = w[key]
                if a["PinOwnerID"] in ids:
                    a["PinID"] = pin_map.get(a["PinID"], a["PinID"])

        save_chip(cname, d)
        touched += 1

    if not DRY:
        os.remove(os.path.join(CHIPS, old + ".json"))
    names = [n for n in names if n != old]
    say(f"1. 'OR-4 ' fundida em 'OR-4' — {touched} chip(s) atualizados, "
        f"{len(pin_map)} pinos remapeados")
    return names


# ==========================================================================
# 2 e 3. Duplicata sem referencias e renomeacao simples
# ==========================================================================
def drop_half_adder(names):
    old = "Half Adder "
    if old not in names:
        return names
    if not DRY:
        os.remove(os.path.join(CHIPS, old + ".json"))
    say(f"2. {old!r} removida (duplicata exata de 'Half Adder', 0 referencias)")
    return [n for n in names if n != old]


def rename_buffer(names):
    old, new = "Buffer ", "Buffer"
    if old not in names:
        return names
    d = load_chip(old)
    d["Name"] = new
    if not DRY:
        save_chip(new, d)
        os.remove(os.path.join(CHIPS, old + ".json"))
    say(f"3. {old!r} renomeada para {new!r}")
    return [new if n == old else n for n in names]


# ==========================================================================
# 4. Registrar o chip orfao
# ==========================================================================
def register_orphan(names):
    files = set(all_chip_files())
    if DRY:
        # Em dry-run os arquivos nao foram removidos ainda, entao ignora os
        # que as etapas anteriores ja tiraram da lista.
        files -= {"OR-4 ", "Half Adder ", "Buffer "}
    orphans = sorted(files - set(names))
    for o in orphans:
        names.append(o)
        say(f"4. {o!r} registrado em AllCustomChipNames (estava invisivel no app)")
    if not orphans:
        say("4. nenhum chip orfao")
    return names


# ==========================================================================
# 6. Normalizar DLSVersion
#
# Chip sem DLSVersion e tratado como 2.0.0 e passa pela migracao
# UpdateChipPre_2_1_5, que remapeia as cores dos pinos a cada carregamento.
# ==========================================================================
def normalize_versions():
    counts = {}
    changed = 0
    for name in all_chip_files():
        d = load_chip(name)
        v = d.get("DLSVersion")
        counts[v] = counts.get(v, 0) + 1
        if v != DLS_VERSION:
            d["DLSVersion"] = DLS_VERSION
            save_chip(name, d)
            changed += 1
    say(f"6. DLSVersion normalizado para {DLS_VERSION} em {changed} chip(s) "
        f"(antes: {counts})")


# ==========================================================================
# 7. Reorganizacao das colecoes bagunçadas
# ==========================================================================
# Colecoes geradas por tools/generate-chips.js: consistentes, nao sao tocadas.
KEEP_AS_IS = {
    "IN/OUT", "MERGE/SPLIT", "BUS", "DISPLAY", "MEMORY", "SUBTRACTORS",
    "MULTI-GATES", "GATE BANKS", "ADDERS", "INC / DEC", "ARITHMETIC+",
    "COMPARATORS", "MUX / DEMUX", "ENCODE / DECODE", "SHIFTERS", "FLIP-FLOPS",
    "COUNTERS", "SHIFT REGISTERS", "PARITY / BITCOUNT", "LOGIC UTILS",
    "UTILITIES",
}

# Destino explicito para os chips que estavam em LOGIC / OTHER / BASIC /
# ARITHMETIC. Tudo que nao aparecer aqui cai em REVISAR, para nada sumir.
NEW_LAYOUT = [
    ("PORTAS BASICAS", [
        "NAND", "AND", "OR", "NOT", "XOR", "XNOR", "NOR", "1", "0",
    ]),
    ("PORTAS 8 BITS (LEGADO)", [
        "AND-8 Bits", "AND-3 8 bits", "NAND-8Bits", "OR-8 Bits", "NOT-8 Bits",
        "XOR - 8 BIT", "8x2-AND", "8x2-OR", "8x2-XOR", "8-1AND",
        "16 para 8 e 4 bits",
    ]),
    # Separado de ADDERS (que e gerada por generate-chips.js e so tem os
    # Ripple Adders) para nao misturar chip feito a mao com chip gerado.
    ("SOMADORES BASICOS", [
        "Half Adder", "Full Adder", "Full Adder - 8 Bits", "2-bit Adder",
        "4-bit Adder", "8-bit Adder", "(8 Bits) 8-bit Adder", "8 - Bits Adder",
        "8 - Bits ADD", "1-ADD", "4-ADD", "8-ADD",
    ]),
    ("TEMPORIZACAO", [
        "CLOCK", "PULSE", "DELAY", "DELAY1", "DELAY2", "DELAY-RNG", "8-DELAY",
        "RISE", "RISE2", "RISE3", "T-400",
    ]),
    ("PROJETOS", [
        "ULA", "COMPUTER", "COMPUTER-FIB", "LFSR", "COUNTER", "2-BIT_MULT",
        "NEGATE-8", "ui",
    ]),
    ("BUFFERS / SELECAO", [
        "3-STATE BUFFER", "BYTE 3-STATE BUFFER", "Buffer", "LONGIFY",
        "SELECT-2", "4-8MUX", "1-8MUX", "2-8MUX", "EQUAL-4",
    ]),
    ("ENTRADA / SAIDA FISICA", [
        "KEY", "BUZZER",
    ]),
    ("RASCUNHO", [
        "Teste 1", "Teste 2", "EXERCICIO-ROL8",
    ]),
]

# Chips que pertencem a uma colecao ja existente (gerada) e estavam soltos
# nas gavetas. Cada um vai para a colecao indicada, sem duplicar.
TO_EXISTING = {
    # Portas de 3 e 4 entradas moram junto com AND-5..AND-32.
    "MULTI-GATES": ["AND-3", "AND-4", "OR-3", "OR-4", "NAND-3", "NAND-4",
                    "XNOR-3", "XNOR-4"],
    # Latches ficam com os flip-flops.
    "FLIP-FLOPS": ["D - Latch", "SR-latch"],
    "SUBTRACTORS": ["Half Subtractor", "Full Subtractor", "half sub"],
    "SHIFTERS": ["UP DWN SHIFT"],
    "MEMORY": ["4 - BITS Resgister", "SYNC_REG"],
}


def reorganize(proj, names):
    old_cols = {c["Name"]: list(c["Chips"]) for c in proj["ChipCollections"]}
    messy = [n for n in old_cols if n not in KEEP_AS_IS]
    pool = []
    for n in messy:
        pool += old_cols[n]

    # Deduplica preservando a ordem.
    seen = set()
    pool = [c for c in pool if not (c in seen or seen.add(c))]

    valid = set(names) | BUILTINS
    placed = set()
    new_cols = []

    for cname, wanted in NEW_LAYOUT:
        chips = [c for c in wanted if c in valid]
        placed.update(chips)
        new_cols.append({"Chips": chips, "IsToggledOpen": True, "Name": cname})

    leftovers = [c for c in pool if c not in placed and c in valid]
    if leftovers:
        new_cols.append({"Chips": leftovers, "IsToggledOpen": True,
                         "Name": "REVISAR"})

    # Reconstroi a lista final: as novas colecoes primeiro, depois as mantidas.
    kept = [c for c in proj["ChipCollections"] if c["Name"] in KEEP_AS_IS]

    # Move para as colecoes ja existentes os chips que estavam soltos.
    moved = set()
    for c in kept:
        for x in TO_EXISTING.get(c["Name"], []):
            if x not in valid:
                continue
            if x not in c["Chips"]:
                c["Chips"].append(x)
            # Marca como realocado mesmo se ja estava aqui: a colecao mantida e
            # a dona do chip, entao ele tem de sair da gaveta de revisao (senao
            # a deduplicacao o tiraria justamente da colecao certa).
            placed.add(x)
            moved.add(x)

    # Tira de REVISAR o que acabou de ser realocado.
    for c in new_cols:
        if c["Name"] == "REVISAR":
            c["Chips"] = [x for x in c["Chips"] if x not in moved]
    new_cols = [c for c in new_cols if c["Chips"]]

    proj["ChipCollections"] = new_cols + kept

    # Nenhum chip pode aparecer em duas colecoes: mantem a primeira ocorrencia.
    flat = [x for c in proj["ChipCollections"] for x in c["Chips"]]
    dups = sorted({x for x in flat if flat.count(x) > 1})
    seen_flat = set()
    for c in proj["ChipCollections"]:
        deduped = []
        for x in c["Chips"]:
            if x in seen_flat:
                continue
            seen_flat.add(x)
            deduped.append(x)
        c["Chips"] = deduped
    if dups:
        say(f"5. duplicatas removidas das colecoes: {dups}")
    else:
        say("5. nenhuma duplicata entre colecoes")

    say(f"7. colecoes reorganizadas: {len(messy)} bagunçadas "
        f"({', '.join(messy)}) viraram {len(new_cols)} com sentido; "
        f"{len(kept)} colecoes geradas mantidas intactas")
    return proj


BUILTINS = {
    "NAND", "CLOCK", "PULSE", "3-STATE BUFFER", "dev.RAM-8", "ROM 256×16",
    "4-1BIT", "8-1BIT", "8-4BIT", "4-8BIT", "1-8BIT", "1-4BIT", "RGB DISPLAY",
    "DOT DISPLAY", "7-SEGMENT", "LED", "BUZZER", "IN-1", "IN-4", "IN-8",
    "OUT-1", "OUT-4", "OUT-8", "KEY", "BUS-1", "BUS-4", "BUS-8",
    "BUS-TERMINUS-1", "BUS-TERMINUS-4", "BUS-TERMINUS-8",
}


def main():
    if DRY:
        say("*** DRY RUN — nada sera gravado ***\n")

    with open(PROJ, encoding="utf-8") as f:
        proj = json.load(f)
    names = list(proj["AllCustomChipNames"])
    before = len(names)

    names = merge_or4(names)
    names = drop_half_adder(names)
    names = rename_buffer(names)
    names = register_orphan(names)

    proj["AllCustomChipNames"] = names
    proj = reorganize(proj, names)

    # StarredList so pode apontar para colecao ou chip existente. As colecoes
    # que foram dissolvidas dao lugar as novas, para o usuario nao perder os
    # atalhos da barra de baixo.
    colnames = {c["Name"] for c in proj["ChipCollections"]}
    valid = set(names) | BUILTINS
    kept_star, dropped = [], []
    for s in proj["StarredList"]:
        ok = s["Name"] in colnames if s["IsCollection"] else s["Name"] in valid
        (kept_star if ok else dropped).append(s)

    starred_names = {s["Name"] for s in kept_star}
    for cname, _ in NEW_LAYOUT:
        if cname in colnames and cname not in starred_names:
            kept_star.append({"Name": cname, "IsCollection": True})
            starred_names.add(cname)

    proj["StarredList"] = kept_star
    if dropped:
        say(f"   StarredList: {len(dropped)} entrada(s) obsoleta(s) "
            f"({', '.join(s['Name'] for s in dropped)}) trocadas pelas "
            f"colecoes novas")

    normalize_versions()

    if not DRY:
        with open(PROJ, "w", encoding="utf-8") as f:
            json.dump(proj, f, indent=2, ensure_ascii=False)

    say(f"\nAllCustomChipNames: {before} -> {len(names)}")
    say(f"Colecoes: {len(proj['ChipCollections'])}")


if __name__ == "__main__":
    main()
