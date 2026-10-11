// build-display7.js — atividade "Display 7-seg": decodificador BCD (0..9)
// para display de 7 segmentos, montado com as expressões SIMPLIFICADAS
// pelo mapa de Karnaugh (D = bit mais significativo, A = menos).
//
//   a = (D + C + B + A')(C' + B + A)
//   b = (C' + B + A')(C' + B' + A)
//   c = C + B' + A
//   d = (D + C + B + A')(C' + B + A)(C' + B' + A')
//   e = C'A' + BA'
//   f = (D + C + A')(C + B')(B' + A')
//   g = (D + C + B)(C' + B' + A')
//
// Gera: SEG-a..SEG-g (uma saída cada), DECOD 7-SEG (D,C,B,A -> a..g) e
// DISPLAY 7-SEG, que já contém o display "7-SEGMENT" e mostra o número no
// próprio bloco do chip (campo Displays). Uso: node tools/build-display7.js

const fs = require("fs");
const path = require("path");
const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate, finalize, serialize
} = require("./lib/chip-builder");
const registry = require("./lib/pin-registry");
const { gate2, notOf, reduce } = require("./lib/logic");

const OUT_DIR = path.join(__dirname, "..", "Chips");
const PD_PATH = path.join(__dirname, "..", "ProjectDescription.json");
const COLLECTION = "DISPLAY 7-SEG";
const VARS = ["D", "C", "B", "A"];
const colour = { r: 0.85, g: 0.15, b: 0.15, a: 1.0 };

// Display de 7 segmentos builtin do DLS: entradas A..G + COL (cor),
// PinIDs posicionais 0..7, sem saídas.
registry.KNOWN["7-SEGMENT"] = {
  inputs: [0, 1, 2, 3, 4, 5, 6, 7], outputs: [], size: { x: 1.25, y: 2.0 }
};

// Literais: "A" ou "A'" (negado). Cada termo é uma lista de literais.
const SEGMENTS = {
  a: { pos: [["D", "C", "B", "A'"], ["C'", "B", "A"]] },
  b: { pos: [["C'", "B", "A'"], ["C'", "B'", "A"]] },
  c: { pos: [["C", "B'", "A"]] },
  d: { pos: [["D", "C", "B", "A'"], ["C'", "B", "A"], ["C'", "B'", "A'"]] },
  e: { sop: [["C'", "A'"], ["B", "A'"]] },
  f: { pos: [["D", "C", "A'"], ["C", "B'"], ["B'", "A'"]] },
  g: { pos: [["D", "C", "B"], ["C'", "B'", "A'"]] }
};

function buildSegment(seg) {
  const name = `SEG-${seg}`;
  const chip = newChip(name, { size: { x: 1.2, y: 1.2 }, colour });
  const pin = {};
  VARS.forEach((v) => { pin[v] = addInputPin(chip, v, 1); });
  const out = addOutputPin(chip, seg, 1);

  const neg = {};
  const lit = (l) => {
    const v = l[0];
    if (!l.endsWith("'")) return pin[v];
    if (!neg[v]) neg[v] = notOf(chip, pin[v]);
    return neg[v];
  };
  const { pos, sop } = SEGMENTS[seg];
  // POS: AND de somas (OR). SOP: OR de produtos (AND).
  const [inner, outer, terms] = pos ? ["OR", "AND", pos] : ["AND", "OR", sop];
  const t = terms.map((term) => reduce(chip, inner, term.map(lit)));
  wire(chip, t.length === 1 ? t[0] : reduce(chip, outer, t), out);

  validate(chip);
  registry.register(name, VARS, [seg]);
  return chip;
}

function buildDecoder() {
  const name = "DECOD 7-SEG";
  const chip = newChip(name, { size: { x: 1.6, y: 3.2 }, colour });
  const pin = VARS.map((v) => addInputPin(chip, v, 1));
  const segs = Object.keys(SEGMENTS);
  const out = segs.map((s) => addOutputPin(chip, s, 1));
  segs.forEach((s, i) => {
    const sc = addSubChip(chip, `SEG-${s}`, registry.KNOWN);
    pin.forEach((p, j) => wire(chip, p, sc.in(j)));
    wire(chip, sc.out(0), out[i]);
  });
  validate(chip);
  registry.register(name, VARS, segs);
  return chip;
}

function buildDisplay() {
  const name = "DISPLAY 7-SEG";
  const chip = newChip(name, { size: { x: 2.0, y: 3.0 }, colour: { r: 0.12, g: 0.12, b: 0.14, a: 1.0 } });
  chip.NameLocation = 1; // nome em cima, para não cobrir o display
  const pin = VARS.map((v) => addInputPin(chip, v, 1));
  const dec = addSubChip(chip, "DECOD 7-SEG", registry.KNOWN);
  const disp = addSubChip(chip, "7-SEGMENT", registry.KNOWN);
  pin.forEach((p, j) => wire(chip, p, dec.in(j)));
  for (let i = 0; i < 7; i++) wire(chip, dec.out(i), disp.in(i));
  validate(chip);
  finalize(chip);
  // Mostra o display do subchip no bloco do DISPLAY 7-SEG.
  chip.Displays = [{ SubChipID: disp.id, Position: { x: 0, y: -0.15 }, Scale: 1.4 }];
  registry.register(name, VARS, []);
  return chip;
}

function main() {
  // Um por vez: o layout do chip-pai usa o tamanho dos filhos já prontos.
  const builders = [...Object.keys(SEGMENTS).map((s) => () => buildSegment(s)), buildDecoder, buildDisplay];
  const chips = [];
  for (const build of builders) {
    const c = build();
    if (c.Name !== "DISPLAY 7-SEG") finalize(c);
    registry.KNOWN[c.Name].size = c.Size;
    fs.writeFileSync(path.join(OUT_DIR, `${c.Name}.json`), serialize(c), "utf8");
    chips.push(c);
  }

  const pd = JSON.parse(fs.readFileSync(PD_PATH, "utf8"));
  const names = chips.map((c) => c.Name);
  for (const n of names) if (!pd.AllCustomChipNames.includes(n)) pd.AllCustomChipNames.push(n);
  pd.ChipCollections = pd.ChipCollections || [];
  let coll = pd.ChipCollections.find((c) => c.Name === COLLECTION);
  if (!coll) {
    coll = { Chips: [], IsToggledOpen: true, Name: COLLECTION };
    pd.ChipCollections.unshift(coll);
  }
  for (const n of names) if (!coll.Chips.includes(n)) coll.Chips.push(n);
  pd.StarredList = pd.StarredList || [];
  if (!pd.StarredList.some((s) => s.Name === COLLECTION)) {
    pd.StarredList.unshift({ Name: COLLECTION, IsCollection: true });
  }
  fs.writeFileSync(PD_PATH, JSON.stringify(pd, null, 2), "utf8");
  console.log(`escritos: ${names.join(", ")}`);
}

if (require.main === module) main();
module.exports = { SEGMENTS };
