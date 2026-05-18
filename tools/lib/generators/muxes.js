// muxes.js — multiplexadores e demultiplexadores.
// MUX-N: N:1, dado de 1 bit.  MUX-NxW: N:1 selecionando palavras de W bits.
// DEMUX análogo.

const {
  newChip, addInputPin, addOutputPin, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { decodeSelect, gate2, reduce } = require("../logic");

const log2 = (n) => Math.round(Math.log2(n));

function selNames(k) {
  return Array.from({ length: k }, (_, i) => `S${i}`);
}

function buildMux(channels, width) {
  const k = log2(channels);
  const name = width === 1 ? `MUX-${channels}` : `MUX-${channels}x${width}`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.8, channels * width * 0.25) },
    colour: palette.colourOf("MUX")
  });

  const data = [];
  for (let j = 0; j < channels; j++) {
    const row = [];
    for (let w = 0; w < width; w++) {
      const nm = width === 1 ? `I${j}` : `I${j}.${w}`;
      row.push(addInputPin(chip, nm, 1, { x: -12, y: (channels - j) * 1.0 - w * 0.2 }));
    }
    data.push(row);
  }
  const sel = selNames(k).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -12, y: -2.0 - i * 0.5 }));

  const outs = [];
  for (let w = 0; w < width; w++) {
    outs.push(addOutputPin(chip, width === 1 ? "OUT" : `OUT${w}`, 1, { x: 12, y: -w * 0.5 }));
  }

  const minterms = decodeSelect(chip, sel, -8);

  for (let w = 0; w < width; w++) {
    const andRefs = [];
    for (let j = 0; j < channels; j++) {
      andRefs.push(gate2(chip, "AND", data[j][w], minterms[j], 2));
    }
    wire(chip, reduce(chip, "OR", andRefs, 5), outs[w]);
  }

  validate(chip);
  const inNames = [];
  for (let j = 0; j < channels; j++)
    for (let w = 0; w < width; w++)
      inNames.push(width === 1 ? `I${j}` : `I${j}.${w}`);
  inNames.push(...selNames(k));
  const outNames = width === 1 ? ["OUT"] : Array.from({ length: width }, (_, w) => `OUT${w}`);
  registry.register(name, inNames, outNames);
  return { name, chip, collection: palette.collectionOf("MUX") };
}

function buildDemux(channels, width) {
  const k = log2(channels);
  const name = width === 1 ? `DEMUX-${channels}` : `DEMUX-${channels}x${width}`;
  const chip = newChip(name, {
    size: { x: 2.0, y: Math.max(0.8, channels * width * 0.25) },
    colour: palette.colourOf("MUX")
  });

  const data = [];
  for (let w = 0; w < width; w++) {
    data.push(addInputPin(chip, width === 1 ? "IN" : `IN${w}`, 1, { x: -10, y: 1.0 - w * 0.4 }));
  }
  const sel = selNames(k).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -10, y: -2.0 - i * 0.5 }));

  const outs = [];
  for (let j = 0; j < channels; j++) {
    const row = [];
    for (let w = 0; w < width; w++) {
      const nm = width === 1 ? `O${j}` : `O${j}.${w}`;
      row.push(addOutputPin(chip, nm, 1, { x: 12, y: (channels - j) * 1.0 - w * 0.2 }));
    }
    outs.push(row);
  }

  const minterms = decodeSelect(chip, sel, -6);

  for (let j = 0; j < channels; j++) {
    for (let w = 0; w < width; w++) {
      wire(chip, gate2(chip, "AND", data[w], minterms[j], 4), outs[j][w]);
    }
  }

  validate(chip);
  const inNames = [];
  for (let w = 0; w < width; w++) inNames.push(width === 1 ? "IN" : `IN${w}`);
  inNames.push(...selNames(k));
  const outNames = [];
  for (let j = 0; j < channels; j++)
    for (let w = 0; w < width; w++)
      outNames.push(width === 1 ? `O${j}` : `O${j}.${w}`);
  registry.register(name, inNames, outNames);
  return { name, chip, collection: palette.collectionOf("MUX") };
}

function generate() {
  const out = [];
  for (const n of [2, 4, 8, 16, 32]) out.push(buildMux(n, 1));
  for (const n of [2, 4, 8]) for (const w of [2, 3, 4, 5, 6, 8, 12, 16]) out.push(buildMux(n, w));
  for (const n of [2, 4, 8, 16, 32]) out.push(buildDemux(n, 1));
  for (const n of [2, 4, 8]) for (const w of [2, 3, 4, 6, 8, 12, 16]) out.push(buildDemux(n, w));
  return out;
}

module.exports = { generate };
