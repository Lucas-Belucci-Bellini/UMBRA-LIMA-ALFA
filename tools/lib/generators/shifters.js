// shifters.js — deslocadores fixos (shift/rotate por K) e barrel shifters
// (deslocamento variável controlado por seletor).

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf } = require("../logic");

const inNames  = (n) => Array.from({ length: n }, (_, i) => `A${i}`);
const outNames = (n) => Array.from({ length: n }, (_, i) => `S${i}`);

// mux 2:1 -> out = sel ? b : a
function mux2(chip, sel, a, b, x) {
  const ns = notOf(chip, sel, x);
  const t0 = gate2(chip, "AND", ns, a, x + 1);
  const t1 = gate2(chip, "AND", sel, b, x + 1);
  return gate2(chip, "OR", t0, t1, x + 2);
}

function buildFixedShifter(mode, bits, amount) {
  const suffix = amount === 1 ? "" : `-${amount}`;
  const name = `${mode}-${bits}${suffix}`;
  const chip = newChip(name, {
    size: { x: 1.4, y: Math.max(0.6, bits * 0.35) },
    colour: palette.colourOf("SHIFTER")
  });

  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -8, y: (bits - i) * 0.6 }));
  const S = outNames(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 7, y: (bits - i) * 0.6 }));

  let zero = null;
  const needZero = mode === "SHL" || mode === "SHR" || mode === "ASR";
  if (needZero) {
    zero = addSubChip(chip, "0", registry.KNOWN, { position: { x: 0, y: -bits * 0.6 } });
  }

  for (let i = 0; i < bits; i++) {
    let srcIdx;
    if (mode === "SHL") {
      srcIdx = i - amount;
    } else if (mode === "SHR" || mode === "ASR") {
      srcIdx = i + amount;
    } else if (mode === "ROL") {
      srcIdx = ((i - amount) % bits + bits) % bits;
    } else {
      srcIdx = (i + amount) % bits;
    }

    if (srcIdx >= 0 && srcIdx < bits) {
      wire(chip, A[srcIdx], S[i]);
    } else if (mode === "ASR" && srcIdx >= bits) {
      wire(chip, A[bits - 1], S[i]);
    } else {
      wire(chip, zero.out(0), S[i]);
    }
  }

  validate(chip);
  registry.register(name, inNames(bits), outNames(bits));
  return { name, chip, collection: palette.collectionOf("SHIFTER") };
}

function buildBarrel(mode, bits) {
  const stages = Math.round(Math.log2(bits));
  const name = `BARREL-${mode}-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(0.8, bits * 0.4) },
    colour: palette.colourOf("SHIFTER")
  });

  const A = inNames(bits).map((nm, i) =>
    addInputPin(chip, nm, 1, { x: -14, y: (bits - i) * 0.6 }));
  const SH = Array.from({ length: stages }, (_, s) =>
    addInputPin(chip, `SH${s}`, 1, { x: -14, y: -bits * 0.6 - s * 0.5 }));
  const S = outNames(bits).map((nm, i) =>
    addOutputPin(chip, nm, 1, { x: 13, y: (bits - i) * 0.6 }));

  const zero = addSubChip(chip, "0", registry.KNOWN, { position: { x: -10, y: -bits * 0.6 } });
  const zRef = zero.out(0);

  let layer = A.slice();
  for (let s = 0; s < stages; s++) {
    const shiftBy = 1 << s;
    const next = [];
    for (let i = 0; i < bits; i++) {
      let srcIdx;
      if (mode === "SHL") srcIdx = i - shiftBy;
      else if (mode === "SHR") srcIdx = i + shiftBy;
      else if (mode === "ROL") srcIdx = ((i - shiftBy) % bits + bits) % bits;
      else srcIdx = (i + shiftBy) % bits;

      const shifted = (srcIdx >= 0 && srcIdx < bits) ? layer[srcIdx] : zRef;
      next.push(mux2(chip, SH[s], layer[i], shifted, s * 4 - 8));
    }
    layer = next;
  }

  for (let i = 0; i < bits; i++) wire(chip, layer[i], S[i]);

  validate(chip);
  registry.register(name,
    [...inNames(bits), ...Array.from({ length: stages }, (_, s) => `SH${s}`)],
    outNames(bits));
  return { name, chip, collection: palette.collectionOf("SHIFTER") };
}

function generate() {
  const out = [];
  for (const mode of ["SHL", "SHR", "ASR", "ROL", "ROR"]) {
    for (const w of [4, 6, 8, 12, 16, 24, 32]) out.push(buildFixedShifter(mode, w, 1));
  }
  for (const mode of ["SHL", "SHR"]) {
    for (const w of [8, 12, 16, 24, 32]) {
      out.push(buildFixedShifter(mode, w, 2));
      out.push(buildFixedShifter(mode, w, 3));
    }
  }
  for (const mode of ["SHL", "SHR"]) {
    for (const w of [8, 12, 16, 24, 32]) out.push(buildBarrel(mode, w));
  }
  for (const mode of ["ROL", "ROR"]) {
    for (const w of [8, 12, 16]) out.push(buildBarrel(mode, w));
  }
  return out;
}

module.exports = { generate };
