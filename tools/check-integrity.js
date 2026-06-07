// check-integrity.js — varre TODOS os chips e detecta o que faz o Digital
// Logic Sim crashar ao carregar: referência a um subchip que não é builtin
// e não tem arquivo .json correspondente (referência pendurada). Também
// reporta arquivos grandes demais e JSON inválido.

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "Chips");

// Builtins do DLS que não têm arquivo .json próprio (resolvidos pelo
// simulador). Inclui portas, splits/merges (ex.: 1-8BIT, 8-1BIT), buses,
// 3-state, displays e ROM — referenciados pelos chips originais do Lucas.
const BUILTINS = new Set([
  "NAND", "AND", "OR", "NOT", "XOR", "NOR", "XNOR",
  "3-STATE BUFFER", "TRISTATE", "TRISTATE_BUFFER",
  "BUS-1", "BUS-8", "BUS-TERMINUS-1", "BUS-TERMINUS-8", "BUS", "Bus",
  "1-4BIT", "4-1BIT", "1-8BIT", "8-1BIT", "4-8BIT", "8-4BIT",
  "IN", "OUT", "KEY", "CLOCK", "Clock",
  "7SEG", "SevenSegmentDisplay", "DISPLAY", "DOT DISPLAY", "RGB DISPLAY",
  "ROM 256×16", "ROM", "ROM-256x16", "RAM", "dev-RAM-8", "EEPROM",
  "PULSE", "Button", "Toggle", "Constant", "SPLIT", "MERGE", "Label", "Note"
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — bem abaixo do limite do GitHub

function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  const have = new Set(files.map((f) => f.slice(0, -5)));

  const dangling = {};   // chip -> Set(subchip ausente)
  const tooBig = [];
  const badJson = [];

  for (const f of files) {
    const full = path.join(DIR, f);
    const size = fs.statSync(full).size;
    if (size > MAX_BYTES) tooBig.push([f, size]);

    let chip;
    try {
      chip = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      badJson.push([f, e.message]);
      continue;
    }
    const self = f.slice(0, -5);
    for (const sc of chip.SubChips || []) {
      const ref = sc.Name;
      if (BUILTINS.has(ref) || have.has(ref)) continue;
      (dangling[self] = dangling[self] || new Set()).add(ref);
    }
  }

  let problems = 0;
  if (badJson.length) {
    problems += badJson.length;
    console.log(`\nJSON INVÁLIDO (${badJson.length}):`);
    badJson.slice(0, 20).forEach(([f, m]) => console.log(`  ${f}: ${m}`));
  }
  const danglingNames = Object.keys(dangling);
  if (danglingNames.length) {
    problems += danglingNames.length;
    const missingSet = new Set();
    danglingNames.forEach((n) => dangling[n].forEach((m) => missingSet.add(m)));
    console.log(`\nREFERÊNCIAS PENDURADAS — ${danglingNames.length} chip(s) apontam para subchips inexistentes:`);
    console.log(`  subchips ausentes: ${[...missingSet].sort().join(", ")}`);
    danglingNames.slice(0, 20).forEach((n) =>
      console.log(`  ${n} -> ${[...dangling[n]].join(", ")}`));
    if (danglingNames.length > 20) console.log(`  ... e mais ${danglingNames.length - 20}`);
  }
  if (tooBig.length) {
    problems += tooBig.length;
    console.log(`\nARQUIVOS GRANDES DEMAIS (> ${(MAX_BYTES / 1048576) | 0} MB) (${tooBig.length}):`);
    tooBig.sort((a, b) => b[1] - a[1]).slice(0, 20)
      .forEach(([f, s]) => console.log(`  ${(s / 1048576).toFixed(1)} MB  ${f}`));
  }

  console.log(`\n=== INTEGRIDADE: ${files.length} chips verificados, ${problems} problema(s) ===`);
  if (problems > 0) process.exit(1);
}

if (require.main === module) main();
module.exports = { main };
