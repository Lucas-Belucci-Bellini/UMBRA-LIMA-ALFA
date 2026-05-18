// alu.js — Unidades Lógico-Aritméticas. ALU-N: A[N], B[N], OP[3] -> O[N].
// 8 operações selecionadas por OP: 0=AND 1=OR 2=XOR 3=NOT A 4=A+B 5=A-B
// 6=A 7=B. Calcula tudo em paralelo e seleciona por bit com um MUX-8.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");

const CAT = "ARITHMETIC";
const names = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);

function buildALU(bits) {
  const name = `ALU-${bits}`;
  const chip = newChip(name, {
    size: { x: 2.6, y: Math.max(1.0, bits * 0.5) },
    colour: palette.colourOf(CAT)
  });

  const A = names("A", bits).map((nm) => addInputPin(chip, nm, 1));
  const B = names("B", bits).map((nm) => addInputPin(chip, nm, 1));
  const OP = ["OP0", "OP1", "OP2"].map((nm) => addInputPin(chip, nm, 1));
  const O = names("O", bits).map((nm) => addOutputPin(chip, nm, 1));

  // constante 0 para Cin / Borrow IN
  const zero = addSubChip(chip, "0", registry.KNOWN).out(0);

  // bancos bitwise
  const andB = addSubChip(chip, `AND-BANK-${bits}`, registry.KNOWN);
  const orB  = addSubChip(chip, `OR-BANK-${bits}`, registry.KNOWN);
  const xorB = addSubChip(chip, `XOR-BANK-${bits}`, registry.KNOWN);
  const notB = addSubChip(chip, `NOT-BANK-${bits}`, registry.KNOWN);
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], andB.in(i));      wire(chip, B[i], andB.in(bits + i));
    wire(chip, A[i], orB.in(i));       wire(chip, B[i], orB.in(bits + i));
    wire(chip, A[i], xorB.in(i));      wire(chip, B[i], xorB.in(bits + i));
    wire(chip, A[i], notB.in(i));
  }

  // somador e subtrator
  const add = addSubChip(chip, `${bits}-bit Ripple Adder`, registry.KNOWN);
  const sub = addSubChip(chip, `${bits}-bit Subtractor`, registry.KNOWN);
  for (let i = 0; i < bits; i++) {
    wire(chip, A[i], add.in(i));       wire(chip, B[i], add.in(bits + i));
    wire(chip, A[i], sub.in(i));       wire(chip, B[i], sub.in(bits + i));
  }
  wire(chip, zero, add.in(2 * bits));  // Cin = 0
  wire(chip, zero, sub.in(2 * bits));  // Borrow IN = 0

  // por bit: MUX-8 seleciona a operação
  for (let i = 0; i < bits; i++) {
    const mux = addSubChip(chip, "MUX-8", registry.KNOWN);
    wire(chip, andB.out(i), mux.in(0));
    wire(chip, orB.out(i),  mux.in(1));
    wire(chip, xorB.out(i), mux.in(2));
    wire(chip, notB.out(i), mux.in(3));
    wire(chip, add.out(i),  mux.in(4));
    wire(chip, sub.out(i),  mux.in(5));
    wire(chip, A[i],        mux.in(6));
    wire(chip, B[i],        mux.in(7));
    wire(chip, OP[0], mux.in(8));
    wire(chip, OP[1], mux.in(9));
    wire(chip, OP[2], mux.in(10));
    wire(chip, mux.out(0), O[i]);
  }

  validate(chip);
  registry.register(name,
    [...names("A", bits), ...names("B", bits), "OP0", "OP1", "OP2"],
    names("O", bits));
  return { name, chip, collection: palette.collectionOf(CAT) };
}

function generate() {
  return [4, 8, 16].map(buildALU);
}

module.exports = { generate };
