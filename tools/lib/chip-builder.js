// chip-builder.js — helpers para gerar JSONs de chips do Digital Logic Sim.
// Sem dependências externas. JS puro.

const DEFAULT_DLS_VERSION = "2.1.6";

// Hash determinístico 32-bit (mistura FNV+xorshift). Dado o mesmo input,
// sempre retorna o mesmo inteiro positivo > 0.
function hash32(str) {
  let h = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = h & 0x7fffffff;
  return h === 0 ? 1 : h;
}

function newChip(name, opts = {}) {
  return {
    DLSVersion: opts.dlsVersion || DEFAULT_DLS_VERSION,
    Name: name,
    NameLocation: 0,
    ChipType: 0,
    Size: opts.size || { x: 1.0, y: 0.5 },
    Colour: opts.colour || { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
    InputPins: [],
    OutputPins: [],
    SubChips: [],
    Wires: [],
    Displays: []
  };
}

function addInputPin(chip, name, bitCount = 1, position = null) {
  const slot = chip.InputPins.length;
  const id = hash32(`${chip.Name}|in|${name}|${slot}`);
  const pos = position || { x: -10, y: -slot * 0.5 };
  chip.InputPins.push({
    Name: name,
    ID: id,
    Position: pos,
    BitCount: bitCount,
    Colour: 0,
    ValueDisplayMode: 0
  });
  return { kind: "pin", side: "in", id };
}

function addOutputPin(chip, name, bitCount = 1, position = null) {
  const slot = chip.OutputPins.length;
  const id = hash32(`${chip.Name}|out|${name}|${slot}`);
  const pos = position || { x: 6, y: -slot * 0.5 };
  chip.OutputPins.push({
    Name: name,
    ID: id,
    Position: pos,
    BitCount: bitCount,
    Colour: 0,
    ValueDisplayMode: 0
  });
  return { kind: "pin", side: "out", id };
}

// registry: { inputs: [pinId, ...], outputs: [pinId, ...] } do chip referenciado.
function addSubChip(chip, refName, registry, opts = {}) {
  const refInfo = registry[refName];
  if (!refInfo) {
    throw new Error(`Unknown chip reference "${refName}". Register it first.`);
  }
  const slot = chip.SubChips.length;
  const id = hash32(`${chip.Name}|sub|${refName}|${slot}`);
  const position = opts.position || { x: 0, y: -slot * 0.5 };
  const outColourInfo = refInfo.outputs.map((pid) => ({ PinColour: 0, PinID: pid }));

  chip.SubChips.push({
    Name: refName,
    ID: id,
    Label: opts.label || "",
    Position: position,
    OutputPinColourInfo: outColourInfo,
    InternalData: opts.internalData === undefined ? null : opts.internalData
  });

  return {
    kind: "sub",
    id,
    refName,
    in: (i) => {
      if (i < 0 || i >= refInfo.inputs.length) {
        throw new Error(`${refName}: no input index ${i} (has ${refInfo.inputs.length})`);
      }
      return { kind: "sub-pin", pinId: refInfo.inputs[i], ownerId: id };
    },
    out: (i) => {
      if (i < 0 || i >= refInfo.outputs.length) {
        throw new Error(`${refName}: no output index ${i} (has ${refInfo.outputs.length})`);
      }
      return { kind: "sub-pin", pinId: refInfo.outputs[i], ownerId: id };
    }
  };
}

function pinAddress(ref) {
  if (ref.kind === "pin") {
    return { PinID: 0, PinOwnerID: ref.id };
  }
  if (ref.kind === "sub-pin") {
    return { PinID: ref.pinId, PinOwnerID: ref.ownerId };
  }
  throw new Error(`Bad pin ref: ${JSON.stringify(ref)}`);
}

// Cria um wire simples (ConnectionType 0) — uma ligação direta pino-fonte
// -> pino-destino. Um pino-fonte pode ter vários wires saindo dele (fan-out);
// cada um é um wire independente type-0, que é o que o DLS aceita.
function wire(chip, from, to, points = null) {
  chip.Wires.push({
    SourcePinAddress: pinAddress(from),
    TargetPinAddress: pinAddress(to),
    ConnectionType: 0,
    ConnectedWireIndex: -1,
    ConnectedWireSegmentIndex: -1,
    Points: points || [{ x: 0.0, y: 0.0 }, { x: 0.0, y: 0.0 }]
  });
  return chip.Wires.length - 1;
}

function wireBranch(chip, fromWireIdx, segmentIdx, to, points = null) {
  const from = chip.Wires[fromWireIdx];
  if (!from) throw new Error(`No wire at index ${fromWireIdx}`);
  chip.Wires.push({
    SourcePinAddress: from.SourcePinAddress,
    TargetPinAddress: pinAddress(to),
    ConnectionType: 1,
    ConnectedWireIndex: fromWireIdx,
    ConnectedWireSegmentIndex: segmentIdx,
    Points: points || [{ x: 0.0, y: 0.0 }, { x: 0.0, y: 0.0 }]
  });
  return chip.Wires.length - 1;
}

// Valida que todos os wires apontam para pinos/subchips que existem no chip.
function validate(chip) {
  const externalPinIds = new Set([
    ...chip.InputPins.map((p) => p.ID),
    ...chip.OutputPins.map((p) => p.ID)
  ]);
  const subChipIds = new Set(chip.SubChips.map((s) => s.ID));
  const allOwners = new Set([...externalPinIds, ...subChipIds]);

  for (let i = 0; i < chip.Wires.length; i++) {
    const w = chip.Wires[i];
    if (!allOwners.has(w.SourcePinAddress.PinOwnerID)) {
      throw new Error(`${chip.Name}: wire #${i} src owner ${w.SourcePinAddress.PinOwnerID} not found`);
    }
    if (!allOwners.has(w.TargetPinAddress.PinOwnerID)) {
      throw new Error(`${chip.Name}: wire #${i} tgt owner ${w.TargetPinAddress.PinOwnerID} not found`);
    }
  }

  const idSet = new Set();
  for (const p of [...chip.InputPins, ...chip.OutputPins]) {
    if (idSet.has(p.ID)) throw new Error(`${chip.Name}: duplicate pin ID ${p.ID}`);
    idSet.add(p.ID);
  }
  for (const s of chip.SubChips) {
    if (idSet.has(s.ID)) throw new Error(`${chip.Name}: duplicate subchip ID ${s.ID}`);
    idSet.add(s.ID);
  }

  return true;
}

// finalize: roda o layout em camadas e o roteamento ortogonal dos fios.
// Sobrescreve TODAS as posições de pino/subchip e os Points dos wires —
// os geradores só precisam declarar o grafo lógico.
function finalize(chip) {
  const { layout, makePinResolver } = require("./layout");
  const { route } = require("./router");
  const pos = layout(chip);
  const pinXY = makePinResolver(chip, pos);
  route(chip, pinXY);
  return chip;
}

function serialize(chip) {
  return JSON.stringify(chip, null, 2);
}

// Computa pin IDs determinísticos para um chip recém-criado, expondo-os
// para que outros chips possam referenciá-lo via pin-registry.
function computePinIds(chipName, inputPinNames, outputPinNames) {
  return {
    inputs: inputPinNames.map((n, i) => hash32(`${chipName}|in|${n}|${i}`)),
    outputs: outputPinNames.map((n, i) => hash32(`${chipName}|out|${n}|${i}`))
  };
}

module.exports = {
  hash32,
  newChip,
  addInputPin,
  addOutputPin,
  addSubChip,
  wire,
  wireBranch,
  validate,
  finalize,
  serialize,
  computePinIds
};
