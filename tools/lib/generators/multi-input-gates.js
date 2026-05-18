// multi-input-gates.js — gates com N entradas single-bit.
// Usa redução em ÁRVORE balanceada (não cascata linear) — fica bem mais
// compacto: AND-32 = ~5 camadas em vez de 31.

const {
  newChip, addInputPin, addOutputPin, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { reduce, notOf } = require("../logic");

const SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 20, 24, 32];

const FAMILY = {
  AND:  { base: "AND", invert: false, cat: "GATE_AND" },
  OR:   { base: "OR",  invert: false, cat: "GATE_OR" },
  XOR:  { base: "XOR", invert: false, cat: "GATE_XOR" },
  NAND: { base: "AND", invert: true,  cat: "GATE_NAND" },
  NOR:  { base: "OR",  invert: true,  cat: "GATE_NOR" },
  XNOR: { base: "XOR", invert: true,  cat: "GATE_XNOR" }
};

function buildGate(family, n) {
  const cfg = FAMILY[family];
  if (!cfg) throw new Error(`unknown family ${family}`);
  const name = `${family}-${n}`;
  const chip = newChip(name, {
    size: { x: 0.875 + n * 0.04, y: Math.max(0.5, n * 0.15) },
    colour: palette.colourOf(cfg.cat)
  });

  const ins = [];
  for (let i = 0; i < n; i++) ins.push(addInputPin(chip, "IN", 1));
  const out = addOutputPin(chip, "OUT", 1);

  // redução em árvore balanceada
  let result = reduce(chip, cfg.base, ins);
  if (cfg.invert) result = notOf(chip, result);
  wire(chip, result, out);

  validate(chip);
  registry.register(name, Array.from({ length: n }, () => "IN"), ["OUT"]);
  return { name, chip, collection: palette.collectionOf(cfg.cat) };
}

function generate() {
  const out = [];
  for (const fam of ["AND", "OR", "XOR", "NAND", "NOR", "XNOR"]) {
    for (const n of SIZES) {
      out.push(buildGate(fam, n));
    }
  }
  return out;
}

module.exports = { generate };
