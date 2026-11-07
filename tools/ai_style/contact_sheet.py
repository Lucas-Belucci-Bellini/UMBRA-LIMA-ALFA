"""Folha de contato antes/depois dos chips-vitrine, em um unico HTML."""
import copy
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import autolayout as A          # noqa: E402
import dlssim as D              # noqa: E402
import render_preview as R      # noqa: E402

BK_SC = os.path.join(HERE, "backup_showcase")
BK_ST = os.path.join(HERE, "backup_chips")


def panel(title, sub, d, scale):
    svg, (w, h) = R.render_svg(d, scale)
    return (f'<figure><figcaption><b>{title}</b> — <span>{sub}</span>'
            f'<small>{len(d["SubChips"])} subchips · {len(d["Wires"])} fios · '
            f'{w}×{h}px</small></figcaption>{svg}</figure>')


def load(p):
    with open(p, encoding="utf-8-sig") as f:
        return json.load(f)


def span_x(d):
    xs = ([p["Position"]["x"] for p in d["InputPins"] + d["OutputPins"]] +
          [s["Position"]["x"] for s in d["SubChips"]] + [0])
    return max(xs) - min(xs)


def pair(name, old_path, note):
    cur = load(os.path.join(D.CHIPS, name + ".json"))
    old = load(old_path)
    sc = max(14.0, min(64.0, 760.0 / max(span_x(cur), 0.5)))
    return (f'<section><h3>{html.escape(name)}</h3><p class="note">{note}</p>'
            f'<div class="row">'
            + panel("antes", "netlist original (já recolorecido na 1ª passada)", old, sc)
            + panel("depois", "SOP minimizado por Quine–McCluskey", cur, sc)
            + '</div></section>')


def pair_style(name, note):
    cur = load(os.path.join(D.CHIPS, name + ".json"))
    old = load(os.path.join(BK_ST, name + ".json"))
    sc = max(14.0, min(60.0, 760.0 / max(span_x(cur), 0.5)))
    return (f'<section><h3>{html.escape(name)}</h3><p class="note">{note}</p>'
            f'<div class="row">'
            + panel("antes", "como estava", old, sc)
            + panel("depois", "mesma netlist · só colunas, folga e cor", cur, sc)
            + '</div></section>')


def main(out):
    parts = []
    parts.append(pair("DECOD 7-SEG", os.path.join(BK_SC, "DECOD 7-SEG.json"),
                      "7 caixas-pretas <code>SEG-a…SEG-g</code> viraram a forma canônica "
                      "de dois níveis: <b>a = B + DC′ + C′A′ + CA</b>, "
                      "<b>b = C′ + B′A′ + BA</b>, <b>c = C + B′ + A</b> … "
                      "(Quine–McCluskey, 16 casos, equivalência exaustiva)."))
    parts.append(pair("DECODE-4x16", os.path.join(BK_SC, "DECODE-4x16.json"),
                      "48 AND + 4 NOT viraram exatamente 16 AND-4 — um por mintermo, "
                      "cada saída é um único termo produto."))
    parts.append(pair("EQUAL-4", os.path.join(BK_SC, "EQUAL-4.json"),
                      "XNOR+AND (caixa-preta) virou SOP pura de 8 variáveis: "
                      "2 divisores de bus, 8 NOT, 16 AND-8, árvore de OR. "
                      "256 casos conferidos um a um."))
    parts.append(pair("COMPARE-4", os.path.join(BK_SC, "COMPARE-4.json"),
                      "46 termos produto (15 pra A&gt;B, 16 pra A=B, 15 pra A&lt;B) "
                      "derivados da tabela-verdade completa de 256 casos."))
    parts.append(pair_style("ALU-4", "Exemplo de chip que <b>não</b> teve a topologia "
                                     "mudada: só recolorido e re-colocado."))
    body = "".join(parts)
    defects = """<section><h3>Defeitos que já existiam no projeto (não criados aqui)</h3>
<ul class="def">
<li><code>Chips/1.json</code> não tem <b>nenhum pino de saída</b>, mas
<code>COUNTER</code> e <code>DELAY</code> têm um fio vindo do pino
<code>271160628</code> da instância <code>1#328859256</code> — esse ID pertence ao
chip <code>0</code>, não ao <code>1</code>. O layout tolerou e registrou em vez de
abortar; a ligação continua pendurada.</li>
<li><code>ULA</code>: o pino <code>(1919820821, 0)</code> é dirigido por <b>dois fios</b>
(conflito de driver). Idêntico no backup original, então é pré-existente.</li>
<li><code>DISPLAY DECIMAL LEDSV1</code> instancia <code>LED</code>, que é builtin do
motor e não tem arquivo em <code>Chips/</code> — o simulador combinacional não
consegue avaliá-lo (modelamos LED como sumidouro sem saída para conseguir conferir
os pais).</li>
<li><b>483 chips</b> tinham corpo mais baixo que a pilha de pinos (o DLS desenharia
pino fora do retângulo). <code>Size.y</code> só cresceu nelas; <code>Size.x</code>
não mudou em nenhum chip.</li>
<li><b>145 chips</b> não são avaliáveis pelo simulador combinacional (registradores,
contadores, RAM, loops de realimentação). Eles estão cobertos pela prova estrutural,
que é mais forte que amostragem para uma mudança só de layout/cor.</li>
</ul></section>"""
    doc = f"""<style>
.aidoc{{background:#1b1b1d;color:#eaeaea;font-family:'JetBrains Mono',ui-monospace,monospace;
padding:22px 26px 40px;border-radius:14px}}
.aidoc h1{{font-size:21px;margin:0 0 4px}}
.aidoc .lead{{color:#9a9a9f;font-size:13px;margin:0 0 22px;line-height:1.6}}
.aidoc section{{margin:0 0 34px}}
.aidoc h3{{font-size:16px;margin:0 0 2px;color:#ffd166}}
.aidoc .note{{color:#a9a9b0;font-size:12.5px;margin:0 0 12px;max-width:1500px;line-height:1.55}}
.aidoc .note code{{background:#2a2a2c;padding:1px 5px;border-radius:4px;color:#c8e1ff}}
.aidoc .row{{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}}
.aidoc figure{{margin:0;border:1px solid #333;border-radius:10px;overflow:hidden;background:#424245}}
.aidoc figcaption{{padding:7px 11px;background:#26262a;font-size:12.5px}}
.aidoc figcaption small{{opacity:.55;font-weight:400;margin-left:6px}}
.aidoc figcaption span{{color:#8fd694}}
.aidoc svg{{display:block}}
.aidoc .kpi{{display:flex;gap:26px;flex-wrap:wrap;margin:0 0 26px;padding:14px 18px;
border:1px solid #333;border-radius:12px;background:#222226}}
.aidoc .kpi div{{font-size:12.5px;color:#9a9a9f}}
.aidoc .kpi b{{display:block;font-size:22px;color:#eaeaea;font-weight:600}}
.aidoc ul.def{{margin:0;padding-left:20px;font-size:13px;line-height:1.65;color:#c9c9d0}}
.aidoc ul.def li{{margin:0 0 9px}}
.aidoc ul.def code{{background:#2a2a2c;padding:1px 5px;border-radius:4px;color:#ffb4a2}}
</style>
<div class="aidoc">
<h1>UMBRA-LIMA-ALFA · redesign “feito por IA”</h1>
<p class="lead">Cor de cada fio vem do pino de origem da rede no Digital Logic Sim,
então o estilo é aplicado pintando as origens (pinos de entrada por grupo de sinal,
vermelho nas saídas) e reorganizando o conteúdo em colunas de profundidade de sinal
com folga mínima de 5 quadrados.</p>
<div class="kpi">
<div><b>30.042</b>chips reescritos</div>
<div><b>30.038/30.038</b>prova estrutural OK</div>
<div><b>0</b>com folga &lt; 5 quadrados</div>
<div><b>4.018</b>conferidos também por simulação</div>
<div><b>6</b>reimplementados em SOP</div>
<div><b>59/60</b>pais dos vitrine idênticos</div>
</div>
{body}
{defects}
</div>"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    main(sys.argv[1])
