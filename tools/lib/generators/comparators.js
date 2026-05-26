// comparators.js — comparadores de magnitude de N bits.
// COMPARE-N: produz A>B, A=B, A<B. As variantes single-output (EQ/NEQ/
// GT/LT/GTE/LTE) embrulham o COMPARE-N.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const WIDTHS = Array.from({length:47},(_,i)=>i+2);

function names(prefix, n) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

function buildCompare(bits) {
  const name = `COMPARE-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.2, y: Math.max(0.8, bits * 0.5) },
    colour: palette.colourOf("COMPARATOR")
  });

  const A = names("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -14, y: (bits - i) * 1.0 }));
  const B = names("B", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -14, y: (bits - i) * 1.0 - 0.4 }));

  const GT = addOutputPin(chip, "A>B", 1, { x: 12, y: 1.0 });
  const EQ = addOutputPin(chip, "A=B", 1, { x: 12, y: 0.0 });
  const LT = addOutputPin(chip, "A<B", 1, { x: 12, y: -1.0 });

  let gtPrev = null;
  let ltPrev = null;

  for (let i = 0; i < bits; i++) {
    const y = (bits - i) * 1.0;
    const xor1 = addSubChip(chip, "XOR", registry.KNOWN, { position: { x: -10, y } });
    const notX = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: -8, y } });
    const notA = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: -10, y: y - 0.3 } });
    const notB = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: -10, y: y - 0.6 } });
    const gAnd = addSubChip(chip, "AND", registry.KNOWN, { position: { x: -6, y } });
    const lAnd = addSubChip(chip, "AND", registry.KNOWN, { position: { x: -6, y: y - 0.3 } });

    wire(chip, A[i], xor1.in(0));
    wire(chip, B[i], xor1.in(1));
    wire(chip, xor1.out(0), notX.in(0));
    wire(chip, A[i], notA.in(0));
    wire(chip, B[i], notB.in(0));
    wire(chip, A[i], gAnd.in(0));
    wire(chip, notB.out(0), gAnd.in(1));
    wire(chip, notA.out(0), lAnd.in(0));
    wire(chip, B[i], lAnd.in(1));

    const e_i = notX.out(0);
    const g_i = gAnd.out(0);
    const l_i = lAnd.out(0);

    if (i === 0) {
      gtPrev = g_i;
      ltPrev = l_i;
    } else {
      const eAndGt = addSubChip(chip, "AND", registry.KNOWN, { position: { x: -3, y } });
      const orGt   = addSubChip(chip, "OR",  registry.KNOWN, { position: { x: -1, y } });
      wire(chip, e_i, eAndGt.in(0));
      wire(chip, gtPrev, eAndGt.in(1));
      wire(chip, g_i, orGt.in(0));
      wire(chip, eAndGt.out(0), orGt.in(1));
      gtPrev = orGt.out(0);

      const eAndLt = addSubChip(chip, "AND", registry.KNOWN, { position: { x: -3, y: y - 0.3 } });
      const orLt   = addSubChip(chip, "OR",  registry.KNOWN, { position: { x: -1, y: y - 0.3 } });
      wire(chip, e_i, eAndLt.in(0));
      wire(chip, ltPrev, eAndLt.in(1));
      wire(chip, l_i, orLt.in(0));
      wire(chip, eAndLt.out(0), orLt.in(1));
      ltPrev = orLt.out(0);
    }
  }

  wire(chip, gtPrev, GT);
  wire(chip, ltPrev, LT);
  const norEq = addSubChip(chip, "NOR", registry.KNOWN, { position: { x: 8, y: 0 } });
  wire(chip, gtPrev, norEq.in(0));
  wire(chip, ltPrev, norEq.in(1));
  wire(chip, norEq.out(0), EQ);

  validate(chip);
  registry.register(name,
    [...names("A", bits), ...names("B", bits)],
    ["A>B", "A=B", "A<B"]);
  return { name, chip, collection: palette.collectionOf("COMPARATOR") };
}

function buildWrapper(prefix, bits, outIndex, invert, label) {
  const name = `${prefix}-${bits}`;
  const cmpName = `COMPARE-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf("COMPARATOR")
  });

  const A = names("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (bits - i) * 1.0 }));
  const B = names("B", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (bits - i) * 1.0 - 0.4 }));
  const OUT = addOutputPin(chip, label, 1, { x: 6, y: 0 });

  const cmp = addSubChip(chip, cmpName, registry.KNOWN, { position: { x: 0, y: 0 } });
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], cmp.in(i));
    wire(chip, B[i], cmp.in(bits + i));
  }
  if (invert) {
    const not1 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: 3, y: 0 } });
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
  for (const w of WIDTHS) out.push(buildCompare(w));
  for (const w of WIDTHS) {
    out.push(buildWrapper("EQ",  w, 1, false, "A=B"));
    out.push(buildWrapper("NEQ", w, 1, true,  "A!=B"));
    out.push(buildWrapper("GT",  w, 0, false, "A>B"));
    out.push(buildWrapper("LT",  w, 2, false, "A<B"));
    out.push(buildWrapper("GTE", w, 2, true,  "A>=B"));
    out.push(buildWrapper("LTE", w, 0, true,  "A<=B"));
  }
  return out;
}

module.exports = { generate };
