// extras.js — utilitários compostos: resolvedor de prioridade, detector
// one-hot, diferença absoluta, min/max de 3 entradas.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, reduce, notOf } = require("../logic");

const a1 = (n) => Array.from({ length: n }, (_, i) => `A${i + 1}`);
const b1 = (n) => Array.from({ length: n }, (_, i) => `B${i + 1}`);
const c1 = (n) => Array.from({ length: n }, (_, i) => `C${i + 1}`);
const o1 = (n) => Array.from({ length: n }, (_, i) => `O${i + 1}`);

function mux2(chip, sel, a, b) {
  const ns = notOf(chip, sel);
  return gate2(chip, "OR", gate2(chip, "AND", ns, a), gate2(chip, "AND", sel, b));
}

// Resolvedor de prioridade: saída one-hot do bit ligado mais alto.
function buildPriority(bits) {
  const name = `PRIORITY-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf("LOGICUTIL")
  });
  const I = Array.from({ length: bits }, (_, i) => `I${i}`).map((nm) => addInputPin(chip, nm, 1));
  const O = Array.from({ length: bits }, (_, i) => `O${i}`).map((nm) => addOutputPin(chip, nm, 1));
  const winner = new Array(bits);
  winner[bits - 1] = I[bits - 1];
  let ho = I[bits - 1];
  for (let j = bits - 2; j >= 0; j--) {
    winner[j] = gate2(chip, "AND", I[j], notOf(chip, ho));
    if (j > 0) ho = gate2(chip, "OR", I[j], ho);
  }
  for (let j = 0; j < bits; j++) wire(chip, winner[j], O[j]);
  validate(chip);
  registry.register(name,
    Array.from({ length: bits }, (_, i) => `I${i}`),
    Array.from({ length: bits }, (_, i) => `O${i}`));
  return { name, chip, collection: palette.collectionOf("LOGICUTIL") };
}

// Detector one-hot: 1 se exatamente um bit estiver ligado (usa POPCOUNT).
function buildIsOnehot(bits) {
  const name = `IS-ONEHOT-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.4, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf("LOGICUTIL")
  });
  const A = Array.from({ length: bits }, (_, i) => `A${i}`).map((nm) => addInputPin(chip, nm, 1));
  const OUT = addOutputPin(chip, "OUT", 1);
  const pc = addSubChip(chip, `POPCOUNT-${bits}`, registry.KNOWN);
  for (let i = 0; i < bits; i++) wire(chip, A[i], pc.in(i));
  const m = registry.KNOWN[`POPCOUNT-${bits}`].outputs.length;
  // contagem == 1  -> C0=1 e demais bits 0
  const terms = [pc.out(0)];
  for (let b = 1; b < m; b++) terms.push(notOf(chip, pc.out(b)));
  wire(chip, terms.length === 1 ? terms[0] : reduce(chip, "AND", terms), OUT);
  validate(chip);
  registry.register(name, Array.from({ length: bits }, (_, i) => `A${i}`), ["OUT"]);
  return { name, chip, collection: palette.collectionOf("LOGICUTIL") };
}

// Diferença absoluta |A - B| (unsigned).
function buildAbsDiff(bits) {
  const name = `ABS-DIFF-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf("ARITHMETIC")
  });
  const A = a1(bits).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(bits).map((nm) => addInputPin(chip, nm, 1));
  const O = o1(bits).map((nm) => addOutputPin(chip, nm, 1));
  const zero = addSubChip(chip, "0", registry.KNOWN).out(0);
  const sub = addSubChip(chip, `${bits}-bit Subtractor`, registry.KNOWN);
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], sub.in(i));
    wire(chip, B[i], sub.in(bits + i));
  }
  wire(chip, zero, sub.in(2 * bits)); // Borrow IN = 0
  const borrow = sub.out(bits);        // Borrow OUT (1 se A<B)
  const neg = addSubChip(chip, `NEG-${bits}`, registry.KNOWN);
  for (let i = 0; i < bits; i++) wire(chip, sub.out(i), neg.in(i));
  for (let i = 0; i < bits; i++) {
    // A<B ? -(A-B) : (A-B)
    wire(chip, mux2(chip, borrow, sub.out(i), neg.out(i)), O[i]);
  }
  validate(chip);
  registry.register(name, [...a1(bits), ...b1(bits)], o1(bits));
  return { name, chip, collection: palette.collectionOf("ARITHMETIC") };
}

// MIN/MAX de 3 entradas (encadeia o MIN-N / MAX-N de 2 entradas).
function build3(bits, wantMax) {
  const name = `${wantMax ? "MAX3" : "MIN3"}-${bits}`;
  const base = `${wantMax ? "MAX" : "MIN"}-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.2, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf("MISC")
  });
  const A = a1(bits).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(bits).map((nm) => addInputPin(chip, nm, 1));
  const C = c1(bits).map((nm) => addInputPin(chip, nm, 1));
  const O = o1(bits).map((nm) => addOutputPin(chip, nm, 1));
  const m1 = addSubChip(chip, base, registry.KNOWN);
  const m2 = addSubChip(chip, base, registry.KNOWN);
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], m1.in(i));
    wire(chip, B[i], m1.in(bits + i));
  }
  for (let i = 0; i < bits; i++) {
    wire(chip, m1.out(i), m2.in(i));
    wire(chip, C[i], m2.in(bits + i));
  }
  for (let i = 0; i < bits; i++) wire(chip, m2.out(i), O[i]);
  validate(chip);
  registry.register(name, [...a1(bits), ...b1(bits), ...c1(bits)], o1(bits));
  return { name, chip, collection: palette.collectionOf("MISC") };
}

function generate() {
  const out = [];
  for (const w of [2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32]) out.push(buildPriority(w));
  for (const w of [3, 4, 5, 6, 7, 8, 10, 12, 16]) out.push(buildIsOnehot(w));
  for (const w of [4, 5, 6, 8, 10, 12, 16]) out.push(buildAbsDiff(w));
  for (const w of [4, 6, 8, 12, 16]) {
    out.push(build3(w, false));
    out.push(build3(w, true));
  }
  return out;
}

module.exports = { generate };
