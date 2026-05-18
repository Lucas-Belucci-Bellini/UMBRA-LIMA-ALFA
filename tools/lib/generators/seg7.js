// seg7.js — decodificadores de 7 segmentos (combinacional).
// HEX-7SEG: 4 bits -> 7 segmentos (a..g). Para cada segmento, OR dos
// minterms dos dígitos que acendem aquele segmento.

const {
  newChip, addInputPin, addOutputPin, validate, wire
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { decodeSelect, reduce } = require("../logic");

const CAT = "ENCODER";

// dígitos (0-F) que acendem cada segmento no display de 7 segmentos
const SEG = {
  a: [0, 2, 3, 5, 6, 7, 8, 9, 10, 12, 14, 15],
  b: [0, 1, 2, 3, 4, 7, 8, 9, 10, 13],
  c: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13],
  d: [0, 2, 3, 5, 6, 8, 9, 11, 12, 13, 14],
  e: [0, 2, 6, 8, 10, 11, 12, 13, 14, 15],
  f: [0, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15],
  g: [2, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15]
};
const SEGS = ["a", "b", "c", "d", "e", "f", "g"];

// maxDigit: 16 para HEX, 10 para BCD (dígitos acima ficam apagados)
function buildDecoder7seg(name, maxDigit) {
  const chip = newChip(name, {
    size: { x: 1.8, y: 1.2 },
    colour: palette.colourOf(CAT)
  });
  const D = ["D0", "D1", "D2", "D3"].map((nm) => addInputPin(chip, nm, 1));
  const segOut = SEGS.map((s) => addOutputPin(chip, "seg-" + s, 1));

  const minterms = decodeSelect(chip, D);
  SEGS.forEach((s, si) => {
    const digits = SEG[s].filter((d) => d < maxDigit);
    if (digits.length === 0) return; // segmento nunca acende
    const refs = digits.map((d) => minterms[d]);
    wire(chip, refs.length === 1 ? refs[0] : reduce(chip, "OR", refs), segOut[si]);
  });

  validate(chip);
  registry.register(name, ["D0", "D1", "D2", "D3"], SEGS.map((s) => "seg-" + s));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  return [
    buildDecoder7seg("HEX-7SEG", 16),
    buildDecoder7seg("BCD-7SEG", 10)
  ];
}

module.exports = { generate };
