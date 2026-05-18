// generate-chips.js — entrypoint do gerador.
// Roda todos os módulos em ./lib/generators/, dedupe por nome,
// valida cada JSON e escreve em ../chips/.

const fs = require("fs");
const path = require("path");

const { serialize, validate, finalize } = require("./lib/chip-builder");
const registry = require("./lib/pin-registry");

const GENERATORS_DIR = path.join(__dirname, "lib", "generators");
const OUT_DIR = path.join(__dirname, "..", "chips");

// Teto de chips novos. Alto de propósito — o usuário pediu "pode passar
// de 1100"; o gerador escreve tudo que os módulos produzirem.
const MAX_NEW = 5000;

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
  "extras"
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
    if (typeof mod.generate !== "function") {
      throw new Error(`${slug}.js: não exporta generate()`);
    }
    loaded.push({ slug, generate: mod.generate });
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
  const seen = new Set(); // dedup interno (dois geradores com mesmo nome)
  console.log(`(${PRESERVE.size} chips do Lucas preservados; o resto é escrito/sobrescrito)`);

  let written = 0;
  let skipped = 0;
  const generated = [];
  const collections = {}; // nome da coleção -> [nomes de chips]

  let capped = false;
  for (const { slug, generate } of loadGenerators()) {
    if (capped) break;
    console.log(`\n[${slug}]`);
    const items = generate();
    let wroteHere = 0;
    for (const { name, chip, collection } of items) {
      if (written >= MAX_NEW) { capped = true; break; }
      if (PRESERVE.has(name) || seen.has(name)) {
        skipped++;
        continue;
      }
      try {
        if (registry.KNOWN[name]) registry.KNOWN[name].size = chip.Size;
        validate(chip);
        finalize(chip); // layout em camadas + roteamento ortogonal dos fios
      } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        throw e;
      }
      fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), serialize(chip), "utf8");
      seen.add(name);
      generated.push(name);
      if (collection) {
        (collections[collection] = collections[collection] || []).push(name);
      }
      written++;
      wroteHere++;
    }
    console.log(`  -> ${wroteHere} chip(s) escritos`);
  }

  console.log(`\n=== ${written} chip(s) gerado(s), ${skipped} pulado(s) ===`);
  fs.writeFileSync(
    path.join(__dirname, "generated-manifest.json"),
    JSON.stringify({ generated, collections }, null, 2)
  );
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
