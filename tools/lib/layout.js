// layout.js — layout COMPACTO em camadas para os chips gerados.
// Objetivo: chip pequeno, sem precisar rolar a tela. Subchips em colunas
// por estágio de dataflow; pinos de entrada perto de quem consome eles;
// pinos de saída logo depois da fonte. Espaçamento apertado.

const registry = require("./pin-registry");

const COL = 2.0;          // espaçamento horizontal entre camadas
const PIN_SPACING = 0.5; // espaçamento dos pinos DENTRO de um subchip

function layout(chip) {
  const inPins = chip.InputPins;
  const outPins = chip.OutputPins;
  const subs = chip.SubChips;

  const isInput = {}, isOutput = {}, isSub = {};
  inPins.forEach((p) => { isInput[p.ID] = true; });
  outPins.forEach((p) => { isOutput[p.ID] = true; });
  
  const subByID = {};
  subs.forEach((s) => { isSub[s.ID] = true; subByID[s.ID] = s; });

  // --- camadas dos subchips: caminho mais longo, entradas = 0 ---
  const subLayer = {};
  const passes = subs.length + 3;
  for (let iter = 0; iter < passes; iter++) {
    let changed = false;
    for (const w of chip.Wires) {
      const s = w.SourcePinAddress.PinOwnerID;
      const t = w.TargetPinAddress.PinOwnerID;
      if (!isSub[t]) continue;
      let sl;
      if (isInput[s]) sl = 0;
      else if (isSub[s]) sl = subLayer[s];
      else continue;
      if (sl === undefined) continue;
      const cand = sl + 1;
      if (subLayer[t] === undefined || cand > subLayer[t]) {
        subLayer[t] = cand;
        changed = true;
      }
    }
    if (!changed) break;
  }
  subs.forEach((s) => { if (subLayer[s.ID] === undefined) subLayer[s.ID] = 1; });

  // --- input pins: na coluna logo antes do primeiro subchip que consomem ---
  const inLayer = {};
  for (const p of inPins) {
    let minC = Infinity;
    for (const w of chip.Wires) {
      if (w.SourcePinAddress.PinOwnerID !== p.ID) continue;
      const t = w.TargetPinAddress.PinOwnerID;
      if (isSub[t] && subLayer[t] !== undefined) minC = Math.min(minC, subLayer[t]);
    }
    inLayer[p.ID] = (minC === Infinity) ? 0 : Math.max(0, minC - 1);
  }

  // --- output pins: na coluna logo depois da fonte ---
  const outLayerMap = {};
  for (const p of outPins) {
    let maxS = 0;
    for (const w of chip.Wires) {
      if (w.TargetPinAddress.PinOwnerID !== p.ID) continue;
      const s = w.SourcePinAddress.PinOwnerID;
      let sl = 0;
      if (isInput[s]) sl = inLayer[s];
      else if (isSub[s]) sl = subLayer[s];
      if (sl !== undefined) maxS = Math.max(maxS, sl);
    }
    outLayerMap[p.ID] = maxS + 1;
  }

  // mapa de camada unificado
  const layer = {};
  inPins.forEach((p) => { layer[p.ID] = inLayer[p.ID]; });
  subs.forEach((s) => { layer[s.ID] = subLayer[s.ID]; });
  outPins.forEach((p) => { layer[p.ID] = outLayerMap[p.ID]; });

  // agrupa por camada
  const byLayer = {};
  const push = (id) => { const L = layer[id]; (byLayer[L] = byLayer[L] || []).push(id); };
  inPins.forEach((p) => push(p.ID));
  subs.forEach((s) => push(s.ID));
  outPins.forEach((p) => push(p.ID));

  const pos = {};
  const layerNums = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
  for (const L of layerNums) {
    const nodes = byLayer[L];
    if (nodes.length > 1) {
      // ordena por baricentro dos vizinhos já posicionados (reduz cruzamentos)
      const bary = {};
      for (const id of nodes) {
        let sum = 0, cnt = 0;
        for (const w of chip.Wires) {
          let other = null;
          if (w.TargetPinAddress.PinOwnerID === id) other = w.SourcePinAddress.PinOwnerID;
          else if (w.SourcePinAddress.PinOwnerID === id) other = w.TargetPinAddress.PinOwnerID;
          if (other !== null && pos[other]) { sum += pos[other].y; cnt++; }
        }
        bary[id] = cnt ? sum / cnt : 0;
      }
      nodes.sort((a, b) => bary[b] - bary[a]);
    }
    
    const heights = nodes.map(id => {
      if (isInput[id] || isOutput[id]) return 0.5;
      const sub = subByID[id];
      if (sub && registry.KNOWN[sub.Name] && registry.KNOWN[sub.Name].size) {
        return registry.KNOWN[sub.Name].size.y + 0.2; // small padding
      }
      return 0.8;
    });
    
    const totalH = heights.reduce((a,b) => a+b, 0);
    let yStart = totalH / 2;
    
    nodes.forEach((id, i) => {
      const h = heights[i];
      yStart -= h / 2;
      pos[id] = { x: L * COL, y: yStart };
      yStart -= h / 2;
    });
  }

  inPins.forEach((p) => { p.Position = pos[p.ID]; });
  outPins.forEach((p) => { p.Position = pos[p.ID]; });
  subs.forEach((s) => { s.Position = pos[s.ID]; });
  return pos;
}

// Resolvedor de coordenada de pino, para o roteador.
function makePinResolver(chip, pos) {
  const inSet = new Set(chip.InputPins.map((p) => p.ID));
  const outSet = new Set(chip.OutputPins.map((p) => p.ID));
  const subByID = {};
  for (const s of chip.SubChips) subByID[s.ID] = s;

  return function pinXY(addr, isSource) {
    const owner = addr.PinOwnerID;
    if (inSet.has(owner) || outSet.has(owner)) return pos[owner];
    const sub = subByID[owner];
    if (!sub) throw new Error(`layout: owner ${owner} não encontrado`);
    const info = registry.KNOWN[sub.Name];
    if (!info) throw new Error(`layout: chip "${sub.Name}" sem registro`);
    
    const subHalfW = (info.size && info.size.x) ? (info.size.x / 2.0) : 1.0;
    
    const base = pos[owner];
    if (isSource) {
      const j = info.outputs.indexOf(addr.PinID);
      const n = info.outputs.length;
      const k = j < 0 ? 0 : j;
      return { x: base.x + subHalfW, y: base.y + ((n - 1) / 2 - k) * PIN_SPACING };
    }
    const i = info.inputs.indexOf(addr.PinID);
    const n = info.inputs.length;
    const k = i < 0 ? 0 : i;
    return { x: base.x - subHalfW, y: base.y + ((n - 1) / 2 - k) * PIN_SPACING };
  };
}

module.exports = { layout, makePinResolver, COL };

