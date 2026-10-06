// generate-chips.js — entrypoint do gerador.
// Roda todos os módulos em ./lib/generators/, dedupe por nome,
// valida cada JSON e escreve em ../chips/.

const fs = require("fs");
const path = require("path");

const { serialize, validate, finalize } = require("./lib/chip-builder");
const registry = require("./lib/pin-registry");

const GENERATORS_DIR = path.join(__dirname, "lib", "generators");
const OUT_DIR = path.join(__dirname, "..", "Chips");
const MANIFEST_PATH = path.join(__dirname, "generated-manifest.json");

// O catálogo completo do ULA é limitado a 30.000 arquivos JSON.
const MAX_NEW = 30000;

// Ordem dos geradores importa: chips que outros usam como subchip
// têm que ser gerados antes.
const ORDER = [
  "subtractors",
  "multi-input-gates",
  "gate-arrays",
  "seg7",
  "adders",
  "comparators",
  "signed",
  "muxes",
  "alu",
  "encoders",
  "shifters",
  "arithmetic",
  "parity",
  "logic-utils",
  "sequential",
  "counters",
  "registers",
  "misc",
  "bitops",
  "extras",
  "kmap4"
];

function loadGenerators() {
  const loaded = [];
  for (const slug of ORDER) {
    const p = path.join(GENERATORS_DIR, `${slug}.js`);
    if (!fs.existsSync(p)) {
      console.log(`  skip: ${slug}.js não existe ainda`);
      continue;
    }
    const mod = require(p);
    if (typeof mod.generate !== "function" && typeof mod.generateBatches !== "function") {
      throw new Error(`${slug}.js: não exporta generate() nem generateBatches()`);
    }
    loaded.push({ slug, ...mod });
  }
  return loaded;
}

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // Chips do Lucas que NÃO devem ser sobrescritos (outros chips dele
  // dependem destes pelos IDs de pino originais). Os subtratores (Half/
  // Full Subtractor) NÃO entram aqui — o usuário pediu para criá-los, e
  // os subtratores N-bit dependem da versão gerada.
  const PRESERVE = new Set([
    "AND-3", "AND-4", "OR-3", "NAND-3", "NAND-4", "XNOR-3", "XNOR-4"
  ]);
  const previous = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : { generated: [], collections: {} };
  const generated = [...new Set(previous.generated || [])];
  const generatedSet = new Set(generated);
  const collections = Object.fromEntries(
    Object.entries(previous.collections || {}).map(([name, chips]) => [name, [...new Set(chips)]])
  );
  const seen = new Set(); // dedup interno (dois geradores com mesmo nome)
  console.log(`(${PRESERVE.size} chips legados preservados; arquivos existentes não serão sobrescritos)`);

  let written = 0;
  let skipped = 0;

  let capped = false;
  for (const generator of loadGenerators()) {
    if (capped) break;
    const { slug } = generator;
    console.log(`\n[${slug}]`);
    const batches = generator.generateBatches
      ? generator.generateBatches()
      : [generator.generate()];
    let wroteHere = 0;
    let batchNumber = 0;
    for (const items of batches) {
      for (const { name, chip, collection } of items) {
        if (written >= MAX_NEW) { capped = true; break; }
        if (PRESERVE.has(name) || seen.has(name)) {
          skipped++;
          continue;
        }
        const outputPath = path.join(OUT_DIR, `${name}.json`);
        if (fs.existsSync(outputPath)) {
          skipped++;
          continue;
        }
        try {
          if (registry.KNOWN[name]) registry.KNOWN[name].size = chip.Size;
          validate(chip);
          if (slug !== "kmap4") finalize(chip); // K-map já chega finalizado
        } catch (e) {
          console.error(`  ✗ ${name}: ${e.message}`);
          throw e;
        }
        const body = slug === "kmap4" ? JSON.stringify(chip) : serialize(chip);
        fs.writeFileSync(outputPath, body, "utf8");
        seen.add(name);
        if (!generatedSet.has(name)) {
          generated.push(name);
          generatedSet.add(name);
        }
        if (collection) {
          collections[collection] = collections[collection] || [];
          if (!collections[collection].includes(name)) collections[collection].push(name);
        }
        written++;
        wroteHere++;
      }
      batchNumber++;
      if (slug === "kmap4" && batchNumber % 25 === 0) {
        console.log(`  progresso K-map: ${wroteHere} novos chips escritos`);
      }
      if (capped) break;
    }
    console.log(`  -> ${wroteHere} chip(s) escritos`);
  }

  console.log(`\n=== ${written} chip(s) gerado(s), ${skipped} pulado(s) ===`);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ generated, collections }, null, 2) + "\n");
  const totalFiles = fs.readdirSync(OUT_DIR).filter((name) => name.endsWith(".json")).length;
  console.log(`=== ${totalFiles} arquivos no catálogo ===`);
  if (totalFiles !== 30000) throw new Error(`Alvo não atingido: ${totalFiles} de 30000 arquivos.`);
  return { written, skipped, generated, collections };
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("FALHOU:", e.message);
    process.exit(1);
  }
}

module.exports = { main };
