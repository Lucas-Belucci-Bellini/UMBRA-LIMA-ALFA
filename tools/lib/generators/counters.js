// counters.js — contadores ripple construídos com D-FFs em modo toggle
// (D ligado no próprio NQ). Up: clock encadeado em NQ; Down: em Q.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { reduce } = require("../logic");

const CAT = "COUNTER";
const qNames = (n) => Array.from({ length: n }, (_, i) => `Q${i}`);

function buildRippleCounter(bits, up) {
  const name = `COUNT-${up ? "UP" : "DOWN"}-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const CLK = addInputPin(chip, "CLK", 1, { x: -9, y: 0 });
  const Q = qNames(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 8, y: (bits - i) * 0.8 }));

  const ffs = [];
  for (let i = 0; i < bits; i++) {
    ffs.push(addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: i * 1.6 - 4, y: 0 } }));
  }
  for (let i = 0; i < bits; i++) {
    // toggle: D = NQ
    wire(chip, ffs[i].out(1), ffs[i].in(0));
    // clock chain
    if (i === 0) {
      wire(chip, CLK, ffs[i].in(1));
    } else if (up) {
      wire(chip, ffs[i - 1].out(1), ffs[i].in(1)); // CLK_i = NQ_{i-1}
    } else {
      wire(chip, ffs[i - 1].out(0), ffs[i].in(1)); // CLK_i = Q_{i-1}
    }
    wire(chip, ffs[i].out(0), Q[i]);
  }

  validate(chip);
  registry.register(name, ["CLK"], qNames(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Contador up com saída de overflow (todos os Q em 1 -> OVF).
function buildCounterOvf(bits) {
  const name = `COUNT-UP-OVF-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const CLK = addInputPin(chip, "CLK", 1, { x: -9, y: 0 });
  const Q = qNames(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 8, y: (bits - i) * 0.8 }));
  const OVF = addOutputPin(chip, "OVF", 1, { x: 8, y: -bits * 0.5 });

  const ffs = [];
  for (let i = 0; i < bits; i++) {
    ffs.push(addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: i * 1.6 - 4, y: 0 } }));
  }
  for (let i = 0; i < bits; i++) {
    wire(chip, ffs[i].out(1), ffs[i].in(0));
    if (i === 0) wire(chip, CLK, ffs[i].in(1));
    else wire(chip, ffs[i - 1].out(1), ffs[i].in(1));
    wire(chip, ffs[i].out(0), Q[i]);
  }
  wire(chip, reduce(chip, "AND", ffs.map((f) => f.out(0)), 4), OVF);

  validate(chip);
  registry.register(name, ["CLK"], [...qNames(bits), "OVF"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  const out = [];
  for (const w of [2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 24, 32]) {
    out.push(buildRippleCounter(w, true));
    out.push(buildRippleCounter(w, false));
  }
  for (const w of [2, 3, 4, 5, 6, 7, 8, 10, 12, 16]) out.push(buildCounterOvf(w));
  return out;
}

module.exports = { generate };
