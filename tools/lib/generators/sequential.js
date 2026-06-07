// sequential.js — flip-flops edge-triggered (master-slave) construídos
// sobre o D-Latch do projeto. D-FF é a base; T/JK/SR derivam dele.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf } = require("../logic");

const CAT = "FLIPFLOP";

// D Flip-Flop rising-edge: master D-Latch (enable=NOT CLK) + slave (enable=CLK).
function buildDFF() {
  const name = "D-FF";
  const chip = newChip(name, { size: { x: 1.4, y: 0.6 }, colour: palette.colourOf(CAT) });
  const D = addInputPin(chip, "D", 1, { x: -8, y: 0.5 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -8, y: -0.5 });
  const Q = addOutputPin(chip, "Q", 1, { x: 7, y: 0.5 });
  const NQ = addOutputPin(chip, "NQ", 1, { x: 7, y: -0.5 });

  const notClk = notOf(chip, CLK, -5);
  const master = addSubChip(chip, "D - Latch", registry.KNOWN, { position: { x: -2, y: 0.5 } });
  const slave  = addSubChip(chip, "D - Latch", registry.KNOWN, { position: { x: 2, y: 0.5 } });
  wire(chip, D, master.in(0));
  wire(chip, notClk, master.in(1));
  wire(chip, master.out(0), slave.in(0));
  wire(chip, CLK, slave.in(1));
  wire(chip, slave.out(0), Q);
  wire(chip, notOf(chip, slave.out(0), 4), NQ);

  validate(chip);
  registry.register(name, ["D", "CLK"], ["Q", "NQ"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// T Flip-Flop: D-FF com D = T XOR Q.
function buildTFF() {
  const name = "T-FF";
  const chip = newChip(name, { size: { x: 1.4, y: 0.6 }, colour: palette.colourOf(CAT) });
  const T = addInputPin(chip, "T", 1, { x: -8, y: 0.5 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -8, y: -0.5 });
  const Q = addOutputPin(chip, "Q", 1, { x: 7, y: 0.5 });
  const NQ = addOutputPin(chip, "NQ", 1, { x: 7, y: -0.5 });

  const dff = addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: 1, y: 0 } });
  const d = gate2(chip, "XOR", T, dff.out(0), -3);
  wire(chip, d, dff.in(0));
  wire(chip, CLK, dff.in(1));
  wire(chip, dff.out(0), Q);
  wire(chip, dff.out(1), NQ);

  validate(chip);
  registry.register(name, ["T", "CLK"], ["Q", "NQ"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// JK Flip-Flop: D = (J AND NQ) OR (NOT K AND Q).
function buildJKFF() {
  const name = "JK-FF";
  const chip = newChip(name, { size: { x: 1.6, y: 0.75 }, colour: palette.colourOf(CAT) });
  const J = addInputPin(chip, "J", 1, { x: -9, y: 1.0 });
  const K = addInputPin(chip, "K", 1, { x: -9, y: 0.0 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -9, y: -1.0 });
  const Q = addOutputPin(chip, "Q", 1, { x: 8, y: 0.5 });
  const NQ = addOutputPin(chip, "NQ", 1, { x: 8, y: -0.5 });

  const dff = addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: 3, y: 0 } });
  const jq = gate2(chip, "AND", J, dff.out(1), -5);     // J AND NQ
  const nk = notOf(chip, K, -5);
  const kq = gate2(chip, "AND", nk, dff.out(0), -2);    // NOT K AND Q
  const d = gate2(chip, "OR", jq, kq, 0);
  wire(chip, d, dff.in(0));
  wire(chip, CLK, dff.in(1));
  wire(chip, dff.out(0), Q);
  wire(chip, dff.out(1), NQ);

  validate(chip);
  registry.register(name, ["J", "K", "CLK"], ["Q", "NQ"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// SR Flip-Flop edge-triggered: D = S OR (NOT R AND Q).
function buildSRFF() {
  const name = "SR-FF";
  const chip = newChip(name, { size: { x: 1.6, y: 0.75 }, colour: palette.colourOf(CAT) });
  const S = addInputPin(chip, "S", 1, { x: -9, y: 1.0 });
  const R = addInputPin(chip, "R", 1, { x: -9, y: 0.0 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -9, y: -1.0 });
  const Q = addOutputPin(chip, "Q", 1, { x: 8, y: 0.5 });
  const NQ = addOutputPin(chip, "NQ", 1, { x: 8, y: -0.5 });

  const dff = addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: 3, y: 0 } });
  const nr = notOf(chip, R, -5);
  const rq = gate2(chip, "AND", nr, dff.out(0), -2);
  const d = gate2(chip, "OR", S, rq, 0);
  wire(chip, d, dff.in(0));
  wire(chip, CLK, dff.in(1));
  wire(chip, dff.out(0), Q);
  wire(chip, dff.out(1), NQ);

  validate(chip);
  registry.register(name, ["S", "R", "CLK"], ["Q", "NQ"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// D-FF com enable: D efetivo = EN ? D : Q (mantém quando EN=0).
function buildDEFF() {
  const name = "D-FF-EN";
  const chip = newChip(name, { size: { x: 1.6, y: 0.75 }, colour: palette.colourOf(CAT) });
  const D = addInputPin(chip, "D", 1, { x: -9, y: 1.0 });
  const EN = addInputPin(chip, "EN", 1, { x: -9, y: 0.0 });
  const CLK = addInputPin(chip, "CLK", 1, { x: -9, y: -1.0 });
  const Q = addOutputPin(chip, "Q", 1, { x: 8, y: 0.5 });
  const NQ = addOutputPin(chip, "NQ", 1, { x: 8, y: -0.5 });

  const dff = addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: 3, y: 0 } });
  const nEn = notOf(chip, EN, -5);
  const keep = gate2(chip, "AND", nEn, dff.out(0), -2);  // EN=0 -> Q
  const take = gate2(chip, "AND", EN, D, -2);            // EN=1 -> D
  const d = gate2(chip, "OR", keep, take, 0);
  wire(chip, d, dff.in(0));
  wire(chip, CLK, dff.in(1));
  wire(chip, dff.out(0), Q);
  wire(chip, dff.out(1), NQ);

  validate(chip);
  registry.register(name, ["D", "EN", "CLK"], ["Q", "NQ"]);
  return { name, chip, collection: palette.collectionOf(CAT) };
}

// Banco de N D-FFs em paralelo (registrador simples, mesmo CLK).
function buildDFFBank(bits) {
  const name = `D-FF-${bits}`;
  const chip = newChip(name, {
    size: { x: 1.6, y: Math.max(0.6, bits * 0.4) },
    colour: palette.colourOf(CAT)
  });
  const D = Array.from({ length: bits }, (_, i) => `D${i}`).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (bits - i) * 0.8 }));
  const CLK = addInputPin(chip, "CLK", 1, { x: -8, y: -1.0 });
  const Q = Array.from({ length: bits }, (_, i) => `Q${i}`).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 7, y: (bits - i) * 0.8 }));

  for (let i = 0; i < bits; i++) {
    const ff = addSubChip(chip, "D-FF", registry.KNOWN, { position: { x: 0, y: (bits - i) * 0.8 } });
    wire(chip, D[i], ff.in(0));
    wire(chip, CLK, ff.in(1));
    wire(chip, ff.out(0), Q[i]);
  }

  validate(chip);
  registry.register(name,
    [...Array.from({ length: bits }, (_, i) => `D${i}`), "CLK"],
    Array.from({ length: bits }, (_, i) => `Q${i}`));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  const out = [];
  out.push(buildDFF());
  out.push(buildTFF());
  out.push(buildJKFF());
  out.push(buildSRFF());
  out.push(buildDEFF());
  for (const w of Array.from({length:47},(_,i)=>i+2)) out.push(buildDFFBank(w));
  return out;
}

module.exports = { generate };
