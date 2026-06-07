// logic-utils.js — utilitários combinacionais: Gray code, constantes,
// buffers, majority, AOI/OAI, detectores is-zero / is-ones / sign.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, reduce, notOf } = require("../logic");

const CAT = "LOGICUTIL";
const namesP = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`);

// Conversor binário -> Gray
function buildGrayEnc(bits) {
  const name = `GRAY-ENC-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.4, y: Math.max(0.6, bits * 0.35) },
    colour: palette.colourOf(CAT)
  });
  const B = namesP("B", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -7, y: (bits - i) * 0.6 }));
  const G = namesP("G", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 6, y: (bits - i) * 0.6 }));
  for (let i = 0; i < bits; i++) {
    if (i === bits - 1) {
      wire(chip, B[i], G[i]);
    } else {
      wire(chip, gate2(chip, "XOR", B[i], B[i + 1], 0), G[i]);
    }
  }
  validate(chip);
  registry.register(name, namesP("B", bits), namesP("G", bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Conversor Gray -> binário
function buildGrayDec(bits) {
  const name = `GRAY-DEC-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.4, y: Math.max(0.6, bits * 0.35) },
    colour: palette.colourOf(CAT)
  });
  const G = namesP("G", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -7, y: (bits - i) * 0.6 }));
  const B = namesP("B", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 6, y: (bits - i) * 0.6 }));
  const bRef = new Array(bits);
  bRef[bits - 1] = G[bits - 1];
  wire(chip, G[bits - 1], B[bits - 1]);
  for (let i = bits - 2; i >= 0; i--) {
    bRef[i] = gate2(chip, "XOR", G[i], bRef[i + 1], i);
    wire(chip, bRef[i], B[i]);
  }
  validate(chip);
  registry.register(name, namesP("G", bits), namesP("B", bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Constante: todos os bits 0 ou todos 1.
function buildConstant(bits, value) {
  const name = value ? `ONES-${bits}` : `ZERO-${bits}`;
  const chip = newChip(name, {
    size: { x: 0.9, y: Math.max(0.5, bits * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const O = namesP("O", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 5, y: (bits - i) * 0.6 }));
  const zero = addSubChip(chip, "0", registry.KNOWN, { position: { x: -2, y: 0 } });
  let src = zero.out(0);
  if (value) {
    const not1 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: 1, y: 0 } });
    wire(chip, zero.out(0), not1.in(0));
    src = not1.out(0);
  }
  for (let i = 0; i < bits; i++) wire(chip, src, O[i]);
  validate(chip);
  registry.register(name, [], namesP("O", bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Buffer N bits: passa-direto (entrada -> saída).
function buildBuffer(bits) {
  const name = `BUFFER-${bits}`;
  const chip = newChip(name, {
    size: { x: 0.9, y: Math.max(0.5, bits * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const A = namesP("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -5, y: (bits - i) * 0.6 }));
  const O = namesP("O", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 4, y: (bits - i) * 0.6 }));
  for (let i = 0; i < bits; i++) wire(chip, A[i], O[i]);
  validate(chip);
  registry.register(name, namesP("A", bits), namesP("O", bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// combinações de tamanho k de [0..n-1]
function combos(n, k) {
  const res = [];
  const pick = (start, acc) => {
    if (acc.length === k) { res.push(acc.slice()); return; }
    for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return res;
}

// Majority gate (N ímpar): 1 se mais da metade das entradas é 1.
function buildMajority(n) {
  const name = `MAJ-${n}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, n * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const ins = namesP("I", n).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (n - i) * 0.6 }));
  const out = addOutputPin(chip, "OUT", 1, { x: 7, y: 0 });

  const need = (n + 1) / 2;
  const termRefs = [];
  for (const combo of combos(n, need)) {
    termRefs.push(reduce(chip, "AND", combo.map((idx) => ins[idx]), -3));
  }
  wire(chip, reduce(chip, "OR", termRefs, 2), out);

  validate(chip);
  registry.register(name, namesP("I", n), ["OUT"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// AND-OR-Invert / OR-AND-Invert de 2 grupos de 2.
function buildAOI22(invertAnd) {
  const name = invertAnd ? "AOI-22" : "OAI-22";
  const chip = newChip(name, { size: { x: 1.2, y: 0.75 }, colour: palette.colourOf(CAT) });
  const A = addInputPin(chip, "A", 1, { x: -6, y: 1.5 });
  const B = addInputPin(chip, "B", 1, { x: -6, y: 0.5 });
  const C = addInputPin(chip, "C", 1, { x: -6, y: -0.5 });
  const D = addInputPin(chip, "D", 1, { x: -6, y: -1.5 });
  const OUT = addOutputPin(chip, "OUT", 1, { x: 6, y: 0 });
  const g1 = invertAnd ? "AND" : "OR";
  const g2 = invertAnd ? "OR" : "AND";
  const t1 = gate2(chip, g1, A, B, -3);
  const t2 = gate2(chip, g1, C, D, -3);
  const comb = gate2(chip, g2, t1, t2, 0);
  wire(chip, notOf(chip, comb, 3), OUT);
  validate(chip);
  registry.register(name, ["A", "B", "C", "D"], ["OUT"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Detector: saída 1 se todas as entradas forem 0 (is-zero) ou 1 (is-ones).
function buildDetector(bits, wantOnes) {
  const name = wantOnes ? `IS-ONES-${bits}` : `IS-ZERO-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.2, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const A = namesP("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -7, y: (bits - i) * 0.6 }));
  const OUT = addOutputPin(chip, "OUT", 1, { x: 6, y: 0 });
  if (wantOnes) {
    wire(chip, reduce(chip, "AND", A, -3), OUT);
  } else {
    // is-zero = NOT(OR de todos)
    wire(chip, notOf(chip, reduce(chip, "OR", A, -3), 3), OUT);
  }
  validate(chip);
  registry.register(name, namesP("A", bits), ["OUT"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  const out = [];
  for (const w of Array.from({length:47},(_,i)=>i+2)) {
    out.push(buildGrayEnc(w));
    out.push(buildGrayDec(w));
  }
  for (const w of Array.from({length:47},(_,i)=>i+2)) {
    out.push(buildConstant(w, false));
    out.push(buildConstant(w, true));
  }
  for (const w of Array.from({length:47},(_,i)=>i+2)) out.push(buildBuffer(w));
  for (const n of [3, 5, 7, 9]) out.push(buildMajority(n));
  out.push(buildAOI22(true));
  out.push(buildAOI22(false));
  for (const w of Array.from({length:47},(_,i)=>i+2)) {
    out.push(buildDetector(w, false));
    out.push(buildDetector(w, true));
  }
  return out;
}

module.exports = { generate };
