// build-project-description.js — atualiza o ProjectDescription.json do
// projeto: adiciona os 505 chips novos em AllCustomChipNames e cria uma
// ChipCollection (coleção colorida na biblioteca do DLS) por categoria.

const fs = require("fs");
const path = require("path");
const palette = require("./lib/palette");

const CHIPS_DIR = path.join(__dirname, "..", "Chips");
const PD_PATH = path.join(__dirname, "..", "ProjectDescription.json");
const MANIFEST_PATH = path.join(__dirname, "generated-manifest.json");

function main() {
  const pd = JSON.parse(fs.readFileSync(PD_PATH, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  // 1) AllCustomChipNames: mantém os existentes, adiciona os novos no fim.
  const existing = new Set(pd.AllCustomChipNames || []);
  for (const name of manifest.generated) {
    if (!existing.has(name)) {
      pd.AllCustomChipNames.push(name);
      existing.add(name);
    }
  }

  // 2) ChipCollections: cria uma coleção por categoria, na ordem da paleta.
  pd.ChipCollections = pd.ChipCollections || [];
  const existingCollNames = new Set(pd.ChipCollections.map((c) => c.Name));
  pd.StarredList = pd.StarredList || [];
  const starred = new Set(pd.StarredList.map((s) => s.Name));

  for (const collName of palette.COLLECTION_ORDER) {
    const chips = manifest.collections[collName];
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

  fs.writeFileSync(PD_PATH, JSON.stringify(pd, null, 2), "utf8");

  const total = pd.AllCustomChipNames.length;
  const newColls = palette.COLLECTION_ORDER.filter((c) => manifest.collections[c]).length;
  console.log(`ProjectDescription atualizado:`);
  console.log(`  AllCustomChipNames: ${total} chips`);
  console.log(`  ChipCollections: ${pd.ChipCollections.length} (${newColls} novas categorias)`);
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
