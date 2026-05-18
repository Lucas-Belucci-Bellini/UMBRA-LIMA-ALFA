// palette.js — cores por categoria. O Digital Logic Sim usa Colour {r,g,b,a}
// em floats 0..1. Cada categoria tem uma cor distinta para servir de
// organização visual na biblioteca de chips.

function rgb(r, g, b) {
  return { r: r / 255, g: g / 255, b: b / 255, a: 1.0 };
}

// Cada categoria: nome da coleção (ChipCollection do DLS) + cor.
const CATEGORY = {
  SUBTRACTOR:   { collection: "SUBTRACTORS",        colour: rgb(140, 52, 178) },
  GATE_AND:     { collection: "MULTI-GATES",        colour: rgb(212, 168, 48) },
  GATE_OR:      { collection: "MULTI-GATES",        colour: rgb(58, 132, 226) },
  GATE_XOR:     { collection: "MULTI-GATES",        colour: rgb(150, 70, 230) },
  GATE_NAND:    { collection: "MULTI-GATES",        colour: rgb(224, 120, 36) },
  GATE_NOR:     { collection: "MULTI-GATES",        colour: rgb(40, 50, 120) },
  GATE_XNOR:    { collection: "MULTI-GATES",        colour: rgb(96, 36, 150) },
  GATE_ARRAY:   { collection: "GATE BANKS",         colour: rgb(26, 158, 152) },
  ADDER:        { collection: "ADDERS",             colour: rgb(52, 168, 78) },
  INCDEC:       { collection: "INC / DEC",          colour: rgb(116, 192, 90) },
  COMPARATOR:   { collection: "COMPARATORS",        colour: rgb(38, 180, 204) },
  MUX:          { collection: "MUX / DEMUX",        colour: rgb(64, 140, 230) },
  ENCODER:      { collection: "ENCODE / DECODE",    colour: rgb(230, 102, 166) },
  SHIFTER:      { collection: "SHIFTERS",           colour: rgb(242, 140, 38) },
  ARITHMETIC:   { collection: "ARITHMETIC+",        colour: rgb(26, 128, 90) },
  FLIPFLOP:     { collection: "FLIP-FLOPS",         colour: rgb(216, 64, 64) },
  COUNTER:      { collection: "COUNTERS",           colour: rgb(230, 192, 52) },
  REGISTER:     { collection: "SHIFT REGISTERS",    colour: rgb(150, 102, 64) },
  PARITY:       { collection: "PARITY / BITCOUNT",  colour: rgb(166, 204, 52) },
  LOGICUTIL:    { collection: "LOGIC UTILS",        colour: rgb(102, 90, 192) },
  MISC:         { collection: "UTILITIES",          colour: rgb(116, 128, 148) }
};

function colourOf(categoryKey) {
  const c = CATEGORY[categoryKey];
  if (!c) throw new Error(`palette: categoria desconhecida "${categoryKey}"`);
  return { r: c.colour.r, g: c.colour.g, b: c.colour.b, a: 1.0 };
}

function collectionOf(categoryKey) {
  const c = CATEGORY[categoryKey];
  if (!c) throw new Error(`palette: categoria desconhecida "${categoryKey}"`);
  return c.collection;
}

// Ordem em que as coleções aparecem na biblioteca do DLS.
const COLLECTION_ORDER = [
  "SUBTRACTORS",
  "MULTI-GATES",
  "GATE BANKS",
  "ADDERS",
  "INC / DEC",
  "ARITHMETIC+",
  "COMPARATORS",
  "MUX / DEMUX",
  "ENCODE / DECODE",
  "SHIFTERS",
  "FLIP-FLOPS",
  "COUNTERS",
  "SHIFT REGISTERS",
  "PARITY / BITCOUNT",
  "LOGIC UTILS",
  "UTILITIES"
];

module.exports = { rgb, CATEGORY, colourOf, collectionOf, COLLECTION_ORDER };
