// parity.js — geradores/checadores de paridade e popcount (conta bits 1).

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { reduce, notOf } = require("../logic");

const inNames = (n) => Array.from({ length: n }, (_, i) => `A${i}`);

function addNums(chip, xs, ys, zero, col) {
  const L = Math.max(xs.length, ys.length);
  const x = xs.slice(); while (x.length < L) x.push(zero);
  const y = ys.slice(); while (y.length < L) y.push(zero);
  const out = [];
  let carry = null;
  for (let i = 0; i < L; i++) {
    if (i === 0) {
      const ha = addSubChip(chip, "Half Adder", registry.KNOWN, { position: { x: col, y: -i * 0.4 } });
      wire(chip, x[0], ha.in(0));
      wire(chip, y[0], ha.in(1));
      out.push(ha.out(0));
      carry = ha.out(1);
    } else {
      const fa = addSubChip(chip, "Full Adder", registry.KNOWN, { position: { x: col, y: -i * 0.4 } });
      wire(chip, carry, fa.in(0));
      wire(chip, x[i], fa.in(1));
      wire(chip, y[i], fa.in(2));
      out.push(fa.out(0));
      carry = fa.out(1);
    }
  }
  out.push(carry);
  return out;
}

function buildParityGen(bits, odd) {
  const name = `PARITY-${odd ? "ODD" : "EVEN"}-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.2, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf("PARITY")
  });
  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (bits - i) * 0.6 }));
  const P = addOutputPin(chip, "P", 1, { x: 7, y: 0 });

  const x = reduce(chip, "XOR", A, -4);
  if (odd) {
    wire(chip, notOf(chip, x, 3), P);
  } else {
    wire(chip, x, P);
  }

  validate(chip);
  registry.register(name, inNames(bits), ["P"]);
  return { name, chip, collection: palette.collectionOf("PARITY") };
}

function buildParityCheck(bits) {
  const name = `PARITY-CHECK-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.2, y: Math.max(0.6, bits * 0.3) },
    colour: palette.colourOf("PARITY")
  });
  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (bits - i) * 0.6 }));
  const P = addInputPin(chip, "P", 1, { x: -8, y: -2.0 });
  const ERR = addOutputPin(chip, "ERROR", 1, { x: 7, y: 0 });

  wire(chip, reduce(chip, "XOR", [...A, P], -4), ERR);

  validate(chip);
  registry.register(name, [...inNames(bits), "P"], ["ERROR"]);
  return { name, chip, collection: palette.collectionOf("PARITY") };
}

function buildPopcount(bits) {
  const name = `POPCOUNT-${bits}`;
  const m = Math.floor(Math.log2(bits)) + 1;
  const chip = newChip(name, {
    size: { x: 2.2, y: Math.max(0.8, bits * 0.4) },
    colour: palette.colourOf("PARITY")
  });
  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -12, y: (bits - i) * 0.7 }));
  const C = Array.from({ length: m }, (_, i) => `C${i}`).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 11, y: 1.0 - i * 0.5 }));

  const zero = addSubChip(chip, "0", registry.KNOWN, { position: { x: -8, y: -bits } }).out(0);

  let nums = A.map((r) => [r]);
  let col = -4;
  while (nums.length > 1) {
    const next = [];
    for (let i = 0; i < nums.length; i += 2) {
      if (i + 1 < nums.length) {
        next.push(addNums(chip, nums[i], nums[i + 1], zero, col));
      } else {
        next.push(nums[i]);
      }
    }
    nums = next;
    col += 2.5;
  }
  const result = nums[0];
  for (let i = 0; i < m; i++) {
    wire(chip, i < result.length ? result[i] : zero, C[i]);
  }

  validate(chip);
  registry.register(name, inNames(bits),
    Array.from({ length: m }, (_, i) => `C${i}`));
  return { name, chip, collection: palette.collectionOf("PARITY") };
}

function generate() {
  const out = [];
  const pw = Array.from({length:63},(_,i)=>i+2);
  for (const w of pw) {
    out.push(buildParityGen(w, false));
    out.push(buildParityGen(w, true));
    out.push(buildParityCheck(w));
  }
  for (const w of Array.from({length:30},(_,i)=>i+3)) out.push(buildPopcount(w));
  return out;
}

module.exports = { generate };
