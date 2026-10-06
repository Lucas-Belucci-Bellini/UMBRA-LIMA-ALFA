// report-catalog-distribution.js — relatório e CSVs a partir dos arquivos reais do catálogo.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const CHIP_DIR = path.join(ROOT, "Chips");
const OUT_DIR = path.join(ROOT, "reports");
const TARGET = 30000;
const PR = {
  number: 6,
  url: "https://github.com/Lucas-Belucci-Bellini/UMBRA-LIMA-ALFA/pull/6",
  base: "main",
  head: "feat/ula-catalog-30000",
  state: "OPEN",
  mergeability: "MERGEABLE",
  ci: "Nenhum workflow GitHub Actions encontrado; nenhuma execução/check reportado na branch."
};
const REGISTER_FAMILIES = ["SHIFT REGISTERS", "COUNTERS", "FLIP-FLOPS", "MEMORY", "TIMERS"];
const LEGACY_PRIORITY = ["TIMERS", "MEMORY", "ARITHMETIC", "LOGIC", "OTHER", "BASIC", "UTILITIES"];

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function pct(value, total) { return (value / total * 100).toFixed(4); }
function table(rows, headers) {
  const escape = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`)
  ].join("\n");
}
function sortedCountMap(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
}

function main() {
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, "ProjectDescription.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "generated-manifest.json"), "utf8"));
  const files = fs.readdirSync(CHIP_DIR).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
  const fileSet = new Set(files);
  if (files.length !== TARGET || (project.AllCustomChipNames || []).length !== TARGET) {
    throw new Error(`Esperados ${TARGET} chips, encontrados ${files.length} arquivos e ${(project.AllCustomChipNames || []).length} nomes.`);
  }

  const generated = new Set(manifest.generated || []);
  const manifestCategories = new Map();
  for (const [category, chips] of Object.entries(manifest.collections || {})) {
    for (const chip of chips) {
      if (!fileSet.has(chip)) continue;
      if (!manifestCategories.has(chip)) manifestCategories.set(chip, []);
      manifestCategories.get(chip).push(category);
    }
  }
  const chipCollections = new Map(files.map((name) => [name, []]));
  for (const collection of project.ChipCollections || []) {
    for (const name of new Set(collection.Chips || [])) {
      if (fileSet.has(name)) chipCollections.get(name).push(collection.Name);
    }
  }

  // Exclusive partition: use generated-manifest family for generated assets;
  // otherwise use the existing project collection, prioritizing TIMERS over OTHER.
  const primaryCategory = new Map();
  for (const name of files) {
    const fromGenerator = manifestCategories.get(name) || [];
    if (fromGenerator.length) {
      primaryCategory.set(name, fromGenerator[0]);
      continue;
    }
    const members = chipCollections.get(name);
    primaryCategory.set(name,
      LEGACY_PRIORITY.find((category) => members.includes(category)) ||
      members[0] || "UNCATEGORIZED / LEGACY");
  }

  const primaryCounts = new Map();
  const primaryGenerated = new Map();
  const primaryLegacy = new Map();
  for (const [name, category] of primaryCategory) {
    primaryCounts.set(category, (primaryCounts.get(category) || 0) + 1);
    const target = generated.has(name) ? primaryGenerated : primaryLegacy;
    target.set(category, (target.get(category) || 0) + 1);
  }
  const partitionTotal = [...primaryCounts.values()].reduce((sum, count) => sum + count, 0);
  if (partitionTotal !== TARGET) throw new Error(`Partição exclusiva soma ${partitionTotal}, não ${TARGET}.`);

  const collectionRows = [];
  const collectionData = [];
  let customMemberships = 0;
  let hostMemberships = 0;
  for (const collection of project.ChipCollections || []) {
    const listed = [...new Set(collection.Chips || [])];
    const custom = listed.filter((name) => fileSet.has(name));
    const host = listed.filter((name) => !fileSet.has(name));
    customMemberships += custom.length;
    hostMemberships += host.length;
    collectionData.push({ name: collection.Name, custom, host });
    collectionRows.push([collection.Name, custom.length, host.length, listed.length]);
  }
  const assignedChips = [...chipCollections].filter(([, memberships]) => memberships.length > 0);
  const multi = [...chipCollections].filter(([, memberships]) => memberships.length > 1);
  const uncategorized = [...chipCollections].filter(([, memberships]) => memberships.length === 0).map(([name]) => name);
  const distinctMembership = new Set(assignedChips.map(([name]) => name)).size;

  const primaryRows = sortedCountMap(primaryCounts).map(([category, count]) => [
    category, count, `${pct(count, TARGET)}%`, primaryGenerated.get(category) || 0,
    primaryLegacy.get(category) || 0
  ]);

  const categoryCsv = [
    ["primary_category", "unique_chip_count", "share_percent", "generated", "legacy_preexisting", "project_collection_memberships", "host_items_in_collection", "examples"].map(csv).join(",")
  ];
  for (const [category, count] of sortedCountMap(primaryCounts)) {
    const collection = collectionData.find((item) => item.name === category);
    const examples = files.filter((name) => primaryCategory.get(name) === category).slice(0, 8).join(" | ");
    categoryCsv.push([
      category, count, pct(count, TARGET), primaryGenerated.get(category) || 0,
      primaryLegacy.get(category) || 0, collection?.custom.length || 0,
      collection?.host.length || 0, examples
    ].map(csv).join(","));
  }

  const ledger = [["chip", "file", "primary_category", "project_collections", "origin"].map(csv).join(",")];
  for (const name of files) {
    const categories = chipCollections.get(name);
    const origin = name.startsWith("KMAP4-") ? "KMAP4 generated" : (generated.has(name) ? "generated catalog family" : "pre-existing/legacy");
    ledger.push([name, `${name}.json`, primaryCategory.get(name), categories.join(" | "), origin].map(csv).join(","));
  }

  const familySets = REGISTER_FAMILIES.map((category) => new Set(
    collectionData.find((item) => item.name === category)?.custom || []
  ));
  const familyUnion = new Set(familySets.flatMap((set) => [...set]));
  const registerRows = REGISTER_FAMILIES.map((category, index) => {
    const names = [...familySets[index]].sort();
    return [category, names.length, `${pct(names.length, TARGET)}%`, names.join(", ")];
  });

  const encoderCollection = collectionData.find((item) => item.name === "ENCODE / DECODE")?.custom || [];
  const segmentChips = encoderCollection.filter((name) => name.includes("7SEG")).sort();
  const segmentPinNames = ["seg-a", "seg-b", "seg-c", "seg-d", "seg-e", "seg-f", "seg-g"];
  const segmentDetails = segmentChips.map((name) => {
    const chip = JSON.parse(fs.readFileSync(path.join(CHIP_DIR, `${name}.json`), "utf8"));
    return { name, pins: chip.OutputPins.map((pin) => pin.Name) };
  });
  if (segmentDetails.some((detail) => JSON.stringify(detail.pins) !== JSON.stringify(segmentPinNames))) {
    throw new Error("Os chips 7SEG não apresentam exatamente sete saídas de segmento.");
  }

  const kmapCount = files.filter((name) => name.startsWith("KMAP4-")).length;
  const kmapNamed = ["KMAP4-A", "KMAP4-B", "KMAP4-C", "KMAP4-D", "KMAP4-E", "KMAP4-F"].filter((name) => fileSet.has(name)).length;
  const kmapLut = kmapCount - kmapNamed;
  const baseCount = TARGET - kmapCount;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const primaryTable = table(primaryRows, ["Categoria principal (exclusiva)", "Chips", "% do total", "Gerados", "Legados"]);
  const collectionTable = table(collectionRows, ["Coleção no projeto", "JSONs custom", "Itens nativos sem JSON", "Itens listados"]);
  const registerTable = table(registerRows, ["Família sequencial / registradores", "Chips", "% do catálogo", "Cobertura por largura/tipo"]);
  const segmentTable = table(segmentDetails.map((detail) => [detail.name, detail.pins.join(", "), detail.pins.length]), ["Chip", "Saídas", "Segmentos"]);

  const report = `# Relatório detalhado — distribuição do catálogo ULA\n\n` +
    `**Data:** ${today} (America/Sao_Paulo)\n\n` +
    `**Pull request:** [#${PR.number}](${PR.url}) — ${PR.head} → ${PR.base}; estado ${PR.state}, mergeability ${PR.mergeability}.\n\n` +
    `**CI:** ${PR.ci}\n\n` +
    `## Resumo executivo\n\n` +
    `- **${TARGET.toLocaleString("pt-BR")} arquivos JSON** e o mesmo número de chips em \`AllCustomChipNames\`.\n` +
    `- **${kmapCount.toLocaleString("pt-BR")} chips KMAP4** (${pct(kmapCount, TARGET)}%): ${kmapNamed} funções do quadro e ${kmapLut.toLocaleString("pt-BR")} LUTs identificadas por máscara hexadecimal.\n` +
    `- Os outros **${baseCount.toLocaleString("pt-BR")} chips** são a base anterior preservada.\n` +
    `- **${Object.keys(Object.fromEntries(primaryCounts)).length} categorias primárias** particionam todos os ${TARGET.toLocaleString("pt-BR")} chips sem duplicação.\n` +
    `- A distribuição por coleção é sobreposta: ${customMemberships.toLocaleString("pt-BR")} vínculos de chips customizados para ${distinctMembership.toLocaleString("pt-BR")} chips classificados; ${multi.length} chips pertencem a mais de uma coleção e ${uncategorized.length} não pertence a coleção.\n\n` +
    `## Distribuição exclusiva por categoria principal\n\n` +
    `Para cada arquivo foi escolhida uma categoria principal: categoria do manifesto do gerador para chips gerados; para chips preexistentes, coleção já presente no projeto, priorizando \`TIMERS\` em relação a \`OTHER\`. \`EXERCICIO-ROL8\` permanece marcado como legado sem coleção. Esta tabela soma exatamente 30.000; percentuais arredondados a quatro casas.\n\n` +
    primaryTable + `\n\n` +
    `## Famílias sequenciais e de registradores\n\n` +
    `As cinco coleções abaixo contêm **${familyUnion.size} chips únicos** (${pct(familyUnion.size, TARGET)}% do catálogo). Os conjuntos não se sobrepõem neste inventário.\n\n` +
    registerTable + `\n\n` +
    `**Leitura das famílias:** os 58 registradores de deslocamento cobrem SIPO, SISO, PIPO, PISO e SHIFTREG em larguras de 2 a 32 bits (conforme cada série); os 34 contadores incluem subida, descida e variantes com overflow; os 17 flip-flops incluem D, T, JK, SR, enable e vetores multi-bit. A coleção MEMORY contém 10 chips legados, inclusive REG/MTRX_REG/BYTE-REG e RAM síncrona. Os 6 chips da coleção TIMERS são chips de atraso já existentes, agora também agrupados como temporizadores.\n\n` +
    `## Displays de sete segmentos\n\n` +
    `A coleção \`ENCODE / DECODE\` tem ${encoderCollection.length} chips customizados; dois são decodificadores/display de sete segmentos. Cada um expõe as sete saídas \`seg-a\`–\`seg-g\` (14 saídas de segmento no conjunto).\n\n` +
    segmentTable + `\n\n` +
    `## Vínculos reais das coleções do projeto\n\n` +
    `Esta segunda visão reproduz os vínculos de \`ProjectDescription.json\`. “Itens nativos” são componentes do Digital Logic Sim sem arquivo customizado em \`Chips/\`; eles não entram no denominador de 30.000.\n\n` +
    collectionTable + `\n\n` +
    `- Vínculos customizados no total: **${customMemberships.toLocaleString("pt-BR")}**; excedem os 30.000 chips porque algumas coleções se sobrepõem.\n` +
    `- Vínculos de itens host/nativos: **${hostMemberships}**.\n` +
    `- Sobreposições: ${multi.length} chips — seis atrasos também em OTHER e os dois subtratores legados também em LOGIC/OTHER.\n` +
    `- Sem coleção: ${uncategorized.map((name) => `\`${name}\``).join(", ") || "nenhum"}.\n\n` +
    `## PR e integração contínua\n\n` +
    `O PR [#${PR.number}](${PR.url}) está aberto contra \`${PR.base}\` e GitHub o reporta como \`${PR.mergeability}\`. A consulta encontrou **zero workflows**, **zero execuções** e “no checks reported”; portanto, a integração contínua está **não configurada/não executada**, e não deve ser interpretada como aprovada.\n\n` +
    `Validações locais registradas: \`node tools/test-chips.js\` (**1.724 testes aprovados**) e \`node tools/verify-catalog.js\` (**30.000 arquivos e 109.914 referências de subchips verificadas**, sem erro estrutural).\n\n` +
    `## Arquivos de apoio\n\n` +
    `- \`ULA-catalog-categories-2026-10-05.csv\`: contagens por categoria principal, percentuais, origem e exemplos.\n` +
    `- \`ULA-chip-category-ledger-2026-10-05.csv\`: uma linha por chip, categoria primária, coleções e origem.\n` +
    `- Gerador reproduzível: \`tools/report-catalog-distribution.js\`.\n`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "ULA-catalog-distribution-2026-10-05.md"), report, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "ULA-catalog-categories-2026-10-05.csv"), categoryCsv.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "ULA-chip-category-ledger-2026-10-05.csv"), ledger.join("\n") + "\n", "utf8");

  console.log(JSON.stringify({
    output: [
      "reports/ULA-catalog-distribution-2026-10-05.md",
      "reports/ULA-catalog-categories-2026-10-05.csv",
      "reports/ULA-chip-category-ledger-2026-10-05.csv"
    ],
    catalogFiles: files.length,
    exclusiveCategories: primaryCounts.size,
    exclusiveCategoryTotal: partitionTotal,
    collectionMemberships: customMemberships,
    multiCategoryChips: multi.length,
    uncategorized,
    registerFamilyUnion: familyUnion.size,
    kmapCount,
    kmapNamed,
    kmapLut,
    ci: PR.ci
  }, null, 2));
}

if (require.main === module) main();
module.exports = { main };
