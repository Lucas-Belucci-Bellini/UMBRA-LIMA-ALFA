// build-project-description.js — sincroniza chips e coleções no projeto DLS.

const fs = require("fs");
const path = require("path");
const palette = require("./lib/palette");

const CHIPS_DIR = path.join(__dirname, "..", "Chips");
const PD_PATH = path.join(__dirname, "..", "ProjectDescription.json");
const MANIFEST_PATH = path.join(__dirname, "generated-manifest.json");

function main() {
  const pd = JSON.parse(fs.readFileSync(PD_PATH, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  // Mantém a lista alinhada aos arquivos ativos e ao manifesto de geração.
  pd.AllCustomChipNames = pd.AllCustomChipNames || [];
  const diskNames = fs.readdirSync(CHIPS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5));
  const existing = new Set(pd.AllCustomChipNames);
  for (const name of [...diskNames, ...(manifest.generated || [])]) {
    if (!existing.has(name)) {
      pd.AllCustomChipNames.push(name);
      existing.add(name);
    }
  }

  // Cria/mescla uma coleção por categoria, na ordem da paleta.
  pd.ChipCollections = pd.ChipCollections || [];
  const existingCollNames = new Set(pd.ChipCollections.map((c) => c.Name));
  pd.StarredList = pd.StarredList || [];
  const starred = new Set(pd.StarredList.map((s) => s.Name));

  for (const collName of palette.COLLECTION_ORDER) {
    const chips = (manifest.collections || {})[collName];
    if (!chips || chips.length === 0) continue;
    if (existingCollNames.has(collName)) {
      // mescla nos chips já presentes
      const coll = pd.ChipCollections.find((c) => c.Name === collName);
      const have = new Set(coll.Chips);
      for (const c of chips) if (!have.has(c)) coll.Chips.push(c);
    } else {
      pd.ChipCollections.push({
        Chips: chips.slice(),
        IsToggledOpen: false,
        Name: collName
      });
      existingCollNames.add(collName);
    }
    if (!starred.has(collName)) {
      pd.StarredList.push({ Name: collName, IsCollection: true });
      starred.add(collName);
    }
  }

  const timerNames = ["DELAY", "DELAY1", "DELAY2", "8-DELAY", "DELAY-RNG", "T-400"]
    .filter((name) => diskNames.includes(name));
  if (timerNames.length) {
    let timers = pd.ChipCollections.find((collection) => collection.Name === "TIMERS");
    if (!timers) {
      timers = { Chips: [], IsToggledOpen: false, Name: "TIMERS" };
      pd.ChipCollections.push(timers);
    }
    timers.Chips = timers.Chips || [];
    const inTimers = new Set(timers.Chips);
    for (const name of timerNames) if (!inTimers.has(name)) timers.Chips.push(name);
    if (!pd.StarredList.some((item) => item.Name === "TIMERS" && item.IsCollection)) {
      pd.StarredList.push({ Name: "TIMERS", IsCollection: true });
    }
  }

  fs.writeFileSync(PD_PATH, JSON.stringify(pd, null, 2), "utf8");

  const total = pd.AllCustomChipNames.length;
  const newColls = palette.COLLECTION_ORDER.filter((c) => manifest.collections[c]).length;
  console.log(`ProjectDescription atualizado:`);
  console.log(`  AllCustomChipNames: ${total} chips`);
  console.log(`  ChipCollections: ${pd.ChipCollections.length} (${newColls} novas categorias)`);
  console.log(`  Arquivos Chips/*.json: ${diskNames.length}`);
  if (total !== diskNames.length) {
    throw new Error(`Divergência entre chips listados (${total}) e arquivos (${diskNames.length}).`);
  }
  return pd;
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
