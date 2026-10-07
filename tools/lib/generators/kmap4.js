// kmap4.js — catálogo de funções booleanas de quatro variáveis.
// Cada chip implementa uma LUT 4→1 com MUX-16, alimentada por constantes.
// Os seis circuitos do quadro entram com nomes legíveis; os demais recebem
// o índice hexadecimal da tabela-verdade. A geração ocorre em lotes para
// manter o uso de memória estável durante a expansão para 30.000 arquivos.
const fs = require("fs");
const path = require("path");
const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate, finalize
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const ROOT = path.join(__dirname, "..", "..", "..");
const CHIPS_DIR = path.join(ROOT, "Chips");
const TARGET_TOTAL = 30000;
const INPUTS = ["A", "B", "C", "D"];
const BATCH_SIZE = 100;

function readSignature(name) {
  const file = path.join(CHIPS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`KMAP4: chip-base ausente: ${name}`);
  const chip = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    inputs: chip.InputPins.map((pin) => pin.ID),
    outputs: chip.OutputPins.map((pin) => pin.ID),
    size: chip.Size
  };
}

// Use as assinaturas reais salvas no projeto: isso evita IDs presumidos e
// mantém compatibilidade com alterações futuras em MUX-16/NOT/0.
for (const name of ["0", "NOT", "MUX-16"]) registry.KNOWN[name] = readSignature(name);

const WHITEBOARD_FUNCTIONS = [
  ["KMAP4-A", (A, B, C, D) => (D || C || B || !A) && (!C || B || A)],
  ["KMAP4-B", (A, B, C, D) => (!C || B || !A) && (!C || !B || A)],
  ["KMAP4-C", (A, B, C, D) => C || !B || A],
  ["KMAP4-D", (A, B, C, D) =>
    (D || C || B || !A) && (!C || B || A) && (!C || !B || !A)],
  ["KMAP4-E", (A, B, C, D) => (!C && !A) || (B && !A)],
  ["KMAP4-F", (A, B, C, D) =>
    (D || (C && !A)) && (C || !B) && (B || !A)]
];

function truthTableMask(fn) {
  let mask = 0;
  for (let index = 0; index < 16; index++) {
    const A = (index >> 0) & 1;
    const B = (index >> 1) & 1;
    const C = (index >> 2) & 1;
    const D = (index >> 3) & 1;
    if (fn(A, B, C, D)) mask |= (1 << index);
  }
  return mask;
}

const WHITEBOARD_MASKS = new Map(
  WHITEBOARD_FUNCTIONS.map(([name, fn]) => [name, truthTableMask(fn)])
);
const SPECIAL_MASKS = new Set(WHITEBOARD_MASKS.values());

function buildKmapChip(name, mask) {
  const chip = newChip(name, {
    size: { x: 2.2, y: 1.8 },
    colour: palette.colourOf("KMAP4")
  });
  const inputs = INPUTS.map((pinName) => addInputPin(chip, pinName, 1));
  const output = addOutputPin(chip, "F", 1);

  const zero = addSubChip(chip, "0", registry.KNOWN, {
    position: { x: -3, y: 1 }
  });
  const invertZero = addSubChip(chip, "NOT", registry.KNOWN, {
    position: { x: -1, y: 1 }
  });
  const lut = addSubChip(chip, "MUX-16", registry.KNOWN, {
    position: { x: 2, y: 0 }
  });
  wire(chip, zero.out(0), invertZero.in(0));

  // I0..I15 guardam F(A,B,C,D) para índice A + 2B + 4C + 8D.
  // S0..S3 do MUX-16 recebem os mesmos quatro bits, nessa ordem.
  for (let index = 0; index < 16; index++) {
    wire(chip, (mask >>> index) & 1 ? invertZero.out(0) : zero.out(0), lut.in(index));
  }
  inputs.forEach((pin, bit) => wire(chip, pin, lut.in(16 + bit)));
  wire(chip, lut.out(0), output);

  validate(chip);
  registry.register(name, INPUTS, ["F"]);
  finalize(chip);
  return { name, chip, collection: palette.collectionOf("KMAP4") };
}

function countChipFiles() {
  return fs.readdirSync(CHIPS_DIR).filter((name) => name.endsWith(".json")).length;
}

function* generateBatches(batchSize = BATCH_SIZE) {
  const currentCount = countChipFiles();
  if (currentCount > TARGET_TOTAL) {
    throw new Error(`Catálogo tem ${currentCount} arquivos; alvo é ${TARGET_TOTAL}.`);
  }
  let remaining = TARGET_TOTAL - currentCount;
  if (remaining === 0) return;

  let batch = [];
  const emit = function* (item) {
    batch.push(item);
    remaining--;
    if (batch.length >= batchSize) {
      const ready = batch;
      batch = [];
      yield ready;
    }
  };

  for (const [name, mask] of WHITEBOARD_MASKS) {
    if (remaining === 0) break;
    if (fs.existsSync(path.join(CHIPS_DIR, `${name}.json`))) continue;
    for (const ready of emit(buildKmapChip(name, mask))) yield ready;
  }

  for (let mask = 0; mask <= 0xffff && remaining > 0; mask++) {
    if (SPECIAL_MASKS.has(mask)) continue;
    const name = `KMAP4-LUT-${mask.toString(16).toUpperCase().padStart(4, "0")}`;
    if (fs.existsSync(path.join(CHIPS_DIR, `${name}.json`))) continue;
    for (const ready of emit(buildKmapChip(name, mask))) yield ready;
  }

  if (batch.length) yield batch;
  if (remaining > 0) {
    throw new Error(`Espaço de funções insuficiente; faltam ${remaining} chip(s).`);
  }
}

module.exports = {
  TARGET_TOTAL,
  WHITEBOARD_FUNCTIONS,
  WHITEBOARD_MASKS,
  truthTableMask,
  buildKmapChip,
  generateBatches
};
