// gate-arrays.js — bancos de gates bitwise: aplica o mesmo gate em paralelo
// a N pares de bits. Pinos single-bit (A1..AN, B1..BN -> O1..ON).

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const WIDTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24, 32];

const BINARY = {
  AND:  { base: "AND", invert: false },
  OR:   { base: "OR",  invert: false },
  XOR:  { base: "XOR", invert: false },
  NAND: { base: "AND", invert: true },
  NOR:  { base: "OR",  invert: true },
  XNOR: { base: "XOR", invert: true }
};

function buildBinaryBank(family, width) {
  const cfg = BINARY[family];
  const name = `${family}-BANK-${width}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, width * 0.35) },
    colour: palette.colourOf("GATE_ARRAY")
  });

  const A = [], B = [], O = [];
  for (let i = 0; i < width; i++) {
    A.push(addInputPin(chip, `A${i + 1}`, 1, { x: -10, y: (width - i) * 1.0 }));
  }
  for (let i = 0; i < width; i++) {
    B.push(addInputPin(chip, `B${i + 1}`, 1, { x: -10, y: (width - i) * 1.0 - 0.4 }));
  }
  for (let i = 0; i < width; i++) {
    O.push(addOutputPin(chip, `O${i + 1}`, 1, { x: 8, y: (width - i) * 1.0 - 0.2 }));
  }

  for (let i = 0; i < width; i++) {
    const g = addSubChip(chip, cfg.base, registry.KNOWN, {
      position: { x: -2, y: (width - i) * 1.0 - 0.2 }
    });
    wire(chip, A[i], g.in(0));
    wire(chip, B[i], g.in(1));
    if (cfg.invert) {
      const n = addSubChip(chip, "NOT", registry.KNOWN, {
        position: { x: 2, y: (width - i) * 1.0 - 0.2 }
      });
      wire(chip, g.out(0), n.in(0));
      wire(chip, n.out(0), O[i]);
    } else {
      wire(chip, g.out(0), O[i]);
    }
  }

  validate(chip);
  const inNames = [
    ...Array.from({ length: width }, (_, i) => `A${i + 1}`),
    ...Array.from({ length: width }, (_, i) => `B${i + 1}`)
  ];
  registry.register(name, inNames, Array.from({ length: width }, (_, i) => `O${i + 1}`));
  return { name, chip, collection: palette.collectionOf("GATE_ARRAY") };
}

function buildNotBank(width) {
  const name = `NOT-BANK-${width}`;
  const chip = newChip(name, {
    size: { x: 1.0, y: Math.max(0.6, width * 0.3) },
    colour: palette.colourOf("GATE_ARRAY")
  });
  const A = [], O = [];
  for (let i = 0; i < width; i++) {
    A.push(addInputPin(chip, `A${i + 1}`, 1, { x: -6, y: (width - i) * 1.0 }));
  }
  for (let i = 0; i < width; i++) {
    O.push(addOutputPin(chip, `O${i + 1}`, 1, { x: 5, y: (width - i) * 1.0 }));
  }
  for (let i = 0; i < width; i++) {
    const n = addSubChip(chip, "NOT", registry.KNOWN, {
      position: { x: 0, y: (width - i) * 1.0 }
    });
    wire(chip, A[i], n.in(0));
    wire(chip, n.out(0), O[i]);
  }
  validate(chip);
  registry.register(name,
    Array.from({ length: width }, (_, i) => `A${i + 1}`),
    Array.from({ length: width }, (_, i) => `O${i + 1}`));
  return { name, chip, collection: palette.collectionOf("GATE_ARRAY") };
}

function generate() {
  const out = [];
  for (const fam of ["AND", "OR", "XOR", "NAND", "NOR", "XNOR"]) {
    for (const w of WIDTHS) out.push(buildBinaryBank(fam, w));
  }
  for (const w of WIDTHS) out.push(buildNotBank(w));
  return out;
}

module.exports = { generate };
