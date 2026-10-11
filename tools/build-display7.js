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
// próprio bloco do chip (campo Displays).
//
// Até 4 dígitos, reaproveitando o DISPLAY 7-SEG:
//   DISPLAY 2/3/4-DIG BCD  um grupo D,C,B,A por dígito (M=milhar, C=centena,
//                          D=dezena, U=unidade)
//   DISPLAY BIN-n          número binário de n bits (4..13) convertido para
//                          decimal pelo BIN2BCD-n (double dabble, células ADD3)
//
// Uso: node tools/build-display7.js

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

// ---- BCD: ADD3 e BIN2BCD-n (mesma construção de lib/generators/bcd.js,
// para gerar arquivos idênticos nos dois ramos) ----
const BCD_COLOUR = { r: 236 / 255, g: 160 / 255, b: 30 / 255, a: 1.0 };
const seq = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`);

function bcdChip(name, ins, outs, sizeX = 1.8) {
  const chip = newChip(name, {
    size: { x: sizeX, y: Math.max(0.6, Math.max(ins.length, outs.length) * 0.45) },
    colour: BCD_COLOUR
  });
  const I = {};
  ins.forEach((n) => { I[n] = addInputPin(chip, n, 1); });
  const O = {};
  outs.forEach((n) => { O[n] = addOutputPin(chip, n, 1); });
  return { chip, I, O, ins, outs };
}

function buildAdd3() {
  const m = bcdChip("ADD3", seq("A", 4), seq("S", 4), 1.4);
  const c = m.chip;
  const and = (a, b) => gate2(c, "AND", a, b), or = (a, b) => gate2(c, "OR", a, b);
  const xor = (a, b) => gate2(c, "XOR", a, b);
  const [a0, a1, a2, a3] = seq("A", 4).map((n) => m.I[n]);
  const g = or(a3, and(a2, or(a1, a0)));
  // + 0011·g quando o dígito vale 5 ou mais
  const c0 = and(a0, g);
  wire(c, xor(a0, g), m.O.S0);
  wire(c, xor(xor(a1, g), c0), m.O.S1);
  const c1 = or(and(a1, g), and(c0, xor(a1, g)));
  wire(c, xor(a2, c1), m.O.S2);
  wire(c, xor(a3, and(a2, c1)), m.O.S3);
  validate(c);
  registry.register(m.chip.Name, m.ins, m.outs);
  return c;
}

const digitsOf = (n) => String(2 ** n - 1).length;

// Double dabble combinacional: antes de cada deslocamento, todo dígito que
// pode valer >= 5 passa por um ADD3. Bits que são sempre 0 vêm do chip "0".
function buildBin2Bcd(n) {
  const nd = digitsOf(n);
  const m = bcdChip(`BIN2BCD-${n}`, seq("B", n), seq("D", 4 * nd));
  const c = m.chip;
  let z = null;
  const zero = () => { if (!z) z = addSubChip(c, "0", registry.KNOWN).out(0); return z; };
  let bcd = new Array(4 * nd).fill(null);
  for (let i = n - 1; i >= 0; i--) {
    for (let d = 0; d < nd; d++) {
      const g = bcd.slice(4 * d, 4 * d + 4);
      if (g[3] || (g[2] && (g[1] || g[0]))) {
        const cell = addSubChip(c, "ADD3", registry.KNOWN);
        g.forEach((b, j) => wire(c, b || zero(), cell.in(j)));
        for (let j = 0; j < 4; j++) bcd[4 * d + j] = cell.out(j);
      }
    }
    bcd = [m.I[`B${i}`], ...bcd.slice(0, 4 * nd - 1)];
  }
  bcd.forEach((b, i) => wire(c, b || zero(), m.O[`D${i}`]));
  validate(c);
  registry.register(c.Name, m.ins, m.outs);
  return c;
}

// ---- displays de vários dígitos ----
const DIGIT_PREFIX = ["M", "C", "D", "U"]; // milhar, centena, dezena, unidade

// Monta o bloco com N DISPLAY 7-SEG lado a lado (mais significativo à
// esquerda). `feed(chip, k)` devolve os 4 refs D,C,B,A do dígito k (0 = MSD).
function multiDisplay(name, nDigits, insForSize, buildInputs) {
  const pinsH = insForSize * 0.25 + 0.5;
  const chip = newChip(name, {
    size: { x: +(1.6 * nDigits + 0.4).toFixed(2), y: Math.max(3.0, pinsH) },
    colour: { r: 0.12, g: 0.12, b: 0.14, a: 1.0 }
  });
  chip.NameLocation = 1;
  const feed = buildInputs(chip);
  const digits = [];
  for (let k = 0; k < nDigits; k++) {
    const d = addSubChip(chip, "DISPLAY 7-SEG", registry.KNOWN);
    feed(k).forEach((ref, j) => wire(chip, ref, d.in(j)));
    digits.push(d);
  }
  validate(chip);
  finalize(chip);
  chip.Displays = digits.map((d, k) => ({
    SubChipID: d.id,
    Position: { x: +((k - (nDigits - 1) / 2) * 1.6).toFixed(2), y: 0 },
    Scale: 1
  }));
  return chip;
}

function buildMultiBcd(nDigits) {
  const pref = DIGIT_PREFIX.slice(4 - nDigits);
  const ins = pref.flatMap((p) => VARS.map((v) => `${p}-${v}`));
  const chip = multiDisplay(`DISPLAY ${nDigits}-DIG BCD`, nDigits, ins.length, (c) => {
    const I = {};
    ins.forEach((n) => { I[n] = addInputPin(c, n, 1); });
    return (k) => VARS.map((v) => I[`${pref[k]}-${v}`]);
  });
  registry.register(chip.Name, ins, []);
  return chip;
}

function buildBinDisplay(n) {
  const nd = digitsOf(n);
  const ins = Array.from({ length: n }, (_, i) => `B${n - 1 - i}`); // MSB primeiro
  const chip = multiDisplay(`DISPLAY BIN-${n}`, nd, n, (c) => {
    const I = {};
    ins.forEach((nm) => { I[nm] = addInputPin(c, nm, 1); });
    const conv = addSubChip(c, `BIN2BCD-${n}`, registry.KNOWN);
    for (let i = 0; i < n; i++) wire(c, I[`B${i}`], conv.in(i));
    // dígito k (0 = mais significativo) usa os bits D(4j+3)..D(4j), j = nd-1-k
    return (k) => {
      const j = nd - 1 - k;
      return [3, 2, 1, 0].map((b) => conv.out(4 * j + b));
    };
  });
  registry.register(chip.Name, ins, []);
  return chip;
}

function main() {
  // Um por vez: o layout do chip-pai usa o tamanho dos filhos já prontos.
  const builders = [
    ...Object.keys(SEGMENTS).map((s) => () => buildSegment(s)), buildDecoder, buildDisplay,
    buildAdd3,
    ...Array.from({ length: 10 }, (_, i) => () => buildBin2Bcd(i + 4)),
    ...[2, 3, 4].map((d) => () => buildMultiBcd(d)),
    ...Array.from({ length: 10 }, (_, i) => () => buildBinDisplay(i + 4))
  ];
  const chips = [];
  for (const build of builders) {
    const c = build();
    if (!c.Name.startsWith("DISPLAY")) finalize(c);
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

// Nomes de todos os chips que este script escreve (o verify-catalog conta
// estes como extras além do catálogo de 30.000).
function chipNames() {
  return [
    ...Object.keys(SEGMENTS).map((s) => `SEG-${s}`), "DECOD 7-SEG", "DISPLAY 7-SEG", "ADD3",
    ...Array.from({ length: 10 }, (_, i) => `BIN2BCD-${i + 4}`),
    ...[2, 3, 4].map((d) => `DISPLAY ${d}-DIG BCD`),
    ...Array.from({ length: 10 }, (_, i) => `DISPLAY BIN-${i + 4}`)
  ];
}

if (require.main === module) main();
module.exports = { SEGMENTS, chipNames };
