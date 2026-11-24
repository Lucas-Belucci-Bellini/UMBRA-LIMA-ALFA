// build-memoria256x8.js — atividade de memória: 256 endereços x 8 bits.
//
// MEMORIA 256x8 usa EXATAMENTE 8 chips MEM-256 (um por bit do byte),
// numa grade de 4 linhas x 2 colunas:
//   ENDERECO (8 bits) -> ADDR de todos os MEM-256
//   DADO (8 bits)     -> 8-1BIT -> DATA do MEM-256 de cada bit
//   WRITE             -> STORE de todos (1 = grava, 0 = só lê)
//   OUT de cada MEM-256 -> DISPLAY BIN-8 (3 dígitos, 0..255) e -> 1-8BIT -> SAIDA
// O DISPLAY BIN-8 aparece no próprio bloco do chip (campo Displays).
//
// Uso: node tools/build-memoria256x8.js

const fs = require("fs");
const path = require("path");
const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate, serialize
} = require("./lib/chip-builder");
const registry = require("./lib/pin-registry");
const { makePinResolver } = require("./lib/layout");
const { route } = require("./lib/router");

const CHIPS = path.join(__dirname, "..", "Chips");
const PD_PATH = path.join(__dirname, "..", "ProjectDescription.json");
const NAME = "MEMORIA 256x8";
const COLLECTION = "MEMORIA (ATIVIDADE)";

// Registro de um chip do projeto a partir do JSON (IDs na ordem do arquivo).
function registerFromFile(name) {
  const c = JSON.parse(fs.readFileSync(path.join(CHIPS, `${name}.json`), "utf8"));
  registry.KNOWN[name] = {
    inputs: c.InputPins.map((p) => p.ID),
    outputs: c.OutputPins.map((p) => p.ID),
    size: c.Size
  };
}
registerFromFile("MEM-256");       // DATA, STORE, ADDR(8) -> OUT
registerFromFile("DISPLAY BIN-8"); // B7..B0

// Builtins do DLS (IDs posicionais, conferidos no fonte do DLS):
// 8-1BIT: entrada 0; saídas 1..8, a saída 1 é o bit 7 (MSB).
// 1-8BIT: entradas 0..7, a entrada 0 é o bit 7 (MSB); saída 8.
registry.KNOWN["8-1BIT"] = { inputs: [0], outputs: [1, 2, 3, 4, 5, 6, 7, 8], size: { x: 1.125, y: 2.0 } };
registry.KNOWN["1-8BIT"] = { inputs: [0, 1, 2, 3, 4, 5, 6, 7], outputs: [8], size: { x: 1.125, y: 2.0 } };

function build() {
  const chip = newChip(NAME, {
    size: { x: 4.2, y: 3.0 },
    colour: { r: 0.12, g: 0.16, b: 0.3, a: 1.0 }
  });
  chip.NameLocation = 1; // nome em cima, display embaixo

  const ADDR = addInputPin(chip, "ENDERECO", 8);
  const DATA = addInputPin(chip, "DADO", 8);
  const WR = addInputPin(chip, "WRITE", 1);
  const OUT = addOutputPin(chip, "SAIDA", 8);
  // Valor decimal nos pinos de 8 bits (como o ADDR do MEM-256).
  for (const p of [...chip.InputPins, ...chip.OutputPins]) if (p.BitCount === 8) p.ValueDisplayMode = 1;

  const split = addSubChip(chip, "8-1BIT", registry.KNOWN);
  const merge = addSubChip(chip, "1-8BIT", registry.KNOWN);
  const disp = addSubChip(chip, "DISPLAY BIN-8", registry.KNOWN);
  wire(chip, DATA, split.in(0));

  // mem[b] guarda o bit b (b = 0 é o menos significativo).
  const mem = [];
  for (let b = 7; b >= 0; b--) {
    const m = addSubChip(chip, "MEM-256", registry.KNOWN, { label: `BIT ${b}` });
    mem[b] = m;
    wire(chip, split.out(7 - b), m.in(0)); // DATA
    wire(chip, WR, m.in(1));               // STORE
    wire(chip, ADDR, m.in(2));             // ADDR (8 bits)
    wire(chip, m.out(0), disp.in(7 - b));  // DISPLAY BIN-8: B7..B0
    wire(chip, m.out(0), merge.in(7 - b)); // 1-8BIT: entrada 0 = bit 7
  }
  wire(chip, merge.out(0), OUT);
  validate(chip);

  // Posições: grade 4x2 dos MEM-256 (bit 7 em cima à esquerda).
  const pos = {};
  const at = (id, x, y) => { pos[id] = { x, y }; };
  at(chip.InputPins[0].ID, -7, 3);
  at(chip.InputPins[1].ID, -7, 0);
  at(chip.InputPins[2].ID, -7, -3);
  at(split.id, -4.5, 0);
  for (let b = 7; b >= 0; b--) {
    const k = 7 - b; // 0..7 na ordem da grade
    at(mem[b].id, (k % 2) * 3.4, +(4.8 - Math.floor(k / 2) * 3.2).toFixed(2));
  }
  at(disp.id, 9.5, 2.5);
  at(merge.id, 7.5, -3);
  at(chip.OutputPins[0].ID, 10, -3);
  for (const p of chip.InputPins) p.Position = pos[p.ID];
  for (const p of chip.OutputPins) p.Position = pos[p.ID];
  for (const s of chip.SubChips) s.Position = pos[s.ID];
  route(chip, makePinResolver(chip, pos));

  // O display de 3 dígitos do DISPLAY BIN-8 aparece no bloco.
  chip.Displays = [{ SubChipID: disp.id, Position: { x: 0, y: -0.1 }, Scale: 0.7 }];
  return chip;
}

function main() {
  const chip = build();
  fs.writeFileSync(path.join(CHIPS, `${NAME}.json`), serialize(chip), "utf8");

  // O ProjectDescription.json é gravado pelo próprio DLS, com formatação
  // dele: edição textual mínima (logo depois do MEM-256), sem reformatar.
  let text = fs.readFileSync(PD_PATH, "utf8");
  const pd = JSON.parse(text);
  if (!pd.AllCustomChipNames.includes(NAME)) {
    text = text.replace(/("AllCustomChipNames"\s*:\s*\[[^\]]*?"MEM-256")/, `$1,"${NAME}"`);
  }
  const coll = (pd.ChipCollections || []).find((c) => c.Name === COLLECTION);
  if (!coll) throw new Error(`coleção "${COLLECTION}" não existe no ProjectDescription`);
  if (!coll.Chips.includes(NAME)) {
    text = text.replace(/("Chips"\s*:\s*\[[^\]]*?"MEM-256")(\][^\]]*?"Name"\s*:\s*"MEMORIA \(ATIVIDADE\)")/, `$1, "${NAME}"$2`);
  }
  const check = JSON.parse(text);
  if (!check.AllCustomChipNames.includes(NAME) ||
      !check.ChipCollections.find((c) => c.Name === COLLECTION).Chips.includes(NAME)) {
    throw new Error("não consegui inserir o chip no ProjectDescription.json");
  }
  fs.writeFileSync(PD_PATH, text, "utf8");
  console.log(`escrito: ${NAME}`);
}

if (require.main === module) main();
module.exports = { NAME };
