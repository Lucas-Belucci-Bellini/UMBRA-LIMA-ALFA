// registers.js — registradores de deslocamento construídos com D-FFs.
// SIPO / SISO / PIPO / PISO em várias larguras.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf } = require("../logic");

const CAT = "REGISTER";
const qN = (n) => Array.from({ length: n }, (_, i) => `Q${i}`);
const pN = (n) => Array.from({ length: n }, (_, i) => `P${i}`);

function mux2(chip, sel, a, b, x) {
  const ns = notOf(chip, sel, x);
  const t0 = gate2(chip, "AND", ns, a, x + 1);
  const t1 = gate2(chip, "AND", sel, b, x + 1);
  return gate2(chip, "OR", t0, t1, x + 2);
}

// Serial-in parallel-out: cadeia de D-FFs, todas as saídas expostas.
function buildSIPO(bits) {
  const name = `SIPO-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const SER = addInputPin(chip, "SER", 1, { x: -10, y: 1.0 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -10, y: -1.0 });
  const Q = qN(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 9, y: (bits - i) * 0.8 }));

  const ffs = [];
  for (let i = 0; i < bits; i++) {
    ffs.push(addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: i * 1.6 - 6, y: 0 } }));
  }
  for (let i = 0; i < bits; i++) {
    wire(chip, i === 0 ? SER : ffs[i - 1].out(0), ffs[i].in(0));
    wire(chip, CLK, ffs[i].in(1));
    wire(chip, ffs[i].out(0), Q[i]);
  }

  validate(chip);
  registry.register(name, ["SER", "CLK"], qN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Serial-in serial-out: só a última saída exposta.
function buildSISO(bits) {
  const name = `SISO-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: 0.6 },
    colour: palette.colourOf(CAT)
  });
  const SER = addInputPin(chip, "SER", 1, { x: -10, y: 0.5 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -10, y: -0.5 });
  const OUT = addOutputPin(chip, "OUT", 1, { x: 9, y: 0 });

  const ffs = [];
  for (let i = 0; i < bits; i++) {
    ffs.push(addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: i * 1.6 - 6, y: 0 } }));
  }
  for (let i = 0; i < bits; i++) {
    wire(chip, i === 0 ? SER : ffs[i - 1].out(0), ffs[i].in(0));
    wire(chip, CLK, ffs[i].in(1));
  }
  wire(chip, ffs[bits - 1].out(0), OUT);

  validate(chip);
  registry.register(name, ["SER", "CLK"], ["OUT"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Parallel-in parallel-out: registrador de N bits.
function buildPIPO(bits) {
  const name = `PIPO-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.8, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const P = pN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -9, y: (bits - i) * 0.8 }));
  const CLK = addInputPin(chip, "CLK", 1, { x: -9, y: -1.0 });
  const Q = qN(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 8, y: (bits - i) * 0.8 }));

  for (let i = 0; i < bits; i++) {
    const ff = addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: 0, y: (bits - i) * 0.8 } });
    wire(chip, P[i], ff.in(0));
    wire(chip, CLK, ff.in(1));
    wire(chip, ff.out(0), Q[i]);
  }

  validate(chip);
  registry.register(name, [...pN(bits), "CLK"], qN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Parallel-in serial-out: carrega em paralelo quando LOAD=1, senão desloca.
function buildPISO(bits) {
  const name = `PISO-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const P = pN(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -12, y: (bits - i) * 0.8 }));
  const SER = addInputPin(chip, "SER", 1, { x: -12, y: -1.0 });
  const LOAD = addInputPin(chip, "LOAD", 1, { x: -12, y: -1.8 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -12, y: -2.6 });
  const OUT = addOutputPin(chip, "OUT", 1, { x: 11, y: 0 });

  const ffs = [];
  for (let i = 0; i < bits; i++) {
    ffs.push(addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: i * 1.6 - 8, y: 0 } }));
  }
  for (let i = 0; i < bits; i++) {
    const shiftIn = i === 0 ? SER : ffs[i - 1].out(0);
    // LOAD ? P[i] : shiftIn
    const d = mux2(chip, LOAD, shiftIn, P[i], i * 0.4 - 6);
    wire(chip, d, ffs[i].in(0));
    wire(chip, CLK, ffs[i].in(1));
  }
  wire(chip, ffs[bits - 1].out(0), OUT);

  validate(chip);
  registry.register(name, [...pN(bits), "SER", "LOAD", "CLK"], ["OUT"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Shift register bidirecional (DIR=0 desloca p/ Q0, DIR=1 p/ Q_{n-1}).
function buildShiftReg(bits) {
  const name = `SHIFTREG-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.6, bits * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const SER = addInputPin(chip, "SER", 1, { x: -12, y: 1.5 });
  const DIR = addInputPin(chip, "DIR", 1, { x: -12, y: 0.5 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -12, y: -0.5 });
  const Q = qN(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 11, y: (bits - i) * 0.8 }));

  const ffs = [];
  for (let i = 0; i < bits; i++) {
    ffs.push(addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: i * 1.6 - 8, y: 0 } }));
  }
  for (let i = 0; i < bits; i++) {
    const leftNeighbor  = i === 0 ? SER : ffs[i - 1].out(0);          // dir=0
    const rightNeighbor = i === bits - 1 ? SER : ffs[i + 1].out(0);   // dir=1
    const d = mux2(chip, DIR, leftNeighbor, rightNeighbor, i * 0.4 - 6);
    wire(chip, d, ffs[i].in(0));
    wire(chip, CLK, ffs[i].in(1));
    wire(chip, ffs[i].out(0), Q[i]);
  }

  validate(chip);
  registry.register(name, ["SER", "DIR", "CLK"], qN(bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  const out = [];
  for (const w of Array.from({length:47},(_,i)=>i+2)) {
    out.push(buildSIPO(w));
    out.push(buildSISO(w));
    out.push(buildPIPO(w));
    out.push(buildPISO(w));
  }
  for (const w of Array.from({length:45},(_,i)=>i+4)) out.push(buildShiftReg(w));
  return out;
}

module.exports = { generate };
