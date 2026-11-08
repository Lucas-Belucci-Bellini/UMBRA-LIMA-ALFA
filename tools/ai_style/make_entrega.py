"""Gera as imagens da ENTREGA (PDF da atividade) direto do JSON dos chips.

Parte 1 "Circuito Aberto": 5 capturas do DISPLAY DECIMAL (8-1BIT -> DOUBLE
DABBLE -> 3x DECOD 7-SEG -> 3x 7-SEGMENT) com a entrada de 8 bits em
00000000, 00101010, 01100100, 11000111 e 11111111 (unsigned ativado).
Parte 2 "Circuito salvo e customizado": o TESTE DISPLAY usado como bloco
customizado dentro do DEMO BLOCO DISPLAY, com 10110101 = 181.

  python tools/ai_style/make_entrega.py
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import render_delivery as R  # noqa: E402
import svg2png               # noqa: E402

OUT = os.path.join(HERE, "entrega")
CASES = [(0, "00000000"), (42, "00101010"), (100, "01100100"),
         (199, "11000111"), (255, "11111111")]
BLOCK_VALUE = 181


def shot(chip, value, scale=64):
    svg, _ = R.render(chip, value, scale)
    return svg2png.render(svg, ss=3)


def page(img, title, sub):
    band = 96
    pg = Image.new("RGB", (img.width, img.height + band), (27, 27, 29))
    d = ImageDraw.Draw(pg)
    f1 = svg2png.font(30, True)
    f2 = svg2png.font(21, False)
    d.text((28, 20), title, font=f1, fill=(246, 196, 83))
    d.text((28, 58), sub, font=f2, fill=(220, 220, 220))
    d.line([(0, band - 1), (pg.width, band - 1)], fill=(58, 58, 60), width=2)
    pg.paste(img, (0, band))
    return pg


def main():
    os.makedirs(OUT, exist_ok=True)
    pages = []
    for i, (val, binstr) in enumerate(CASES, 1):
        img = shot("DISPLAY DECIMAL", val)
        img.save(os.path.join(OUT, "parte1-caso%d-%s.png" % (i, binstr)))
        pages.append(page(img, "1. Circuito Aberto - caso %d/5" % i,
                          "Entrada de 8 bits (unsigned): %s = %d   |   centena/dezena/unidade nos 3 displays"
                          % (binstr, val)))
        print("parte1-caso%d-%s.png" % (i, binstr), img.size)

    img = shot("DEMO BLOCO DISPLAY", BLOCK_VALUE, scale=150)
    img.save(os.path.join(OUT, "parte2-bloco-customizado.png"))
    pages.append(page(img, "2. Circuito salvo e customizado",
                      "TESTE DISPLAY usado como bloco customizado, entrada %s = %d"
                      % (format(BLOCK_VALUE, "08b"), BLOCK_VALUE)))
    print("parte2-bloco-customizado.png", img.size)

    pdf = os.path.join(OUT, "entrega-display-decimal.pdf")
    pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=110)
    print(pdf)


if __name__ == "__main__":
    main()
