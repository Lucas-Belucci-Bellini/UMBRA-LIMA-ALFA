// encoders.js — decoders (K -> 2^K one-hot), encoders (2^K -> K) e
// priority encoders.

const {
  newChip, addInputPin, addOutputPin, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { decodeSelect, gate2, reduce, notOf } = require("../logic");

const inNames = (n) => Array.from({ length: n }, (_, i) => `I${i}`);
const addrNames = (k) => Array.from({ length: k }, (_, i) => `A${i}`);
const outNames = (n) => Array.from({ length: n }, (_, i) => `O${i}`);

function buildDecoder(k, withEnable) {
  const n = 1 << k;
  const name = withEnable ? `DECODE-${k}x${n}-EN` : `DECODE-${k}x${n}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.8, n * 0.3) },
    colour: palette.colourOf("ENCODER")
  });

  const addr = addrNames(k).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -10, y: 1.0 - i * 0.5 }));
  const en = withEnable ? addInputPin(chip, "EN", 1, { x: -10, y: -3.0 }) : null;
  const outs = outNames(n).map((nm, j) =>
    addOutputPin(chip, nm, 1, { x: 10, y: (n - j) * 0.6 }));

  const minterms = decodeSelect(chip, addr, -6);
  for (let j = 0; j < n; j++) {
    if (withEnable) {
      wire(chip, gate2(chip, "AND", minterms[j], en, 4), outs[j]);
    } else {
      wire(chip, minterms[j], outs[j]);
    }
  }

  validate(chip);
  registry.register(name,
    withEnable ? [...addrNames(k), "EN"] : addrNames(k),
    outNames(n));
  return { name, chip, collection: palette.collectionOf("ENCODER") };
}

function buildEncoder(k) {
  const n = 1 << k;
  const name = `ENCODE-${n}x${k}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.8, n * 0.3) },
    colour: palette.colourOf("ENCODER")
  });

  const ins = inNames(n).map((nm, j) =>
    addInputPin(chip, nm, 1, { x: -10, y: (n - j) * 0.6 }));
  const outs = addrNames(k).map((nm, b) =>
    addOutputPin(chip, nm, 1, { x: 9, y: 1.0 - b * 0.5 }));

  for (let b = 0; b < k; b++) {
    const terms = [];
    for (let j = 0; j < n; j++) {
      if ((j >> b) & 1) terms.push(ins[j]);
    }
    wire(chip, reduce(chip, "OR", terms, 0), outs[b]);
  }

  validate(chip);
  registry.register(name, inNames(n), addrNames(k));
  return { name, chip, collection: palette.collectionOf("ENCODER") };
}

function buildPriorityEncoder(k) {
  const n = 1 << k;
  const name = `PRIO-ENC-${n}x${k}`;
  const chip = newChip(name, {
    size: { x: 2.2, y: Math.max(0.8, n * 0.3) },
    colour: palette.colourOf("ENCODER")
  });

  const ins = inNames(n).map((nm, j) =>
    addInputPin(chip, nm, 1, { x: -12, y: (n - j) * 0.6 }));
  const outs = addrNames(k).map((nm, b) =>
    addOutputPin(chip, nm, 1, { x: 11, y: 1.0 - b * 0.5 }));
  const valid = addOutputPin(chip, "VALID", 1, { x: 11, y: -3.0 });

  const winner = new Array(n);
  winner[n - 1] = ins[n - 1];
  let ho = ins[n - 1];
  for (let j = n - 2; j >= 0; j--) {
    const nho = notOf(chip, ho, -6);
    winner[j] = gate2(chip, "AND", ins[j], nho, -3);
    if (j > 0) ho = gate2(chip, "OR", ins[j], ho, -8);
  }

  for (let b = 0; b < k; b++) {
    const terms = [];
    for (let j = 0; j < n; j++) {
      if ((j >> b) & 1) terms.push(winner[j]);
    }
    wire(chip, reduce(chip, "OR", terms, 2), outs[b]);
  }
  wire(chip, reduce(chip, "OR", ins, 6), valid);

  validate(chip);
  registry.register(name, inNames(n), [...addrNames(k), "VALID"]);
  return { name, chip, collection: palette.collectionOf("ENCODER") };
}

function generate() {
  const out = [];
  for (const k of [2, 3, 4, 5, 6]) {
    out.push(buildDecoder(k, false));
    out.push(buildDecoder(k, true));
  }
  for (const k of [2, 3, 4, 5, 6]) {
    out.push(buildEncoder(k));
    out.push(buildPriorityEncoder(k));
  }
  return out;
}

module.exports = { generate };
