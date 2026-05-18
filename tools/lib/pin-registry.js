// pin-registry.js — IDs de pinos dos chips builtin do DLS e dos chips
// custom que já existem no UMBRA LIMA ALFA. Sem isso não dá pra wirear
// um subchip corretamente.

const { computePinIds } = require("./chip-builder");

// Cada entrada: { inputs: [PinID, ...], outputs: [PinID, ...] } na ORDEM
// em que aparecem no JSON do chip de origem.
const KNOWN = {
  // ---- Builtins do DLS (PinIDs são posicionais 0,1,2...) ----
  NAND: { inputs: [0, 1], outputs: [2], size: { x: 1.0, y: 0.5 } },

  // ---- Custom existentes (extraídos dos JSONs do UMBRA LIMA ALFA) ----
  AND:  { inputs: [1367873140, 1311157128], outputs: [2075686198], size: { x: 0.575, y: 0.5 } },
  OR:   { inputs: [1001893735, 870850316],  outputs: [461273695], size: { x: 0.425, y: 0.5 } },
  XOR:  { inputs: [1075270550, 132453205],  outputs: [1886373231], size: { x: 0.575, y: 0.5 } },
  NOT:  { inputs: [1499227601],             outputs: [528329037], size: { x: 0.575, y: 0.375 } },
  NOR:  { inputs: [1832201203, 1974460676], outputs: [1809311670], size: { x: 0.575, y: 0.5 } },

  "Half Adder": {
    inputs:  [1765576667, 1099200442],
    outputs: [294096216, 887692409],
    size: { x: 1.025, y: 0.5 }
  },
  "Full Adder": {
    inputs:  [1499378129, 2071739152, 232059689],
    outputs: [1272897961, 1034340661],
    size: { x: 1.025, y: 0.75 }
  },

  // Constante 0 — só tem output
  "0": { inputs: [], outputs: [271160628], size: { x: 0.37, y: 0.375 } },

  // Sequenciais úteis
  "SR-latch":  { inputs: [2001974634, 1555737081], outputs: [1483577062], size: { x: 1.325, y: 0.5 } },
  REG:         { inputs: [1231960322, 1379338661], outputs: [1396815956], size: { x: 0.95, y: 0.5 } },
  "D - Latch": { inputs: [686603569, 1610814893],  outputs: [1338227424], size: { x: 1.1, y: 0.5 } }
};

// Registra um chip recém-gerado para que próximos chips possam usá-lo
// como subchip. Os IDs são derivados do hash determinístico (mesmo
// algoritmo de chip-builder.addInputPin / addOutputPin).
function register(chipName, inputPinNames, outputPinNames) {
  KNOWN[chipName] = computePinIds(chipName, inputPinNames, outputPinNames);
  return KNOWN[chipName];
}

function get(chipName) {
  const r = KNOWN[chipName];
  if (!r) throw new Error(`Pin registry: chip "${chipName}" not registered`);
  return r;
}

module.exports = { KNOWN, register, get };
