// arithmetic.js — negadores (complemento de 2), valor absoluto e
// multiplicadores unsigned (array multiplier shift-add).

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf } = require("../logic");

const inNames  = (n) => Array.from({ length: n }, (_, i) => `A${i}`);
const outNames = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i}`);

function mux2(chip, sel, a, b, x) {
  const ns = notOf(chip, sel, x);
  const t0 = gate2(chip, "AND", ns, a, x + 1);
  const t1 = gate2(chip, "AND", sel, b, x + 1);
  return gate2(chip, "OR", t0, t1, x + 2);
}

function rippleAdd(chip, xs, ys, x) {
  const L = xs.length;
  const out = new Array(L);
  let carry = null;
  for (let i = 0; i < L; i++) {
    if (i === 0) {
      const ha = addSubChip(chip, "Half Adder", registry.KNOWN, { position: { x, y: -i * 0.5 } });
      wire(chip, xs[0], ha.in(0));
      wire(chip, ys[0], ha.in(1));
      out[0] = ha.out(0);
      carry = ha.out(1);
    } else {
      const fa = addSubChip(chip, "Full Adder", registry.KNOWN, { position: { x, y: -i * 0.5 } });
      wire(chip, carry, fa.in(0));
      wire(chip, xs[i], fa.in(1));
      wire(chip, ys[i], fa.in(2));
      out[i] = fa.out(0);
      carry = fa.out(1);
    }
  }
  return out;
}

function buildNegator(bits) {
  const name = `NEG-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf("ARITHMETIC")
  });
  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -9, y: (bits - i) * 0.7 }));
  const O = outNames(bits, "O").map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 8, y: (bits - i) * 0.7 }));

  const inv = A.map((a, i) => notOf(chip, a, -5 + i * 0.05));
  const not0 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: 0, y: bits } });
  wire(chip, inv[0], not0.in(0));
  wire(chip, not0.out(0), O[0]);
  let carry = inv[0];
  for (let i = 1; i < bits; i++) {
    const ha = addSubChip(chip, "Half Adder", registry.KNOWN, { position: { x: i, y: (bits - i) } });
    wire(chip, inv[i], ha.in(0));
    wire(chip, carry, ha.in(1));
    wire(chip, ha.out(0), O[i]);
    carry = ha.out(1);
  }

  validate(chip);
  registry.register(name, inNames(bits), outNames(bits, "O"));
  return { name, chip, collection: palette.collectionOf("ARITHMETIC") };
}

function buildAbs(bits) {
  const name = `ABS-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf("ARITHMETIC")
  });
  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -11, y: (bits - i) * 0.7 }));
  const O = outNames(bits, "O").map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 10, y: (bits - i) * 0.7 }));
  const sign = A[bits - 1];

  const inv = A.map((a, i) => notOf(chip, a, -7 + i * 0.05));
  const negBits = new Array(bits);
  const not0 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: -3, y: bits } });
  wire(chip, inv[0], not0.in(0));
  negBits[0] = not0.out(0);
  let carry = inv[0];
  for (let i = 1; i < bits; i++) {
    const ha = addSubChip(chip, "Half Adder", registry.KNOWN, { position: { x: -3 + i * 0.4, y: (bits - i) } });
    wire(chip, inv[i], ha.in(0));
    wire(chip, carry, ha.in(1));
    negBits[i] = ha.out(0);
    carry = ha.out(1);
  }

  for (let i = 0; i < bits; i++) {
    wire(chip, mux2(chip, sign, A[i], negBits[i], 3 + i * 0.05), O[i]);
  }

  validate(chip);
  registry.register(name, inNames(bits), outNames(bits, "O"));
  return { name, chip, collection: palette.collectionOf("ARITHMETIC") };
}

function buildMultiplier(bits) {
  const name = `MULT-${bits}`;
  const L = 2 * bits;
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(1.0, bits * 0.6) },
    colour: palette.colourOf("ARITHMETIC")
  });
  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -16, y: (bits - i) * 1.0 }));
  const B = Array.from({ length: bits }, (_, i) => `B${i}`).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -16, y: (bits - i) * 1.0 - 0.4 }));
  const R = outNames(L, "R").map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 15, y: (L - i) * 0.6 }));

  const zero = addSubChip(chip, "0", registry.KNOWN, { position: { x: -12, y: -bits } });
  const z = zero.out(0);

  let acc = new Array(L);
  for (let p = 0; p < L; p++) {
    acc[p] = (p < bits) ? gate2(chip, "AND", A[p], B[0], -9) : z;
  }

  for (let j = 1; j < bits; j++) {
    const pp = new Array(L);
    for (let p = 0; p < L; p++) {
      const ai = p - j;
      pp[p] = (ai >= 0 && ai < bits) ? gate2(chip, "AND", A[ai], B[j], -6 + j) : z;
    }
    acc = rippleAdd(chip, acc, pp, j * 2);
  }

  for (let p = 0; p < L; p++) wire(chip, acc[p], R[p]);

  validate(chip);
  registry.register(name,
    [...inNames(bits), ...Array.from({ length: bits }, (_, i) => `B${i}`)],
    outNames(L, "R"));
  return { name, chip, collection: palette.collectionOf("ARITHMETIC") };
}

function generate() {
  const out = [];
  for (const w of Array.from({length:47},(_,i)=>i+2)) out.push(buildNegator(w));
  for (const w of Array.from({length:47},(_,i)=>i+2)) out.push(buildAbs(w));
  for (const w of Array.from({length:11},(_,i)=>i+2)) out.push(buildMultiplier(w));
  return out;
}

module.exports = { generate };
