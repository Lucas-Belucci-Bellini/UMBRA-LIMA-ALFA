"""Passada de cor do estilo "feito por IA": cada sinal do chip ganha uma cor
própria, igual às capturas de referência (A amarelo, B verde, C azul, D violeta).

No Digital Logic Sim a cor de um fio vem do PINO DE ORIGEM da rede
(WireInstance.GetColour -> SourcePin.GetStateCol). Então, para o circuito
inteiro ficar rastreável por cor, basta pintar a origem de cada rede:

  * pino de entrada do chip  -> PinDescription.Colour
  * saída de um subchip      -> SubChipDescription.OutputPinColourInfo[].PinColour

Pinos de saída do chip ficam em Vermelho (índice 0), como na referência.

Índices do enum PinColour (DLS.Description):
  0 Vermelho, 1 Laranja, 2 Amarelo, 3 Verde, 4 Azul, 5 Violeta, 6 Rosa, 7 Branco
"""

import re

# Vermelho fica de fora (é a cor "padrão" dos fios internos) e Branco também
# (some no fundo). Ordem = exatamente a da captura de referência.
PALETTE = [2, 3, 4, 5, 1, 6]  # Amarelo, Verde, Azul, Violeta, Laranja, Rosa

PIN_RED = 0

_GROUP_RE = re.compile(r"[^A-Z0-9]+")


def group_key(name):
    """'IN A1' -> 'INA', 'A[3]' -> 'A', 'B2' -> 'B', 'CLK' -> 'CLK'.

    Bits do mesmo bus compartilham a cor, que é o que faz um barramento de 8
    bits ler como UM sinal só em vez de oito rabiscos coloridos.
    """
    s = _GROUP_RE.sub("", (name or "").upper())
    s = re.sub(r"\d+$", "", s)
    return s or "PIN"


def colour_input_pins(d):
    """Pinta os pinos de entrada, uma cor por grupo de sinal, sem repetir em
    grupos vizinhos. Retorna {grupo: indice_de_cor}."""
    seen = {}
    order = []
    for p in d["InputPins"]:
        g = group_key(p.get("Name"))
        if g not in seen:
            seen[g] = PALETTE[len(order) % len(PALETTE)]
            order.append(g)
        p["Colour"] = seen[g]
    return seen


def keep_subchip_colours(d):
    """As redes internas nascem em saídas de subchip e ficam Vermelho (0), como
    na referência. Cores não-zero que já existem (ex.: os 8 bits de um 8-1BIT
    pintados um a um) são preservadas — elas só ajudam a rastreabilidade."""
    for s in d["SubChips"]:
        info = s.get("OutputPinColourInfo")
        if not info:
            continue
        for entry in info:
            entry.setdefault("PinColour", PIN_RED)


def colour_outputs_red(d):
    for p in d["OutputPins"]:
        p["Colour"] = PIN_RED


def apply(d):
    """Estiliza o dict do chip no lugar (chamar depois do layout)."""
    groups = colour_input_pins(d)
    colour_outputs_red(d)
    keep_subchip_colours(d)
    return groups
