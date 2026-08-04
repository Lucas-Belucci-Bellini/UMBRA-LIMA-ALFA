#!/usr/bin/env python3
"""
Validador de integridade do projeto UMBRA LIMA ALFA.

Confere o que o Digital Logic Sim assume ao carregar o projeto:

  * AllCustomChipNames bate exatamente com os arquivos em Chips/
  * o campo Name de cada chip bate com o nome do arquivo
  * nenhum nome com espaco sobrando nas pontas
  * todo sub-chip referenciado existe (customizado ou embutido)
  * todo endereco de fio aponta para um dono que existe no chip
  * pino de sub-chip customizado existe de fato naquele chip
  * pino do proprio chip usa PinID 0
  * colecoes so citam chips existentes, e nenhum chip em duas colecoes
  * StarredList so aponta para colecao ou chip existente
  * nenhum chip fora de todas as colecoes

Sai com codigo 1 se achar problema novo. Problemas ja conhecidos e anteriores
a esta manutencao ficam em CONHECIDOS e saem como aviso, nao como falha.

Uso:
    python3 tools/manutencao/validar.py
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHIPS = os.path.join(ROOT, "Chips")
PROJ = os.path.join(ROOT, "ProjectDescription.json")

BUILTINS = {
    "NAND", "CLOCK", "PULSE", "3-STATE BUFFER", "dev.RAM-8", "ROM 256×16",
    "4-1BIT", "8-1BIT", "8-4BIT", "4-8BIT", "1-8BIT", "1-4BIT", "RGB DISPLAY",
    "DOT DISPLAY", "7-SEGMENT", "LED", "BUZZER", "IN-1", "IN-4", "IN-8",
    "OUT-1", "OUT-4", "OUT-8", "KEY", "BUS-1", "BUS-4", "BUS-8",
    "BUS-TERMINUS-1", "BUS-TERMINUS-4", "BUS-TERMINUS-8",
}

# Defeitos que ja existiam antes da manutencao de organizacao e que nao foram
# corrigidos porque consertar exige mudar a logica de circuitos existentes --
# decisao do dono do projeto, nao de uma limpeza.
#
# O chip '1' deveria ser o gerador da constante 1 (como '0' e da constante 0),
# mas foi sobrescrito por um rascunho de subtrator de 4 bits: ficou com duas
# entradas de 4 bits e NENHUMA saida. COUNTER e DELAY continuam pedindo a
# saida 271160628 dele, que e justamente o ID da saida do chip '0'.
# A versao em Chips.bak-20260518-200625/ ja esta igualmente corrompida, entao
# o circuito original nao da para recuperar do backup.
CONHECIDOS = {
    "COUNTER: source pino 271160628 nao existe em '1'",
    "DELAY: source pino 271160628 nao existe em '1'",
}


def main():
    with open(PROJ, encoding="utf-8") as f:
        proj = json.load(f)

    names = proj["AllCustomChipNames"]
    files = {f[:-5] for f in os.listdir(CHIPS) if f.endswith(".json")}
    err: list[str] = []

    if set(names) != files:
        err.append(f"AllCustomChipNames != arquivos: {sorted(set(names) ^ files)[:10]}")
    if len(names) != len(set(names)):
        err.append("nomes repetidos em AllCustomChipNames")

    chips = {}
    for n in names:
        with open(os.path.join(CHIPS, n + ".json"), encoding="utf-8") as f:
            chips[n] = json.load(f)

    for n, d in chips.items():
        if d.get("Name") != n:
            err.append(f"{n}: campo Name={d.get('Name')!r} difere do arquivo")
        if n != n.strip():
            err.append(f"{n!r}: espaco sobrando nas pontas do nome")

        inp = {q["ID"] for q in d["InputPins"]}
        outp = {q["ID"] for q in d["OutputPins"]}
        subs = {s["ID"]: s["Name"] for s in d.get("SubChips") or []}
        owners = inp | outp | set(subs)

        for s in d.get("SubChips") or []:
            if s["Name"] not in BUILTINS and s["Name"] not in chips:
                err.append(f"{n}: sub-chip inexistente {s['Name']!r}")

        for w in d.get("Wires") or []:
            for key, role in (("SourcePinAddress", "source"),
                              ("TargetPinAddress", "target")):
                a = w[key]
                o = a["PinOwnerID"]
                if o not in owners:
                    err.append(f"{n}: {role} com dono {o} inexistente")
                    continue
                if o in subs:
                    sn = subs[o]
                    if sn in chips:   # embutido nao da para validar sem tabela
                        ok = ({q["ID"] for q in chips[sn]["OutputPins"]}
                              if role == "source"
                              else {q["ID"] for q in chips[sn]["InputPins"]})
                        if a["PinID"] not in ok:
                            err.append(f"{n}: {role} pino {a['PinID']} nao "
                                       f"existe em {sn!r}")
                else:
                    if a["PinID"] != 0:
                        err.append(f"{n}: pino do proprio chip com "
                                   f"PinID={a['PinID']} (deveria ser 0)")
                    if role == "source" and o not in inp:
                        err.append(f"{n}: source {o} nao e InputPin")
                    if role == "target" and o not in outp:
                        err.append(f"{n}: target {o} nao e OutputPin")

    valid = set(names) | BUILTINS
    flat = []
    for c in proj["ChipCollections"]:
        flat += c["Chips"]
        for cn in c["Chips"]:
            if cn not in valid:
                err.append(f"colecao {c['Name']}: chip inexistente {cn!r}")
    dups = sorted({x for x in flat if flat.count(x) > 1})
    if dups:
        err.append(f"chip em mais de uma colecao: {dups}")

    colnames = {c["Name"] for c in proj["ChipCollections"]}
    for s in proj["StarredList"]:
        alvo = colnames if s["IsCollection"] else valid
        if s["Name"] not in alvo:
            err.append(f"StarredList aponta para algo inexistente: {s['Name']!r}")

    fora = sorted(set(names) - set(flat))
    if fora:
        err.append(f"{len(fora)} chip(s) fora de qualquer colecao: {fora[:10]}")

    novos = [e for e in err if e not in CONHECIDOS]
    velhos = [e for e in err if e in CONHECIDOS]

    print(f"{len(chips)} chips, {len(proj['ChipCollections'])} colecoes, "
          f"{len(flat)} entradas em colecoes")
    if velhos:
        print(f"\nAVISO — {len(velhos)} defeito(s) pre-existente(s), "
              f"nao corrigidos (mudariam a logica de circuitos):")
        for e in velhos:
            print("  -", e)
    if novos:
        print(f"\nFALHA — {len(novos)} problema(s):")
        for e in novos:
            print("  -", e)
        return 1
    print("\nINTEGRIDADE OK — nenhum problema novo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
