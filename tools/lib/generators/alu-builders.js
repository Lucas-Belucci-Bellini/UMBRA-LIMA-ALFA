// alu-builders.js — peças que faltavam para montar uma ULA:
//
//   IS-ZERO-N    A1..AN -> Z          (Z = 1 se a palavra é zero)
//   SIGN-N       A1..AN -> S          (S = bit mais significativo)
//   ADDSUB-N     A,B,SUB -> S,Cout    (S = A + B se SUB=0, A - B se SUB=1)
//   OVF-ADD-N    A,B     -> S,V       (overflow signed de A+B)
//   OVF-SUB-N    A,B     -> D,V       (overflow signed de A-B)
//   ULA-LOGIC-N  A,B,F0,F1 -> O       (F1F0: 00 AND, 01 OR, 10 XOR, 11 NOT A)
//   ULA-ARITH-N  A,B,F0,F1 -> O,Cout  (F1F0: 00 A+B, 01 A-B, 10 A+1, 11 A-1)
//   ULA-LA-N     A,B,F0,F1,F2 -> O,Z,S,Cout
//                (F2=0: ULA-LOGIC; F2=1: ULA-ARITH. Flags Z e S sobre O.)
//
// Reaproveita os chips já gerados: AND/OR/XOR/NOT-BANK-N, MUX-2, MUX-4,
// N-bit Ripple Adder, N-bit Subtractor. Tudo via subchip.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, reduce, notOf } = require("../logic");

const a1 = (n) => Array.from({ length: n }, (_, i) => `A${i + 1}`);
const b1 = (n) => Array.from({ length: n }, (_, i) => `B${i + 1}`);
const o1 = (n) => Array.from({ length: n }, (_, i) => `O${i + 1}`);
const s1 = (n) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
const d1 = (n) => Array.from({ length: n }, (_, i) => `D${i + 1}`);

// Garante que os pin IDs determinísticos dos subchips reusados estão
// registrados, mesmo que este gerador rode antes dos outros.
function ensureSubchips(bits) {
  const reg = (name, ins, outs) => {
    if (!registry.KNOWN[name]) registry.register(name, ins, outs);
  };
  reg("MUX-2", ["I0", "I1", "S0"], ["OUT"]);
  reg("MUX-4", ["I0", "I1", "I2", "I3", "S0", "S1"], ["OUT"]);
  for (const g of ["AND", "OR", "XOR", "NOR", "XNOR", "NAND"]) {
    reg(`${g}-BANK-${bits}`, [...a1(bits), ...b1(bits)], o1(bits));
  }
  reg(`NOT-BANK-${bits}`, a1(bits), o1(bits));
  reg(`${bits}-bit Ripple Adder`,
    [...a1(bits), ...b1(bits), "Cin"], [...s1(bits), "Cout"]);
  reg(`${bits}-bit Subtractor`,
    [...a1(bits), ...b1(bits), "Borrow IN"], [...d1(bits), "Borrow OUT"]);
}

// IS-ZERO-N: Z = NOR de todos os bits.
function buildIsZero(n) {
  const name = `IS-ZERO-${n}`;
  const chip = newChip(name, {
    size: { x: 1.2, y: Math.max(0.6, n * 0.3) },
    colour: palette.colourOf("ALU_UTILS")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const Z = addOutputPin(chip, "Z", 1);
  wire(chip, notOf(chip, reduce(chip, "OR", A, 2), 5), Z);
  validate(chip);
  registry.register(name, a1(n), ["Z"]);
  return { name, chip, collection: palette.collectionOf("ALU_UTILS") };
}

// SIGN-N: S = bit mais significativo (interpretação de complemento de 2).
function buildSign(n) {
  const name = `SIGN-${n}`;
  const chip = newChip(name, {
    size: { x: 1.0, y: Math.max(0.6, n * 0.3) },
    colour: palette.colourOf("ALU_UTILS")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const S = addOutputPin(chip, "S", 1);
  wire(chip, A[n - 1], S);
  validate(chip);
  registry.register(name, a1(n), ["S"]);
  return { name, chip, collection: palette.collectionOf("ALU_UTILS") };
}

// ADDSUB-N: S = A + (B XOR SUB) + SUB.  SUB=0 -> soma; SUB=1 -> subtração
// em complemento de 2. Cout é o carry-out da soma.
function buildAddSub(n) {
  ensureSubchips(n);
  const name = `ADDSUB-${n}`;
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(0.8, n * 0.45) },
    colour: palette.colourOf("ALU_UTILS")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(n).map((nm) => addInputPin(chip, nm, 1));
  const SUB = addInputPin(chip, "SUB", 1);
  const S = s1(n).map((nm) => addOutputPin(chip, nm, 1));
  const Cout = addOutputPin(chip, "Cout", 1);

  // XOR cada bit de B com SUB usando portas XOR individuais.
  const Bx = B.map((b) => gate2(chip, "XOR", b, SUB));
  const add = addSubChip(chip, `${n}-bit Ripple Adder`, registry.KNOWN);
  for (let i = 0; i < n; i++) wire(chip, A[i], add.in(i));
  for (let i = 0; i < n; i++) wire(chip, Bx[i], add.in(n + i));
  wire(chip, SUB, add.in(2 * n)); // Cin = SUB
  for (let i = 0; i < n; i++) wire(chip, add.out(i), S[i]);
  wire(chip, add.out(n), Cout);

  validate(chip);
  registry.register(name, [...a1(n), ...b1(n), "SUB"], [...s1(n), "Cout"]);
  return { name, chip, collection: palette.collectionOf("ALU_UTILS") };
}

// OVF-ADD-N: V = (Amsb XNOR Bmsb) AND (Amsb XOR Smsb). Soma signed estoura
// quando os operandos têm o mesmo sinal e o resultado troca de sinal.
function buildOvfAdd(n) {
  ensureSubchips(n);
  const name = `OVF-ADD-${n}`;
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(0.8, n * 0.45) },
    colour: palette.colourOf("ALU_UTILS")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(n).map((nm) => addInputPin(chip, nm, 1));
  const S = s1(n).map((nm) => addOutputPin(chip, nm, 1));
  const V = addOutputPin(chip, "V", 1);

  const add = addSubChip(chip, `${n}-bit Ripple Adder`, registry.KNOWN);
  for (let i = 0; i < n; i++) wire(chip, A[i], add.in(i));
  for (let i = 0; i < n; i++) wire(chip, B[i], add.in(n + i));
  const zero = addSubChip(chip, "0", registry.KNOWN);
  wire(chip, zero.out(0), add.in(2 * n));
  for (let i = 0; i < n; i++) wire(chip, add.out(i), S[i]);

  const sameSign = notOf(chip, gate2(chip, "XOR", A[n - 1], B[n - 1]));
  const flipped = gate2(chip, "XOR", A[n - 1], add.out(n - 1));
  wire(chip, gate2(chip, "AND", sameSign, flipped), V);

  validate(chip);
  registry.register(name, [...a1(n), ...b1(n)], [...s1(n), "V"]);
  return { name, chip, collection: palette.collectionOf("ALU_UTILS") };
}

// OVF-SUB-N: V = (Amsb XOR Bmsb) AND (Amsb XOR Dmsb). Subtração signed
// estoura quando os operandos têm sinais opostos e o resultado fica com
// sinal diferente de A.
function buildOvfSub(n) {
  ensureSubchips(n);
  const name = `OVF-SUB-${n}`;
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(0.8, n * 0.45) },
    colour: palette.colourOf("ALU_UTILS")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(n).map((nm) => addInputPin(chip, nm, 1));
  const D = d1(n).map((nm) => addOutputPin(chip, nm, 1));
  const V = addOutputPin(chip, "V", 1);

  const sub = addSubChip(chip, `${n}-bit Subtractor`, registry.KNOWN);
  for (let i = 0; i < n; i++) wire(chip, A[i], sub.in(i));
  for (let i = 0; i < n; i++) wire(chip, B[i], sub.in(n + i));
  const zero = addSubChip(chip, "0", registry.KNOWN);
  wire(chip, zero.out(0), sub.in(2 * n));
  for (let i = 0; i < n; i++) wire(chip, sub.out(i), D[i]);

  const diffSign = gate2(chip, "XOR", A[n - 1], B[n - 1]);
  const flipped = gate2(chip, "XOR", A[n - 1], sub.out(n - 1));
  wire(chip, gate2(chip, "AND", diffSign, flipped), V);

  validate(chip);
  registry.register(name, [...a1(n), ...b1(n)], [...d1(n), "V"]);
  return { name, chip, collection: palette.collectionOf("ALU_UTILS") };
}

// ULA-LOGIC-N: 4 bancos de portas em paralelo selecionados bit a bit por MUX-4.
// F1F0: 00 AND(A,B)  01 OR(A,B)  10 XOR(A,B)  11 NOT(A)
function buildUlaLogic(n) {
  ensureSubchips(n);
  const name = `ULA-LOGIC-${n}`;
  const chip = newChip(name, {
    size: { x: 3.0, y: Math.max(0.8, n * 0.5) },
    colour: palette.colourOf("ALU")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(n).map((nm) => addInputPin(chip, nm, 1));
  const F0 = addInputPin(chip, "F0", 1);
  const F1 = addInputPin(chip, "F1", 1);
  const O = o1(n).map((nm) => addOutputPin(chip, nm, 1));

  const andB = addSubChip(chip, `AND-BANK-${n}`, registry.KNOWN);
  const orB  = addSubChip(chip, `OR-BANK-${n}`,  registry.KNOWN);
  const xorB = addSubChip(chip, `XOR-BANK-${n}`, registry.KNOWN);
  const notB = addSubChip(chip, `NOT-BANK-${n}`, registry.KNOWN);
  for (let i = 0; i < n; i++) {
    wire(chip, A[i], andB.in(i));     wire(chip, B[i], andB.in(n + i));
    wire(chip, A[i], orB.in(i));      wire(chip, B[i], orB.in(n + i));
    wire(chip, A[i], xorB.in(i));     wire(chip, B[i], xorB.in(n + i));
    wire(chip, A[i], notB.in(i));
  }
  for (let i = 0; i < n; i++) {
    const mux = addSubChip(chip, "MUX-4", registry.KNOWN);
    wire(chip, andB.out(i), mux.in(0));
    wire(chip, orB.out(i),  mux.in(1));
    wire(chip, xorB.out(i), mux.in(2));
    wire(chip, notB.out(i), mux.in(3));
    wire(chip, F0, mux.in(4));
    wire(chip, F1, mux.in(5));
    wire(chip, mux.out(0), O[i]);
  }

  validate(chip);
  registry.register(name, [...a1(n), ...b1(n), "F0", "F1"], o1(n));
  return { name, chip, collection: palette.collectionOf("ALU") };
}

// ULA-ARITH-N: ADD, SUB, INC(A+1), DEC(A-1). Cada operação calcula em
// paralelo; MUX-4 por bit seleciona. Cout é amarrado ao Cout da operação
// selecionada via outro MUX-4 (com 0 quando irrelevante).
function buildUlaArith(n) {
  ensureSubchips(n);
  const name = `ULA-ARITH-${n}`;
  const chip = newChip(name, {
    size: { x: 3.4, y: Math.max(0.8, n * 0.55) },
    colour: palette.colourOf("ALU")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(n).map((nm) => addInputPin(chip, nm, 1));
  const F0 = addInputPin(chip, "F0", 1);
  const F1 = addInputPin(chip, "F1", 1);
  const O = o1(n).map((nm) => addOutputPin(chip, nm, 1));
  const Cout = addOutputPin(chip, "Cout", 1);

  const zero = addSubChip(chip, "0", registry.KNOWN);
  const Z = zero.out(0);

  // ADD: A + B + 0
  const addAB = addSubChip(chip, `${n}-bit Ripple Adder`, registry.KNOWN);
  for (let i = 0; i < n; i++) { wire(chip, A[i], addAB.in(i)); wire(chip, B[i], addAB.in(n + i)); }
  wire(chip, Z, addAB.in(2 * n));
  // SUB: A - B
  const subAB = addSubChip(chip, `${n}-bit Subtractor`, registry.KNOWN);
  for (let i = 0; i < n; i++) { wire(chip, A[i], subAB.in(i)); wire(chip, B[i], subAB.in(n + i)); }
  wire(chip, Z, subAB.in(2 * n));
  // INC: A + 0 + Cin=1
  const incA = addSubChip(chip, `${n}-bit Ripple Adder`, registry.KNOWN);
  for (let i = 0; i < n; i++) { wire(chip, A[i], incA.in(i)); wire(chip, Z, incA.in(n + i)); }
  const one = notOf(chip, Z);
  wire(chip, one, incA.in(2 * n));
  // DEC: A - 0 - Bin=1
  const decA = addSubChip(chip, `${n}-bit Subtractor`, registry.KNOWN);
  for (let i = 0; i < n; i++) { wire(chip, A[i], decA.in(i)); wire(chip, Z, decA.in(n + i)); }
  wire(chip, one, decA.in(2 * n));

  for (let i = 0; i < n; i++) {
    const mux = addSubChip(chip, "MUX-4", registry.KNOWN);
    wire(chip, addAB.out(i), mux.in(0));
    wire(chip, subAB.out(i), mux.in(1));
    wire(chip, incA.out(i),  mux.in(2));
    wire(chip, decA.out(i),  mux.in(3));
    wire(chip, F0, mux.in(4));
    wire(chip, F1, mux.in(5));
    wire(chip, mux.out(0), O[i]);
  }
  // Cout: ADD -> Cout do somador; SUB -> Borrow do subtrator; INC -> Cout;
  // DEC -> Borrow.
  const muxC = addSubChip(chip, "MUX-4", registry.KNOWN);
  wire(chip, addAB.out(n), muxC.in(0));
  wire(chip, subAB.out(n), muxC.in(1));
  wire(chip, incA.out(n),  muxC.in(2));
  wire(chip, decA.out(n),  muxC.in(3));
  wire(chip, F0, muxC.in(4));
  wire(chip, F1, muxC.in(5));
  wire(chip, muxC.out(0), Cout);

  validate(chip);
  registry.register(name, [...a1(n), ...b1(n), "F0", "F1"], [...o1(n), "Cout"]);
  return { name, chip, collection: palette.collectionOf("ALU") };
}

// ULA-LA-N: ULA completa "do livro": F2 escolhe lógica/aritmética, F1F0
// escolhe a operação, e expõe as flags Z e S sobre o resultado.
function buildUlaLA(n) {
  ensureSubchips(n);
  // ULA-LOGIC-N e ULA-ARITH-N têm que estar registrados.
  if (!registry.KNOWN[`ULA-LOGIC-${n}`])
    registry.register(`ULA-LOGIC-${n}`, [...a1(n), ...b1(n), "F0", "F1"], o1(n));
  if (!registry.KNOWN[`ULA-ARITH-${n}`])
    registry.register(`ULA-ARITH-${n}`,
      [...a1(n), ...b1(n), "F0", "F1"], [...o1(n), "Cout"]);

  const name = `ULA-LA-${n}`;
  const chip = newChip(name, {
    size: { x: 3.6, y: Math.max(0.8, n * 0.6) },
    colour: palette.colourOf("ALU")
  });
  const A = a1(n).map((nm) => addInputPin(chip, nm, 1));
  const B = b1(n).map((nm) => addInputPin(chip, nm, 1));
  const F0 = addInputPin(chip, "F0", 1);
  const F1 = addInputPin(chip, "F1", 1);
  const F2 = addInputPin(chip, "F2", 1);
  const O = o1(n).map((nm) => addOutputPin(chip, nm, 1));
  const Z = addOutputPin(chip, "Z", 1);
  const Sf = addOutputPin(chip, "S", 1);
  const Cout = addOutputPin(chip, "Cout", 1);

  const ulog = addSubChip(chip, `ULA-LOGIC-${n}`, registry.KNOWN);
  const uar  = addSubChip(chip, `ULA-ARITH-${n}`, registry.KNOWN);
  for (let i = 0; i < n; i++) {
    wire(chip, A[i], ulog.in(i));        wire(chip, B[i], ulog.in(n + i));
    wire(chip, A[i], uar.in(i));         wire(chip, B[i], uar.in(n + i));
  }
  wire(chip, F0, ulog.in(2 * n));        wire(chip, F1, ulog.in(2 * n + 1));
  wire(chip, F0, uar.in(2 * n));         wire(chip, F1, uar.in(2 * n + 1));

  // MUX-2 por bit: F2=0 escolhe lógica, F2=1 escolhe aritmética.
  const outRefs = [];
  for (let i = 0; i < n; i++) {
    const mux = addSubChip(chip, "MUX-2", registry.KNOWN);
    wire(chip, ulog.out(i), mux.in(0));
    wire(chip, uar.out(i),  mux.in(1));
    wire(chip, F2, mux.in(2));
    wire(chip, mux.out(0), O[i]);
    outRefs.push(mux.out(0));
  }

  // Z: 1 se O = 0. NOR de todos os bits de saída (inline, sem depender de
  // outro chip IS-ZERO cujos pinos podem divergir).
  wire(chip, notOf(chip, reduce(chip, "OR", outRefs, 2), 5), Z);

  // S: bit alto da saída.
  wire(chip, outRefs[n - 1], Sf);

  // Cout só faz sentido em aritmética; quando F2=0 forçamos 0.
  const muxC = addSubChip(chip, "MUX-2", registry.KNOWN);
  const zeroC = addSubChip(chip, "0", registry.KNOWN);
  wire(chip, zeroC.out(0), muxC.in(0));
  wire(chip, uar.out(n),   muxC.in(1));
  wire(chip, F2, muxC.in(2));
  wire(chip, muxC.out(0), Cout);

  validate(chip);
  registry.register(name,
    [...a1(n), ...b1(n), "F0", "F1", "F2"],
    [...o1(n), "Z", "S", "Cout"]);
  return { name, chip, collection: palette.collectionOf("ALU") };
}

function generate() {
  const out = [];
  // Utilidades — largo espectro: 2..32.
  const UTILS_WIDTHS = Array.from({ length: 31 }, (_, i) => i + 2);
  for (const n of UTILS_WIDTHS) out.push(buildIsZero(n));
  for (const n of UTILS_WIDTHS) out.push(buildSign(n));
  for (const n of UTILS_WIDTHS) out.push(buildAddSub(n));
  for (const n of UTILS_WIDTHS) out.push(buildOvfAdd(n));
  for (const n of UTILS_WIDTHS) out.push(buildOvfSub(n));

  // ULA: peças e versões completas — 2..16 (tamanhos didáticos).
  const ALU_WIDTHS = Array.from({ length: 15 }, (_, i) => i + 2);
  for (const n of ALU_WIDTHS) out.push(buildUlaLogic(n));
  for (const n of ALU_WIDTHS) out.push(buildUlaArith(n));
  for (const n of ALU_WIDTHS) out.push(buildUlaLA(n));

  return out;
}

module.exports = {
  generate, buildIsZero, buildSign, buildAddSub, buildOvfAdd, buildOvfSub,
  buildUlaLogic, buildUlaArith, buildUlaLA
};
