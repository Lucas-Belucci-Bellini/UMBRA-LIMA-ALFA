// signed.js — comparadores SIGNED (complemento de 2).
// Truque: invertendo o bit de sinal (MSB) de A e B, a comparação unsigned
// passa a dar o resultado signed correto. Embrulha o COMPARE-N.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const WIDTHS = Array.from({length:47},(_,i)=>i+2);
const names = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);

function buildCompareS(bits) {
  const name = `COMPARE-S-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.2, y: Math.max(0.8, bits * 0.5) },
    colour: palette.colourOf("COMPARATOR")
  });
  const A = names("A", bits).map((nm) => addInputPin(chip, nm, 1));
  const B = names("B", bits).map((nm) => addInputPin(chip, nm, 1));
  const GT = addOutputPin(chip, "A>B", 1);
  const EQ = addOutputPin(chip, "A=B", 1);
  const LT = addOutputPin(chip, "A<B", 1);

  const notA = addSubChip(chip, "NOT", registry.KNOWN);
  const notB = addSubChip(chip, "NOT", registry.KNOWN);
  wire(chip, A[bits - 1], notA.in(0));
  wire(chip, B[bits - 1], notB.in(0));

  const cmp = addSubChip(chip, `COMPARE-${bits}`, registry.KNOWN);
  for (let i = 0; i < bits - 1; i++) {
    wire(chip, A[i], cmp.in(i));
    wire(chip, B[i], cmp.in(bits + i));
  }
  wire(chip, notA.out(0), cmp.in(bits - 1));        // MSB de A invertido
  wire(chip, notB.out(0), cmp.in(2 * bits - 1));    // MSB de B invertido
  wire(chip, cmp.out(0), GT);
  wire(chip, cmp.out(1), EQ);
  wire(chip, cmp.out(2), LT);

  validate(chip);
  registry.register(name, [...names("A", bits), ...names("B", bits)], ["A>B", "A=B", "A<B"]);
  return { name, chip, collection: palette.collectionOf("COMPARATOR") };
}

function buildWrapperS(prefix, bits, outIndex, invert, label) {
  const name = `${prefix}-S-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf("COMPARATOR")
  });
  const A = names("A", bits).map((nm) => addInputPin(chip, nm, 1));
  const B = names("B", bits).map((nm) => addInputPin(chip, nm, 1));
  const OUT = addOutputPin(chip, label, 1);
  const cmp = addSubChip(chip, `COMPARE-S-${bits}`, registry.KNOWN);
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], cmp.in(i));
    wire(chip, B[i], cmp.in(bits + i));
  }
  if (invert) {
    const not1 = addSubChip(chip, "NOT", registry.KNOWN);
    wire(chip, cmp.out(outIndex), not1.in(0));
    wire(chip, not1.out(0), OUT);
  } else {
    wire(chip, cmp.out(outIndex), OUT);
  }
  validate(chip);
  registry.register(name, [...names("A", bits), ...names("B", bits)], [label]);
  return { name, chip, collection: palette.collectionOf("COMPARATOR") };
}

function generate() {
  const out = [];
  for (const w of WIDTHS) out.push(buildCompareS(w));
  for (const w of WIDTHS) {
    out.push(buildWrapperS("EQ", w, 1, false, "A=B"));
    out.push(buildWrapperS("NEQ", w, 1, true, "A!=B"));
    out.push(buildWrapperS("GT", w, 0, false, "A>B"));
    out.push(buildWrapperS("LT", w, 2, false, "A<B"));
    out.push(buildWrapperS("GTE", w, 2, true, "A>=B"));
    out.push(buildWrapperS("LTE", w, 0, true, "A<=B"));
  }
  return out;
}

module.exports = { generate };
