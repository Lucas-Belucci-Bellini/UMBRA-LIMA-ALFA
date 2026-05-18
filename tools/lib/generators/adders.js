// adders.js — somadores ripple-carry de N bits, incrementadores (+1) e
// decrementadores (-1). Pinos single-bit (padrão do 2-bit Adder do Lucas).

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const ADDER_WIDTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 20, 24, 32];
const INCDEC_WIDTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 20, 24, 32];

function names(prefix, n) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

function buildAdder(bits) {
  const name = `${bits}-bit Ripple Adder`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.75, bits * 0.5) },
    colour: palette.colourOf("ADDER")
  });

  const A = names("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -10, y: (bits - i) * 1.0 }));
  const B = names("B", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -10, y: (bits - i) * 1.0 - 0.4 }));
  const Cin = addInputPin(chip, "Cin", 1, { x: -10, y: -1.0 });

  const S = names("S", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 9, y: (bits - i) * 1.0 - 0.2 }));
  const Cout = addOutputPin(chip, "Cout", 1, { x: 9, y: -1.0 });

  let carry = Cin;
  for (let i = 0; i < bits; i++) {
    const fa = addSubChip(chip, "Full Adder", registry.KNOWN, {
      position: { x: i * 1.6 - 4, y: (bits - i) * 1.0 - 0.2 }
    });
    wire(chip, carry, fa.in(0));
    wire(chip, A[i], fa.in(1));
    wire(chip, B[i], fa.in(2));
    wire(chip, fa.out(0), S[i]);
    carry = fa.out(1);
  }
  wire(chip, carry, Cout);

  validate(chip);
  registry.register(name,
    [...names("A", bits), ...names("B", bits), "Cin"],
    [...names("S", bits), "Cout"]);
  return { name, chip, collection: palette.collectionOf("ADDER") };
}

function buildIncrementer(bits) {
  const name = `INC-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf("INCDEC")
  });

  const A = names("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -9, y: (bits - i) * 1.0 }));
  const S = names("S", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 8, y: (bits - i) * 1.0 }));
  const Cout = addOutputPin(chip, "Cout", 1, { x: 8, y: -1.0 });

  const not0 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: 0, y: bits * 1.0 } });
  wire(chip, A[0], not0.in(0));
  wire(chip, not0.out(0), S[0]);
  let carry = A[0];

  for (let i = 1; i < bits; i++) {
    const ha = addSubChip(chip, "Half Adder", registry.KNOWN, {
      position: { x: i * 1.4 - 2, y: (bits - i) * 1.0 }
    });
    wire(chip, A[i], ha.in(0));
    wire(chip, carry, ha.in(1));
    wire(chip, ha.out(0), S[i]);
    carry = ha.out(1);
  }
  wire(chip, carry, Cout);

  validate(chip);
  registry.register(name, names("A", bits), [...names("S", bits), "Cout"]);
  return { name, chip, collection: palette.collectionOf("INCDEC") };
}

function buildDecrementer(bits) {
  const name = `DEC-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf("INCDEC")
  });

  const A = names("A", bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -9, y: (bits - i) * 1.0 }));
  const D = names("D", bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 8, y: (bits - i) * 1.0 }));
  const Bout = addOutputPin(chip, "Bout", 1, { x: 8, y: -1.0 });

  const not0 = addSubChip(chip, "NOT", registry.KNOWN, { position: { x: 0, y: bits * 1.0 } });
  wire(chip, A[0], not0.in(0));
  wire(chip, not0.out(0), D[0]);
  let borrow = not0.out(0);

  for (let i = 1; i < bits; i++) {
    const hs = addSubChip(chip, "Half Subtractor", registry.KNOWN, {
      position: { x: i * 1.4 - 2, y: (bits - i) * 1.0 }
    });
    wire(chip, A[i], hs.in(0));
    wire(chip, borrow, hs.in(1));
    wire(chip, hs.out(0), D[i]);
    borrow = hs.out(1);
  }
  wire(chip, borrow, Bout);

  validate(chip);
  registry.register(name, names("A", bits), [...names("D", bits), "Bout"]);
  return { name, chip, collection: palette.collectionOf("INCDEC") };
}

function generate() {
  const out = [];
  for (const w of ADDER_WIDTHS) out.push(buildAdder(w));
  for (const w of INCDEC_WIDTHS) out.push(buildIncrementer(w));
  for (const w of INCDEC_WIDTHS) out.push(buildDecrementer(w));
  return out;
}

module.exports = { generate };
