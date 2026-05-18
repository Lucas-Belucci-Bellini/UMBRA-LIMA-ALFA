// misc.js — utilitários diversos: MIN/MAX, sign/zero extend, bit reverse,
// swap de metades, extratores high/low.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf } = require("../logic");

const CAT = "MISC";
const aN = (n) => Array.from({ length: n }, (_, i) => `A${i}`);
const bN = (n) => Array.from({ length: n }, (_, i) => `B${i}`);
const oN = (n) => Array.from({ length: n }, (_, i) => `O${i}`);

function mux2(chip, sel, a, b, x) {
  const ns = notOf(chip, sel, x);
  const t0 = gate2(chip, "AND", ns, a, x + 1);
  const t1 = gate2(chip, "AND", sel, b, x + 1);
  return gate2(chip, "OR", t0, t1, x + 2);
}

// MIN/MAX de dois números unsigned via COMPARE-N + mux por bit.
function buildMinMax(bits, wantMax) {
  const name = `${wantMax ? "MAX" : "MIN"}-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf(CAT)
  });
  const A = aN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -12, y: (bits - i) * 0.8 }));
  const B = bN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -12, y: (bits - i) * 0.8 - 0.35 }));
  const O = oN(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 11, y: (bits - i) * 0.8 }));

  const cmp = addSubChip(chip, `COMPARE-${bits}`, registry.KNOWN, { position: { x: -6, y: 0 } });
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], cmp.in(i));
    wire(chip, B[i], cmp.in(bits + i));
  }
  const LT = cmp.out(2); // A<B
  for (let i = 0; i < bits; i++) {
    // MIN: LT ? A : B  -> mux2(LT,B,A);  MAX: LT ? B : A -> mux2(LT,A,B)
    const ref = wantMax ? mux2(chip, LT, A[i], B[i], i * 0.3)
                        : mux2(chip, LT, B[i], A[i], i * 0.3);
    wire(chip, ref, O[i]);
  }

  validate(chip);
  registry.register(name, [...aN(bits), ...bN(bits)], oN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Sign extend de `from` bits para `to` bits (bits altos = bit de sinal).
function buildSext(from, to) {
  const name = `SEXT-${from}-${to}`;
  const chip = newChip(name, {
    size: { x: 1.4, y: Math.max(0.6, to * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const A = aN(from).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -7, y: (to - i) * 0.6 }));
  const O = oN(to).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 6, y: (to - i) * 0.6 }));
  const sign = A[from - 1];
  for (let i = 0; i < to; i++) {
    wire(chip, i < from ? A[i] : sign, O[i]);
  }
  validate(chip);
  registry.register(name, aN(from), oN(to));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Zero extend de `from` para `to` bits (bits altos = 0).
function buildZext(from, to) {
  const name = `ZEXT-${from}-${to}`;
  const chip = newChip(name, {
    size: { x: 1.4, y: Math.max(0.6, to * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const A = aN(from).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -7, y: (to - i) * 0.6 }));
  const O = oN(to).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 6, y: (to - i) * 0.6 }));
  const zero = addSubChip(chip, "0", registry.KNOWN, { position: { x: 0, y: -to * 0.3 } });
  for (let i = 0; i < to; i++) {
    wire(chip, i < from ? A[i] : zero.out(0), O[i]);
  }
  validate(chip);
  registry.register(name, aN(from), oN(to));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Inverte a ordem dos bits.
function buildBitrev(bits) {
  const name = `BITREV-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.2, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const A = aN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -6, y: (bits - i) * 0.6 }));
  const O = oN(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 5, y: (bits - i) * 0.6 }));
  for (let i = 0; i < bits; i++) wire(chip, A[bits - 1 - i], O[i]);
  validate(chip);
  registry.register(name, aN(bits), oN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Troca as duas metades da palavra.
function buildSwap(bits) {
  const name = `SWAP-${bits}`;
  const half = bits / 2;
  const chip = newChip(name, {
    size: { x: 1.2, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf(CAT)
  });
  const A = aN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -6, y: (bits - i) * 0.6 }));
  const O = oN(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 5, y: (bits - i) * 0.6 }));
  for (let i = 0; i < bits; i++) {
    wire(chip, A[(i + half) % bits], O[i]);
  }
  validate(chip);
  registry.register(name, aN(bits), oN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Extrai metade alta ou baixa da palavra.
function buildHalfExtract(bits, high) {
  const name = `${high ? "HIGH" : "LOW"}-${bits}`;
  const half = bits / 2;
  const chip = newChip(name, {
    size: { x: 1.0, y: Math.max(0.5, bits * 0.25) },
    colour: palette.colourOf(CAT)
  });
  const A = aN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -5, y: (bits - i) * 0.5 }));
  const O = oN(half).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 4, y: (half - i) * 0.5 }));
  for (let i = 0; i < half; i++) {
    wire(chip, A[high ? half + i : i], O[i]);
  }
  validate(chip);
  registry.register(name, aN(bits), oN(half));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  const out = [];
  for (const w of [2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32]) {
    out.push(buildMinMax(w, false));
    out.push(buildMinMax(w, true));
  }
  for (const [f, t] of [[4, 8], [4, 16], [8, 16], [8, 32], [16, 32]]) {
    out.push(buildSext(f, t));
    out.push(buildZext(f, t));
  }
  for (const w of [2, 3, 4, 5, 6, 8, 12, 16, 24, 32]) out.push(buildBitrev(w));
  for (const w of [4, 8, 12, 16, 24, 32]) out.push(buildSwap(w));
  for (const w of [4, 8, 12, 16, 24, 32]) {
    out.push(buildHalfExtract(w, false));
    out.push(buildHalfExtract(w, true));
  }
  return out;
}

module.exports = { generate };
