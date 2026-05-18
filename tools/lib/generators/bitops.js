// bitops.js — manipulação de bits controlada por índice.
// TEST/SET/CLR/TOGGLE-BIT: opera no bit selecionado por IDX (binário).
// ENABLE: passa a palavra só se EN=1.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { decodeSelect, gate2, reduce, notOf } = require("../logic");

const CAT = "LOGICUTIL";
const log2 = (n) => Math.round(Math.log2(n));
const aN = (n) => Array.from({ length: n }, (_, i) => `A${i + 1}`);
const oN = (n) => Array.from({ length: n }, (_, i) => `O${i + 1}`);
const idxN = (k) => Array.from({ length: k }, (_, i) => `IDX${i}`);

// TEST-BIT: OUT = A[IDX]
function buildTestBit(bits) {
  const k = log2(bits);
  const name = `TEST-BIT-${bits}`;
  const chip = newChip(name, { size: { x: 1.6, y: Math.max(0.6, bits * 0.3) }, colour: palette.colourOf(CAT) });
  const A = aN(bits).map((nm) => addInputPin(chip, nm, 1));
  const IDX = idxN(k).map((nm) => addInputPin(chip, nm, 1));
  const OUT = addOutputPin(chip, "OUT", 1);
  const mt = decodeSelect(chip, IDX);
  const terms = A.map((a, i) => gate2(chip, "AND", a, mt[i]));
  wire(chip, reduce(chip, "OR", terms), OUT);
  validate(chip);
  registry.register(name, [...aN(bits), ...idxN(k)], ["OUT"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// SET/CLR/TOGGLE-BIT: opera no bit IDX, resto passa direto
function buildBitOp(bits, mode) {
  const k = log2(bits);
  const name = `${mode}-BIT-${bits}`;
  const chip = newChip(name, { size: { x: 1.6, y: Math.max(0.6, bits * 0.3) }, colour: palette.colourOf(CAT) });
  const A = aN(bits).map((nm) => addInputPin(chip, nm, 1));
  const IDX = idxN(k).map((nm) => addInputPin(chip, nm, 1));
  const O = oN(bits).map((nm) => addOutputPin(chip, nm, 1));
  const mt = decodeSelect(chip, IDX);
  for (let i = 0; i < bits; i++) {
    let ref;
    if (mode === "SET") ref = gate2(chip, "OR", A[i], mt[i]);
    else if (mode === "CLR") ref = gate2(chip, "AND", A[i], notOf(chip, mt[i]));
    else ref = gate2(chip, "XOR", A[i], mt[i]); // TOGGLE
    wire(chip, ref, O[i]);
  }
  validate(chip);
  registry.register(name, [...aN(bits), ...idxN(k)], oN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// ENABLE: O_i = A_i AND EN
function buildEnable(bits) {
  const name = `ENABLE-${bits}`;
  const chip = newChip(name, { size: { x: 1.2, y: Math.max(0.6, bits * 0.3) }, colour: palette.colourOf(CAT) });
  const A = aN(bits).map((nm) => addInputPin(chip, nm, 1));
  const EN = addInputPin(chip, "EN", 1);
  const O = oN(bits).map((nm) => addOutputPin(chip, nm, 1));
  for (let i = 0; i < bits; i++) wire(chip, gate2(chip, "AND", A[i], EN), O[i]);
  validate(chip);
  registry.register(name, [...aN(bits), "EN"], oN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  const out = [];
  for (const w of [2, 4, 8, 16, 32]) {
    out.push(buildTestBit(w));
    out.push(buildBitOp(w, "SET"));
    out.push(buildBitOp(w, "CLR"));
    out.push(buildBitOp(w, "TOGGLE"));
  }
  for (const w of [2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32]) out.push(buildEnable(w));
  return out;
}

module.exports = { generate };
