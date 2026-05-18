// test-chips.js — verifica a LÓGICA dos chips gerados rodando tabelas-verdade
// no simulador (que expande tudo até NAND). Prova que as conexões estão certas.

const { evalChip, loadChip } = require("./simulate");

let pass = 0, fail = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else { fail++; fails.push(label); }
}

// avalia posicionalmente (array na ordem das InputPins)
function ev(name, inv) { return evalChip(name, inv, 0); }

// monta array de entrada por nome de pino
function inArr(name, vals) {
  return loadChip(name).InputPins.map((p) => (vals[p.Name] ? 1 : 0));
}
function outObj(name, ov) {
  const r = {};
  loadChip(name).OutputPins.forEach((p, i) => { r[p.Name] = ov[i]; });
  return r;
}
function setBits(o, prefix, n, val, base) {
  base = (base === undefined) ? 1 : base;
  for (let i = 0; i < n; i++) o[prefix + (i + base)] = (val >> i) & 1;
}
function getBits(o, prefix, n, base) {
  base = (base === undefined) ? 1 : base;
  let v = 0;
  for (let i = 0; i < n; i++) v |= (o[prefix + (i + base)] ? 1 : 0) << i;
  return v;
}

console.log("=== TESTE DE LÓGICA DOS CHIPS ===\n");

// ---- Half Subtractor ----
for (let A = 0; A < 2; A++) for (let B = 0; B < 2; B++) {
  const r = outObj("Half Subtractor", ev("Half Subtractor", inArr("Half Subtractor", { A, B })));
  check(`HalfSub A=${A} B=${B}`, r.Diff === (A ^ B) && r.Borrow === ((A ? 0 : 1) & B));
}

// ---- Full Subtractor ----
for (let Bin = 0; Bin < 2; Bin++) for (let A = 0; A < 2; A++) for (let B = 0; B < 2; B++) {
  const r = outObj("Full Subtractor", ev("Full Subtractor", inArr("Full Subtractor", { Bin, A, B })));
  const full = A - B - Bin;
  check(`FullSub ${A}-${B}-${Bin}`, r.Diff === ((full % 2 + 2) % 2) && r.Bout === (full < 0 ? 1 : 0));
}

// ---- N-bit Subtractor (2,4) exaustivo; 8 amostrado ----
function testSub(bits, samples) {
  const name = `${bits}-bit Subtractor`;
  const max = 1 << bits;
  let n = 0;
  const doCase = (A, B, Bin) => {
    const o = {}; setBits(o, "A", bits, A); setBits(o, "B", bits, B); o["Borrow IN"] = Bin;
    const r = outObj(name, ev(name, inArr(name, o)));
    const full = A - B - Bin;
    const expD = ((full % max) + max) % max;
    check(`${name} ${A}-${B}-${Bin}`, getBits(r, "D", bits) === expD && r["Borrow OUT"] === (full < 0 ? 1 : 0));
    n++;
  };
  if (samples) {
    for (let s = 0; s < samples; s++) doCase((Math.random() * max) | 0, (Math.random() * max) | 0, (Math.random() * 2) | 0);
  } else {
    for (let A = 0; A < max; A++) for (let B = 0; B < max; B++) for (let Bin = 0; Bin < 2; Bin++) doCase(A, B, Bin);
  }
  console.log(`  ${name}: ${n} casos`);
}
testSub(2);
testSub(4);
testSub(8, 150);

// ---- multi-input gates (posicional) ----
function testGate(name, n, fn) {
  for (let s = 0; s < 40; s++) {
    const inv = Array.from({ length: n }, () => (Math.random() * 2) | 0);
    check(`${name} ${inv.join("")}`, ev(name, inv)[0] === fn(inv));
  }
}
testGate("AND-5", 5, (a) => a.every((x) => x) ? 1 : 0);
testGate("AND-8", 8, (a) => a.every((x) => x) ? 1 : 0);
testGate("OR-6", 6, (a) => a.some((x) => x) ? 1 : 0);
testGate("XOR-4", 4, (a) => a.reduce((x, y) => x ^ y, 0));
testGate("NAND-5", 5, (a) => a.every((x) => x) ? 0 : 1);
testGate("NOR-4", 4, (a) => a.some((x) => x) ? 0 : 1);
testGate("XNOR-6", 6, (a) => a.reduce((x, y) => x ^ y, 0) ? 0 : 1);

// ---- Ripple Adder 3-bit ----
for (let A = 0; A < 8; A++) for (let B = 0; B < 8; B++) for (let Ci = 0; Ci < 2; Ci++) {
  const o = {}; setBits(o, "A", 3, A); setBits(o, "B", 3, B); o.Cin = Ci;
  const r = outObj("3-bit Ripple Adder", ev("3-bit Ripple Adder", inArr("3-bit Ripple Adder", o)));
  const sum = A + B + Ci;
  check(`Add3 ${A}+${B}+${Ci}`, getBits(r, "S", 3) === (sum & 7) && r.Cout === (sum >> 3));
}

// ---- INC-4 / DEC-4 ----
for (let A = 0; A < 16; A++) {
  const o = {}; setBits(o, "A", 4, A);
  const ri = outObj("INC-4", ev("INC-4", inArr("INC-4", o)));
  check(`INC-4 ${A}`, getBits(ri, "S", 4) === ((A + 1) & 15) && ri.Cout === (A === 15 ? 1 : 0));
  const rd = outObj("DEC-4", ev("DEC-4", inArr("DEC-4", o)));
  check(`DEC-4 ${A}`, getBits(rd, "D", 4) === ((A - 1 + 16) & 15) && rd.Bout === (A === 0 ? 1 : 0));
}

// ---- COMPARE-4 ----
for (let A = 0; A < 16; A++) for (let B = 0; B < 16; B++) {
  const o = {}; setBits(o, "A", 4, A); setBits(o, "B", 4, B);
  const r = outObj("COMPARE-4", ev("COMPARE-4", inArr("COMPARE-4", o)));
  check(`CMP4 ${A}?${B}`, r["A>B"] === (A > B ? 1 : 0) && r["A=B"] === (A === B ? 1 : 0) && r["A<B"] === (A < B ? 1 : 0));
}

// ---- MUX-4 ----
for (let sel = 0; sel < 4; sel++) for (let pat = 0; pat < 16; pat++) {
  const o = { S0: sel & 1, S1: (sel >> 1) & 1 };
  for (let j = 0; j < 4; j++) o["I" + j] = (pat >> j) & 1;
  const r = outObj("MUX-4", ev("MUX-4", inArr("MUX-4", o)));
  check(`MUX-4 sel=${sel}`, r.OUT === ((pat >> sel) & 1));
}

// ---- AND-BANK-4 ----
for (let s = 0; s < 30; s++) {
  const A = (Math.random() * 16) | 0, B = (Math.random() * 16) | 0;
  const o = {}; setBits(o, "A", 4, A); setBits(o, "B", 4, B);
  const r = outObj("AND-BANK-4", ev("AND-BANK-4", inArr("AND-BANK-4", o)));
  check(`ANDBANK4 ${A}&${B}`, getBits(r, "O", 4) === (A & B));
}

// ---- DECODE-2x4 ----
for (let v = 0; v < 4; v++) {
  const r = outObj("DECODE-2x4", ev("DECODE-2x4", inArr("DECODE-2x4", { A0: v & 1, A1: (v >> 1) & 1 })));
  let ok = true;
  for (let j = 0; j < 4; j++) if (r["O" + j] !== (j === v ? 1 : 0)) ok = false;
  check(`DEC2x4 v=${v}`, ok);
}

// ---- GRAY-ENC-4 ----
for (let v = 0; v < 16; v++) {
  const o = {}; setBits(o, "B", 4, v, 0);
  const r = outObj("GRAY-ENC-4", ev("GRAY-ENC-4", inArr("GRAY-ENC-4", o)));
  check(`GRAYENC4 ${v}`, getBits(r, "G", 4, 0) === (v ^ (v >> 1)));
}

// ---- NEG-4 (complemento de 2) ----
for (let v = 0; v < 16; v++) {
  const o = {}; setBits(o, "A", 4, v, 0);
  const r = outObj("NEG-4", ev("NEG-4", inArr("NEG-4", o)));
  check(`NEG4 ${v}`, getBits(r, "O", 4, 0) === ((-v) & 15));
}

console.log(`\n=== RESULTADO: ${pass} passou, ${fail} falhou ===`);
if (fail > 0) {
  console.log("FALHAS (primeiras 15):");
  fails.slice(0, 15).forEach((f) => console.log("  - " + f));
  process.exit(1);
}
