// simulate.js — simulador lógico dos chips. Expande recursivamente até o
// NAND primitivo e avalia. Prova que as conexões/lógica estão corretas,
// independente do Digital Logic Sim.
//
// O memo é LOCAL a cada avaliação top-level (evalChip) — cada chamada é
// isolada, sem contaminação entre testes.

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "Chips");
const jsonCache = {};
function loadChip(name) {
  if (name in jsonCache) return jsonCache[name];
  const f = path.join(DIR, name + ".json");
  jsonCache[name] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  return jsonCache[name];
}

// NAND é o único primitivo. Pinos posicionais: in 0,1 / out 2.
const NAND_REF = { InputPins: [{ ID: 0 }, { ID: 1 }], OutputPins: [{ ID: 2 }] };

// Avaliação recursiva. memo é passado adiante (local à raiz).
function evalRec(name, inv, memo, depth) {
  if (name === "NAND") return [(inv[0] && inv[1]) ? 0 : 1];
  const mk = name + "|" + inv.join("");
  if (mk in memo) return memo[mk];
  if (depth > 2000) throw new Error("recursão profunda demais: " + name);

  const chip = loadChip(name);
  if (!chip) throw new Error("chip não encontrado: " + name);

  const net = {};
  chip.InputPins.forEach((p, i) => { net[p.ID + ":0"] = inv[i] ? 1 : 0; });

  const subs = chip.SubChips.map((sc) => ({
    sc,
    ref: sc.Name === "NAND" ? NAND_REF : loadChip(sc.Name)
  }));

  for (let iter = 0; iter < 6000; iter++) {
    let changed = false;
    for (const w of chip.Wires) {
      const sk = w.SourcePinAddress.PinOwnerID + ":" + w.SourcePinAddress.PinID;
      const tk = w.TargetPinAddress.PinOwnerID + ":" + w.TargetPinAddress.PinID;
      const v = net[sk];
      if (v !== undefined && net[tk] !== v) { net[tk] = v; changed = true; }
    }
    for (const { sc, ref } of subs) {
      if (!ref) throw new Error("subchip sem definição: " + sc.Name);
      const iv = ref.InputPins.map((ip) => net[sc.ID + ":" + ip.ID] || 0);
      const ov = evalRec(sc.Name, iv, memo, depth + 1);
      ref.OutputPins.forEach((op, i) => {
        const k = sc.ID + ":" + op.ID;
        if (net[k] !== ov[i]) { net[k] = ov[i]; changed = true; }
      });
    }
    if (!changed) break;
  }

  const out = chip.OutputPins.map((p) => net[p.ID + ":0"] || 0);
  memo[mk] = out;
  return out;
}

// Avaliação top-level: memo fresco por chamada.
function evalChip(name, inv) {
  return evalRec(name, inv.map((v) => (v ? 1 : 0)), {}, 0);
}

// Avalia por nomes de pino (dict nome->valor). Não serve para chips com
// pinos de mesmo nome — nesse caso use evalChip posicional.
function run(name, inputsByName) {
  const chip = loadChip(name);
  if (!chip) throw new Error("não achei " + name);
  const inv = chip.InputPins.map((p) => (inputsByName[p.Name] ? 1 : 0));
  const ov = evalChip(name, inv);
  const res = {};
  chip.OutputPins.forEach((p, i) => { res[p.Name] = ov[i]; });
  return res;
}

module.exports = { evalChip, run, loadChip };
