// bcd.js — família BCD (Binary-Coded Decimal): cada dígito decimal 0..9
// ocupa 4 bits. Convenção dos pinos: bits achatados LSB-primeiro, dígito i
// nos bits 4i..4i+3 (D0..D3 = unidades, D4..D7 = dezenas, ...).
//
//   ADD3 / SUB3          células do double-dabble (e do reverso)
//   BCD-VALID            o dígito é 0..9?
//   BIN2BCD-n            binário de n bits -> BCD (double dabble)
//   BCD2BIN-d            d dígitos BCD -> binário (double dabble reverso)
//   BCD-ADD-d / -SUB-d   somador / subtrator decimal com carry / borrow
//   BCD-INC-d / -DEC-d   +1 / -1 decimal
//   BCD-9COMP-d          complemento de 9 (9...9 - A)
//   BCD-CNT-d / -DCNT-d  contador de década crescente / decrescente

const { newChip, addInputPin, addOutputPin, addSubChip, wire, validate } = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf, reduce } = require("../logic");

const CAT = "BCD";
const seq = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`);

function mk(name, ins, outs, sizeX = 1.8) {
  const chip = newChip(name, {
    size: { x: sizeX, y: Math.max(0.6, Math.max(ins.length, outs.length) * 0.45) },
    colour: palette.colourOf(CAT)
  });
  const I = {};
  ins.forEach((n) => { I[n] = addInputPin(chip, n, 1); });
  const O = {};
  outs.forEach((n) => { O[n] = addOutputPin(chip, n, 1); });
  return {
    chip, I, O,
    sub: (ref) => addSubChip(chip, ref, registry.KNOWN),
    w: (from, to) => wire(chip, from, to),
    and: (a, b) => gate2(chip, "AND", a, b),
    or: (a, b) => gate2(chip, "OR", a, b),
    xor: (a, b) => gate2(chip, "XOR", a, b),
    not: (a) => notOf(chip, a),
    done() {
      validate(chip);
      registry.register(name, ins, outs);
      return { name, chip, collection: palette.collectionOf(CAT) };
    }
  };
}

const maj = (m, a, b, c) => m.or(m.and(a, b), m.and(c, m.xor(a, b)));

// ADD3: soma 3 se o valor >= 5 (célula do double dabble).
function buildAdd3() {
  const m = mk("ADD3", seq("A", 4), seq("S", 4), 1.4);
  const [a0, a1, a2, a3] = seq("A", 4).map((n) => m.I[n]);
  const g = m.or(a3, m.and(a2, m.or(a1, a0)));
  // + 0011·g
  const c0 = m.and(a0, g);
  m.w(m.xor(a0, g), m.O.S0);
  m.w(m.xor(m.xor(a1, g), c0), m.O.S1);
  const c1 = maj(m, a1, g, c0);
  m.w(m.xor(a2, c1), m.O.S2);
  m.w(m.xor(a3, m.and(a2, c1)), m.O.S3);
  return m.done();
}

// SUB3: subtrai 3 se o valor >= 8 (célula do double dabble reverso).
function buildSub3() {
  const m = mk("SUB3", seq("A", 4), seq("S", 4), 1.4);
  const [a0, a1, a2, a3] = seq("A", 4).map((n) => m.I[n]);
  const g = a3;
  // - 3 = + 1101 (mod 16), aplicado só quando g=1
  const c0 = m.and(a0, g);
  m.w(m.xor(a0, g), m.O.S0);
  const c1 = m.and(a1, c0);
  m.w(m.xor(a1, c0), m.O.S1);
  m.w(m.xor(m.xor(a2, g), c1), m.O.S2);
  const c2 = maj(m, a2, g, c1);
  m.w(m.xor(m.xor(a3, g), c2), m.O.S3);
  return m.done();
}

function buildValid() {
  const m = mk("BCD-VALID", seq("D", 4), ["VALID"], 1.4);
  m.w(m.not(m.and(m.I.D3, m.or(m.I.D2, m.I.D1))), m.O.VALID);
  return m.done();
}

const digitsOf = (n) => String(2 ** n - 1).length;

// Roda uma célula de 4 bits (ADD3/SUB3) sobre refs; bits nulos viram 0.
function cell(m, ref, bits, zero) {
  const c = m.sub(ref);
  bits.forEach((b, i) => m.w(b || zero(), c.in(i)));
  return [0, 1, 2, 3].map((i) => c.out(i));
}

function lazyZero(m) {
  let z = null;
  return () => { if (!z) z = m.sub("0").out(0); return z; };
}

// BIN2BCD-n: double dabble combinacional. Antes de cada deslocamento, todo
// dígito que pode valer >= 5 passa por um ADD3.
function buildBin2Bcd(n) {
  const nd = digitsOf(n);
  const m = mk(`BIN2BCD-${n}`, seq("B", n), seq("D", 4 * nd));
  const zero = lazyZero(m);
  let bcd = new Array(4 * nd).fill(null);
  for (let i = n - 1; i >= 0; i--) {
    for (let d = 0; d < nd; d++) {
      const g = bcd.slice(4 * d, 4 * d + 4);
      if (g[3] || (g[2] && (g[1] || g[0]))) {
        const s = cell(m, "ADD3", g, zero);
        for (let j = 0; j < 4; j++) bcd[4 * d + j] = s[j];
      }
    }
    bcd = [m.I[`B${i}`], ...bcd.slice(0, 4 * nd - 1)];
  }
  bcd.forEach((b, i) => m.w(b || zero(), m.O[`D${i}`]));
  return m.done();
}

// BCD2BIN-d: desloca para a direita; o bit que sai entra no binário; todo
// dígito que pode valer >= 8 passa por um SUB3.
function buildBcd2Bin(d) {
  const nb = (10 ** d - 1).toString(2).length;
  const m = mk(`BCD2BIN-${d}`, seq("D", 4 * d), seq("B", nb));
  const zero = lazyZero(m);
  let bcd = seq("D", 4 * d).map((x) => m.I[x]);
  const bin = [];
  for (let j = 0; j < nb; j++) {
    bin.push(bcd[0]);
    bcd = [...bcd.slice(1), null];
    if (j === nb - 1) break;
    for (let q = 0; q < d; q++) {
      const g = bcd.slice(4 * q, 4 * q + 4);
      if (g[3]) {
        const s = cell(m, "SUB3", g, zero);
        for (let t = 0; t < 4; t++) bcd[4 * q + t] = s[t];
      }
    }
  }
  bin.forEach((b, i) => m.w(b || zero(), m.O[`B${i}`]));
  return m.done();
}

// Encadeia d cópias de uma célula de 1 dígito (4 bits + carry -> 4 + carry).
function chainDigits(name, cellName, d, ins2, cinName, outPref, coutName) {
  const ins = [...seq("A", 4 * d), ...(ins2 ? seq("B", 4 * d) : []), cinName];
  const m = mk(name, ins, [...seq(outPref, 4 * d), coutName]);
  let carry = m.I[cinName];
  for (let q = 0; q < d; q++) {
    const c = m.sub(cellName);
    let p = 0;
    for (let i = 0; i < 4; i++) m.w(m.I[`A${4 * q + i}`], c.in(p++));
    if (ins2) for (let i = 0; i < 4; i++) m.w(m.I[`B${4 * q + i}`], c.in(p++));
    m.w(carry, c.in(p));
    for (let i = 0; i < 4; i++) m.w(c.out(i), m.O[`${outPref}${4 * q + i}`]);
    carry = c.out(4);
  }
  m.w(carry, m.O[coutName]);
  return m.done();
}

// BCD-ADD-1: soma binária de 4 bits + correção (+6 se passou de 9).
function buildAdd1() {
  const m = mk("BCD-ADD-1", [...seq("A", 4), ...seq("B", 4), "Cin"], [...seq("S", 4), "Cout"]);
  let c = m.I.Cin;
  const z = [];
  for (let i = 0; i < 4; i++) {
    const a = m.I[`A${i}`], b = m.I[`B${i}`];
    z.push(m.xor(m.xor(a, b), c));
    c = maj(m, a, b, c);
  }
  const C = m.or(c, m.and(z[3], m.or(z[2], z[1])));
  // + 0110·C
  m.w(z[0], m.O.S0);
  m.w(m.xor(z[1], C), m.O.S1);
  const c1 = m.and(z[1], C);
  m.w(m.xor(m.xor(z[2], C), c1), m.O.S2);
  m.w(m.xor(z[3], maj(m, z[2], C, c1)), m.O.S3);
  m.w(C, m.O.Cout);
  return m.done();
}

// BCD-INC-1: +Cin no dígito; 9+1 vira 0 com Cout.
function buildInc1() {
  const m = mk("BCD-INC-1", [...seq("A", 4), "Cin"], [...seq("S", 4), "Cout"]);
  const a = seq("A", 4).map((n) => m.I[n]);
  const cout = m.and(m.I.Cin, m.and(a[3], a[0]));
  const ncout = m.not(cout);
  let c = m.I.Cin;
  for (let i = 0; i < 4; i++) {
    m.w(m.and(m.xor(a[i], c), ncout), m.O[`S${i}`]);
    c = m.and(a[i], c);
  }
  m.w(cout, m.O.Cout);
  return m.done();
}

// BCD-DEC-1: -Bin no dígito; 0-1 vira 9 com Bout.
function buildDec1() {
  const m = mk("BCD-DEC-1", [...seq("A", 4), "Bin"], [...seq("S", 4), "Bout"]);
  const a = seq("A", 4).map((n) => m.I[n]);
  const bout = m.and(m.I.Bin, m.not(reduce(m.chip, "OR", a)));
  const nb = m.not(bout);
  let b = m.I.Bin;
  for (let i = 0; i < 4; i++) {
    const s = m.xor(a[i], b);
    // 0-1 em binário dá 1111; zera os bits 1 e 2 para virar 1001 (9).
    m.w(i === 1 || i === 2 ? m.and(s, nb) : s, m.O[`S${i}`]);
    b = m.and(m.not(a[i]), b);
  }
  m.w(bout, m.O.Bout);
  return m.done();
}

// BCD-9COMP: 9 - A por dígito.
function build9Comp(d) {
  const m = mk(`BCD-9COMP-${d}`, seq("A", 4 * d), seq("C", 4 * d));
  for (let q = 0; q < d; q++) {
    const a = [0, 1, 2, 3].map((i) => m.I[`A${4 * q + i}`]);
    const o = (i) => m.O[`C${4 * q + i}`];
    if (d > 1) {
      const c = m.sub("BCD-9COMP-1");
      a.forEach((x, i) => { m.w(x, c.in(i)); m.w(c.out(i), o(i)); });
      continue;
    }
    m.w(m.not(a[0]), o(0));
    m.w(a[1], o(1));
    m.w(m.xor(a[2], a[1]), o(2));
    m.w(m.not(m.or(m.or(a[3], a[2]), a[1])), o(3));
  }
  return m.done();
}

// BCD-SUB-d: A - B - Bin = A + 9comp(B) + NOT Bin; Bout = NOT carry.
// Resultado negativo sai em complemento de 10 (como numa calculadora).
function buildSub(d) {
  const W = 4 * d;
  const m = mk(`BCD-SUB-${d}`, [...seq("A", W), ...seq("B", W), "Bin"], [...seq("D", W), "Bout"]);
  const comp = m.sub(`BCD-9COMP-${d}`);
  const add = m.sub(`BCD-ADD-${d}`);
  for (let i = 0; i < W; i++) {
    m.w(m.I[`B${i}`], comp.in(i));
    m.w(m.I[`A${i}`], add.in(i));
    m.w(comp.out(i), add.in(W + i));
    m.w(add.out(i), m.O[`D${i}`]);
  }
  m.w(m.not(m.I.Bin), add.in(2 * W));
  m.w(m.not(add.out(W)), m.O.Bout);
  return m.done();
}

// Contador de década com d dígitos (EN conta, CLR zera). CO = vai virar.
function buildCounter(d, down) {
  const W = 4 * d;
  const name = `BCD-${down ? "DCNT" : "CNT"}-${d}`;
  const m = mk(name, ["EN", "CLR", "CLK"], [...seq("Q", W), down ? "BO" : "CO"]);
  const reg = m.sub(`WREG-CLR-${W}`);
  const step = m.sub(`BCD-${down ? "DEC" : "INC"}-${d}`);
  for (let i = 0; i < W; i++) {
    m.w(reg.out(i), step.in(i));
    m.w(step.out(i), reg.in(i));
    m.w(reg.out(i), m.O[`Q${i}`]);
  }
  m.w(m.I.EN, step.in(W));
  m.w(m.I.EN, reg.in(W));
  m.w(m.I.CLR, reg.in(W + 1));
  m.w(m.I.CLK, reg.in(W + 2));
  m.w(step.out(W), m.O[down ? "BO" : "CO"]);
  return m.done();
}

function generate() {
  const out = [buildAdd3(), buildSub3(), buildValid()];
  for (let n = 4; n <= 32; n++) out.push(buildBin2Bcd(n));
  for (let d = 2; d <= 9; d++) out.push(buildBcd2Bin(d));
  out.push(buildAdd1(), buildInc1(), buildDec1(), build9Comp(1));
  for (let d = 2; d <= 16; d++) {
    out.push(chainDigits(`BCD-ADD-${d}`, "BCD-ADD-1", d, true, "Cin", "S", "Cout"));
    out.push(chainDigits(`BCD-INC-${d}`, "BCD-INC-1", d, false, "Cin", "S", "Cout"));
    out.push(chainDigits(`BCD-DEC-${d}`, "BCD-DEC-1", d, false, "Bin", "S", "Bout"));
  }
  for (let d = 2; d <= 16; d++) out.push(build9Comp(d));
  for (let d = 1; d <= 16; d++) out.push(buildSub(d));
  for (let d = 1; d <= 6; d++) out.push(buildCounter(d, false), buildCounter(d, true));
  return out;
}

module.exports = { generate };
