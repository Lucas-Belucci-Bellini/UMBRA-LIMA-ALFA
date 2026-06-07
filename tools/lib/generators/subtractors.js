// subtractors.js — gera Half/Full/2/4/8/16/32-bit Subtractors.
// Hand-crafted (não procedural): cada chip tem a lógica explícita.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const COLOUR = palette.colourOf("SUBTRACTOR");
const COLLECTION = palette.collectionOf("SUBTRACTOR");

// Half Subtractor: Diff = A XOR B, Borrow = (NOT A) AND B
function halfSubtractor() {
  const name = "Half Subtractor";
  const chip = newChip(name, { size: { x: 1.0, y: 0.5 }, colour: COLOUR });

  const A = addInputPin(chip, "A", 1, { x: -6, y: 0.5 });
  const B = addInputPin(chip, "B", 1, { x: -6, y: -0.5 });
  const Diff = addOutputPin(chip, "Diff", 1, { x: 5, y: 0.5 });
  const Borrow = addOutputPin(chip, "Borrow", 1, { x: 5, y: -0.5 });

  const xor1 = addSubChip(chip, "XOR", registry.KNOWN, { position: { x: -2, y: 0.5 } });
  const not1 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: -3, y: -0.5 } });
  const and1 = addSubChip(chip, "AND", registry.KNOWN, { position: { x: 0, y: -0.5 } });

  wire(chip, A, xor1.in(0));
  wire(chip, B, xor1.in(1));
  wire(chip, xor1.out(0), Diff);
  wire(chip, A, not1.in(0));
  wire(chip, not1.out(0), and1.in(0));
  wire(chip, B, and1.in(1));
  wire(chip, and1.out(0), Borrow);

  validate(chip);
  registry.register(name, ["A", "B"], ["Diff", "Borrow"]);
  return { name, chip, collection: COLLECTION };
}

// Full Subtractor: 2 Half Subtractors + 1 OR
function fullSubtractor() {
  const name = "Full Subtractor";
  const chip = newChip(name, { size: { x: 1.4, y: 0.75 }, colour: COLOUR });

  const Bin = addInputPin(chip, "Bin", 1, { x: -8, y: 1.0 });
  const A   = addInputPin(chip, "A",   1, { x: -8, y: 0.0 });
  const B   = addInputPin(chip, "B",   1, { x: -8, y: -1.0 });
  const Diff = addOutputPin(chip, "Diff", 1, { x: 7, y: 0.5 });
  const Bout = addOutputPin(chip, "Bout", 1, { x: 7, y: -0.5 });

  const hs1 = addSubChip(chip, "Half Subtractor", registry.KNOWN, { position: { x: -3, y: 0.0 } });
  const hs2 = addSubChip(chip, "Half Subtractor", registry.KNOWN, { position: { x: 1, y: 0.5 } });
  const or1 = addSubChip(chip, "OR",              registry.KNOWN, { position: { x: 4, y: -1.0 } });

  wire(chip, A, hs1.in(0));
  wire(chip, B, hs1.in(1));
  wire(chip, hs1.out(0), hs2.in(0));
  wire(chip, Bin,        hs2.in(1));
  wire(chip, hs2.out(0), Diff);
  wire(chip, hs1.out(1), or1.in(0));
  wire(chip, hs2.out(1), or1.in(1));
  wire(chip, or1.out(0), Bout);

  validate(chip);
  registry.register(name, ["Bin", "A", "B"], ["Diff", "Bout"]);
  return { name, chip, collection: COLLECTION };
}

// N-bit Subtractor: cadeia de N Full Subtractors.
function nBitSubtractor(bits) {
  const name = `${bits}-bit Subtractor`;
  const heightPerBit = 1.5;
  const totalH = bits * heightPerBit + 1.0;

  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.75, bits * 0.5) },
    colour: COLOUR
  });

  const A = [];
  const B = [];
  for (let i = 1; i <= bits; i++) {
    A.push(addInputPin(chip, `A${i}`, 1, { x: -10, y: totalH / 2 - (i - 1) * heightPerBit }));
  }
  for (let i = 1; i <= bits; i++) {
    B.push(addInputPin(chip, `B${i}`, 1, { x: -10, y: totalH / 2 - (i - 1) * heightPerBit - 0.5 }));
  }
  const Bin = addInputPin(chip, "Borrow IN", 1, { x: -10, y: -totalH / 2 - 0.5 });

  const Diff = [];
  for (let i = 1; i <= bits; i++) {
    Diff.push(addOutputPin(chip, `D${i}`, 1, { x: 9, y: totalH / 2 - (i - 1) * heightPerBit - 0.25 }));
  }
  const Bout = addOutputPin(chip, "Borrow OUT", 1, { x: 9, y: -totalH / 2 - 0.5 });

  const fs = [];
  for (let i = 0; i < bits; i++) {
    fs.push(addSubChip(chip, "Full Subtractor", registry.KNOWN, {
      position: { x: -2 + i * (bits <= 4 ? 2.5 : 1.8), y: totalH / 2 - i * heightPerBit - 0.25 }
    }));
  }

  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], fs[i].in(1));
    wire(chip, B[i], fs[i].in(2));
    if (i === 0) {
      wire(chip, Bin, fs[i].in(0));
    } else {
      wire(chip, fs[i - 1].out(1), fs[i].in(0));
    }
    wire(chip, fs[i].out(0), Diff[i]);
  }
  wire(chip, fs[bits - 1].out(1), Bout);

  validate(chip);
  const inputNames = [
    ...Array.from({ length: bits }, (_, i) => `A${i + 1}`),
    ...Array.from({ length: bits }, (_, i) => `B${i + 1}`),
    "Borrow IN"
  ];
  const outputNames = [
    ...Array.from({ length: bits }, (_, i) => `D${i + 1}`),
    "Borrow OUT"
  ];
  registry.register(name, inputNames, outputNames);
  return { name, chip, collection: COLLECTION };
}

function generate() {
  const out = [];
  out.push(halfSubtractor());
  out.push(fullSubtractor());
  for (const w of Array.from({length:63},(_,i)=>i+2)) {
    out.push(nBitSubtractor(w));
  }
  return out;
}

module.exports = { generate };
