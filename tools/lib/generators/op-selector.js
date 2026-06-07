// op-selector.js — família "seletor de operação" (a atividade da ULA).
//
// Dois bits de dado (A,B) e dois bits de endereço (S1,S0) escolhem qual de
// QUATRO portas lógicas de 2 entradas chega na saída. Duas arquiteturas,
// exatamente como as imagens de referência:
//
//   Circuito 1 (OP-MUX-*):  4 portas em paralelo -> entradas I0..I3 de um
//                           MUX-4; S0/S1 selecionam. (roteamento por MUX)
//   Circuito 2 (OP-DEC-*):  DECODE-2x4 gera one-hot O0..O3; cada saída de
//                           porta é mascarada (AND) com sua linha do decoder
//                           e as quatro são combinadas num OR. (sem MUX)
//
// As quatro portas são escolhidas de {AND,OR,XOR,NAND,NOR,XNOR}. Para cobrir
// "todos da família", enumeramos as 4-uplas ordenadas (a posição define qual
// porta responde a cada código de endereço) e várias larguras de dado.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf, reduce } = require("../logic");

// Letra única por porta (nomes de chip curtos e sem colisão).
//   A=AND  O=OR  X=XOR  N=NAND  R=NOR  E=XNOR
const GATES = ["A", "O", "X", "N", "R", "E"];

// Aplica a porta `kind` em (a,b) e devolve o ref de saída.
function gateApply(chip, kind, a, b) {
  switch (kind) {
    case "A": return gate2(chip, "AND", a, b);
    case "O": return gate2(chip, "OR", a, b);
    case "X": return gate2(chip, "XOR", a, b);
    case "R": return gate2(chip, "NOR", a, b);
    case "N": return gate2(chip, "NAND", a, b);          // NAND builtin
    case "E": return notOf(chip, gate2(chip, "XOR", a, b)); // XNOR = NOT(XOR)
    default: throw new Error(`gateApply: porta desconhecida "${kind}"`);
  }
}

function dataPins(chip, width) {
  const A = [], B = [];
  if (width === 1) {
    A.push(addInputPin(chip, "A", 1));
    B.push(addInputPin(chip, "B", 1));
  } else {
    for (let w = 0; w < width; w++) A.push(addInputPin(chip, `A${w}`, 1));
    for (let w = 0; w < width; w++) B.push(addInputPin(chip, `B${w}`, 1));
  }
  return { A, B };
}

function inNamesFor(width) {
  const n = [];
  if (width === 1) { n.push("A", "B"); }
  else {
    for (let w = 0; w < width; w++) n.push(`A${w}`);
    for (let w = 0; w < width; w++) n.push(`B${w}`);
  }
  n.push("S0", "S1");
  return n;
}
function outNamesFor(width) {
  return width === 1 ? ["OUT"] : Array.from({ length: width }, (_, w) => `OUT${w}`);
}
function chipName(style, tuple, width) {
  return `OP-${style}-${tuple.join("")}${width > 1 ? `-${width}b` : ""}`;
}

// Circuito 1 — seleção por MUX-4 (um MUX por bit de dado).
function buildMuxSelector(tuple, width) {
  const name = chipName("MUX", tuple, width);
  const chip = newChip(name, {
    size: { x: 2.4, y: Math.max(0.8, width * 0.5) },
    colour: palette.colourOf("OPSEL_MUX")
  });
  const { A, B } = dataPins(chip, width);
  const S0 = addInputPin(chip, "S0", 1);
  const S1 = addInputPin(chip, "S1", 1);
  const OUT = outNamesFor(width).map((nm) => addOutputPin(chip, nm, 1));

  for (let w = 0; w < width; w++) {
    const g = tuple.map((k) => gateApply(chip, k, A[w], B[w]));
    const mux = addSubChip(chip, "MUX-4", registry.KNOWN);
    for (let i = 0; i < 4; i++) wire(chip, g[i], mux.in(i));
    wire(chip, S0, mux.in(4));
    wire(chip, S1, mux.in(5));
    wire(chip, mux.out(0), OUT[w]);
  }

  validate(chip);
  registry.register(name, inNamesFor(width), outNamesFor(width));
  return { name, chip, collection: palette.collectionOf("OPSEL_MUX") };
}

// Circuito 2 — seleção por DECODE-2x4 + máscara AND + OR.
function buildDecSelector(tuple, width) {
  const name = chipName("DEC", tuple, width);
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(0.8, width * 0.5) },
    colour: palette.colourOf("OPSEL_DEC")
  });
  const { A, B } = dataPins(chip, width);
  const S0 = addInputPin(chip, "S0", 1);
  const S1 = addInputPin(chip, "S1", 1);
  const OUT = outNamesFor(width).map((nm) => addOutputPin(chip, nm, 1));

  // Um único decoder serve todos os bits (mesmo endereço para a palavra toda).
  const dec = addSubChip(chip, "DECODE-2x4", registry.KNOWN);
  wire(chip, S0, dec.in(0)); // A0 = S0 (LSB)
  wire(chip, S1, dec.in(1)); // A1 = S1

  for (let w = 0; w < width; w++) {
    const masked = tuple.map((k, i) => {
      const g = gateApply(chip, k, A[w], B[w]);
      return gate2(chip, "AND", g, dec.out(i)); // bloqueia se a linha não está ativa
    });
    wire(chip, reduce(chip, "OR", masked), OUT[w]);
  }

  validate(chip);
  registry.register(name, inNamesFor(width), outNamesFor(width));
  return { name, chip, collection: palette.collectionOf("OPSEL_DEC") };
}

// Enumera 4-uplas ORDENADAS (a posição mapeia o código de endereço) das 6
// portas, permitindo repetição — cobre "qualquer quatro portas escolhidas".
function tuples() {
  const out = [];
  for (const a of GATES) for (const b of GATES)
    for (const c of GATES) for (const d of GATES)
      out.push([a, b, c, d]);
  return out; // 6^4 = 1296
}

function generate() {
  // Registro defensivo dos subchips reutilizados (caso a ordem dos
  // geradores mude). Os IDs de pino são determinísticos e batem com os
  // JSONs já gerados de MUX-4 / DECODE-2x4.
  if (!registry.KNOWN["MUX-4"])
    registry.register("MUX-4", ["I0", "I1", "I2", "I3", "S0", "S1"], ["OUT"]);
  if (!registry.KNOWN["DECODE-2x4"])
    registry.register("DECODE-2x4", ["A0", "A1"], ["O0", "O1", "O2", "O3"]);

  const out = [];
  const WIDTHS = [1, 2, 4];
  for (const t of tuples()) {
    for (const w of WIDTHS) {
      out.push(buildMuxSelector(t, w));
      out.push(buildDecSelector(t, w));
    }
  }
  return out;
}

module.exports = { generate, buildMuxSelector, buildDecSelector, GATES };
