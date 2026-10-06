// verify-catalog.js — valida o catálogo expandido sem carregar todos os chips na memória.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const CHIPS_DIR = path.join(ROOT, "Chips");
const TARGET = 30000;
const KMAP_TARGET = 28879;
// Componentes internos do Digital Logic Sim referenciados por chips legados,
// mas que não são arquivos customizados em Chips/.
const DLS_HOST_COMPONENTS = new Set([
  "1-4BIT", "1-8BIT", "3-STATE BUFFER", "4-1BIT", "4-8BIT", "8-1BIT",
  "8-4BIT", "BUS-1", "BUS-8", "BUS-TERMINUS-1", "BUS-TERMINUS-8",
  "7-SEGMENT", "BUZZER", "BUS-4", "CLOCK", "DOT DISPLAY", "IN-1", "IN-4",
  "IN-8", "KEY", "LED", "NAND", "OUT-1", "OUT-4", "OUT-8", "PULSE",
  "RGB DISPLAY", "ROM 256×16"
]);
const expectedSegments = ["seg-a", "seg-b", "seg-c", "seg-d", "seg-e", "seg-f", "seg-g"];

function main() {
  const files = fs.readdirSync(CHIPS_DIR).filter((name) => name.endsWith(".json"));
  const names = new Set(files.map((file) => file.slice(0, -5)));
  const errors = [];
  const missingRefs = new Map();
  let subchipRefs = 0;
  const kmapFiles = files.filter((file) => file.startsWith("KMAP4-"));
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, "ProjectDescription.json"), "utf8"));
  const projectNames = project.AllCustomChipNames || [];
  const projectSet = new Set(projectNames);

  if (files.length !== TARGET) errors.push(`Arquivos Chips/*.json: ${files.length}, esperado ${TARGET}`);
  if (projectNames.length !== TARGET) errors.push(`AllCustomChipNames: ${projectNames.length}, esperado ${TARGET}`);
  if (projectSet.size !== projectNames.length) errors.push("AllCustomChipNames contém duplicatas");
  for (const name of names) if (!projectSet.has(name)) errors.push(`Arquivo fora de AllCustomChipNames: ${name}`);
  for (const name of projectSet) if (!names.has(name)) errors.push(`Nome sem arquivo JSON: ${name}`);
  if (kmapFiles.length !== KMAP_TARGET) errors.push(`KMAP4: ${kmapFiles.length}, esperado ${KMAP_TARGET}`);

  for (const file of files) {
    let chip;
    try {
      chip = JSON.parse(fs.readFileSync(path.join(CHIPS_DIR, file), "utf8"));
    } catch (error) {
      errors.push(`JSON inválido ${file}: ${error.message}`);
      continue;
    }
    const stem = file.slice(0, -5);
    if (chip.Name !== stem) errors.push(`Nome interno não coincide com arquivo: ${file}`);
    for (const subchip of chip.SubChips || []) {
      subchipRefs++;
      if (!names.has(subchip.Name) && !DLS_HOST_COMPONENTS.has(subchip.Name)) {
        missingRefs.set(subchip.Name, (missingRefs.get(subchip.Name) || 0) + 1);
      }
    }
  }
  for (const [name, refs] of missingRefs) errors.push(`Subchip sem arquivo nem registro nativo: ${name} (${refs} referências)`);

  for (const collection of project.ChipCollections || []) {
    for (const name of collection.Chips || []) {
      if (!names.has(name) && !DLS_HOST_COMPONENTS.has(name)) {
        errors.push(`Coleção ${collection.Name} aponta para chip ausente: ${name}`);
      }
    }
  }
  const collection = (name) => project.ChipCollections?.find((item) => item.Name === name)?.Chips || [];
  if (collection("KARNAUGH / 4-VARIÁVEIS").length !== KMAP_TARGET) {
    errors.push("Coleção KARNAUGH / 4-VARIÁVEIS não contém todos os KMAP4");
  }
  for (const name of ["KMAP4-A", "KMAP4-B", "KMAP4-C", "KMAP4-D", "KMAP4-E", "KMAP4-F"]) {
    if (!names.has(name)) errors.push(`Chip do quadro ausente: ${name}`);
  }
  const timers = collection("TIMERS");
  if (timers.length !== 6) errors.push(`Coleção TIMERS contém ${timers.length} chips, esperado 6`);
  for (const name of ["SHIFT REGISTERS", "COUNTERS", "FLIP-FLOPS"]) {
    if (!collection(name).length) errors.push(`Coleção sequencial ausente ou vazia: ${name}`);
  }
  for (const name of ["BCD-7SEG", "HEX-7SEG"]) {
    const chip = JSON.parse(fs.readFileSync(path.join(CHIPS_DIR, `${name}.json`), "utf8"));
    const actual = chip.OutputPins.map((pin) => pin.Name);
    if (JSON.stringify(actual) !== JSON.stringify(expectedSegments)) {
      errors.push(`${name} não expõe os sete segmentos esperados`);
    }
  }

  const result = {
    files: files.length,
    projectNames: projectNames.length,
    kmap4: kmapFiles.length,
    kmapCollection: collection("KARNAUGH / 4-VARIÁVEIS").length,
    timers: timers.length,
    shiftRegisters: collection("SHIFT REGISTERS").length,
    counters: collection("COUNTERS").length,
    flipFlops: collection("FLIP-FLOPS").length,
    sevenSegmentOutputs: expectedSegments,
    subchipReferencesChecked: subchipRefs,
    nativeDlsComponentNames: [...DLS_HOST_COMPONENTS],
    errors
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
  return result;
}

if (require.main === module) main();
module.exports = { main };
