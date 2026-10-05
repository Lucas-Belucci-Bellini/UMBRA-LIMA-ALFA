// test-memory.js — testa os chips de MEMÓRIA e BCD com um simulador COM
// ESTADO. O simulate.js avalia cada chip isolado e sem memória entre
// chamadas, o que não serve para RAM/FIFO/STACK: aqui o chip é achatado
// até NAND numa netlist única e os valores dos fios persistem entre ciclos
// de clock (o latch guarda o bit de verdade).

const { loadChip } = require("./simulate");

// ---- achatamento até NAND -------------------------------------------------
function flatten(top) {
  const parent = [];
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const keys = new Map();
  const net = (k) => {
    let id = keys.get(k);
    if (id === undefined) { id = parent.length; parent.push(id); keys.set(k, id); }
    return id;
  };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const nands = [];

  // Instancia `name` no caminho `path`; devolve os nets dos pinos [ins, outs].
  function inst(name, path) {
    if (name === "NAND") {
      const io = [net(path + "#0"), net(path + "#1"), net(path + "#2")];
      nands.push(io);
      return [[io[0], io[1]], [io[2]]];
    }
    const c = loadChip(name);
    if (!c) throw new Error("chip ausente: " + name);
    const pinNet = (owner, pin) => net(`${path}/${owner}:${pin}`);
    const subs = {};
    for (const s of c.SubChips) {
      const ref = s.Name === "NAND" ? null : loadChip(s.Name);
      const [ins, outs] = inst(s.Name, `${path}/${s.ID}`);
      const inIds = ref ? ref.InputPins.map((p) => p.ID) : [0, 1];
      const outIds = ref ? ref.OutputPins.map((p) => p.ID) : [2];
      inIds.forEach((id, i) => union(pinNet(s.ID, id), ins[i]));
      outIds.forEach((id, i) => union(pinNet(s.ID, id), outs[i]));
      subs[s.ID] = true;
    }
    for (const w of c.Wires) {
      union(pinNet(w.SourcePinAddress.PinOwnerID, w.SourcePinAddress.PinID),
        pinNet(w.TargetPinAddress.PinOwnerID, w.TargetPinAddress.PinID));
    }
    return [c.InputPins.map((p) => pinNet(p.ID, 0)), c.OutputPins.map((p) => pinNet(p.ID, 0))];
  }

  const [ins, outs] = inst(top, "");
  const chip = loadChip(top);
  const g = nands.map(([a, b, o]) => [find(a), find(b), find(o)]);
  return {
    gates: g,
    size: parent.length,
    inNet: Object.fromEntries(chip.InputPins.map((p, i) => [p.Name, find(ins[i])])),
    outNet: Object.fromEntries(chip.OutputPins.map((p, i) => [p.Name, find(outs[i])]))
  };
}

let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

// ---- simulação com estado -------------------------------------------------
class Sim {
  constructor(name) {
    this.name = name;
    this.f = flatten(name);
    this.v = new Uint8Array(this.f.size);
    this.drivenIn = new Set(Object.values(this.f.inNet));
    this.settle();
  }
  set(pins) {
    for (const [k, val] of Object.entries(pins)) {
      const n = this.f.inNet[k];
      if (n === undefined) throw new Error(`${this.name}: sem pino ${k}`);
      this.v[n] = val ? 1 : 0;
    }
    this.settle();
  }
  settle() {
    const { gates } = this.f;
    const v = this.v;
    const pass = (skip) => {
      let changed = false;
      for (let i = 0; i < gates.length; i++) {
        if (skip && rnd(2)) continue;
        const [a, b, o] = gates[i];
        const x = (v[a] & v[b]) ^ 1;
        if (v[o] !== x) { v[o] = x; changed = true; }
      }
      return changed;
    };
    for (let it = 0; it < 5000; it++) {
      // Só declara estável depois de uma passada COMPLETA sem mudança.
      if (!pass(false)) return;
      // Passou de 50: intercala passadas que atualizam só metade das portas
      // (ao acaso) — quebra a oscilação simétrica de latch que parte de 0/0,
      // como o metaestável de um latch real resolve para um lado.
      if (it > 50) pass(true);
    }
    throw new Error(`${this.name}: não estabilizou`);
  }
  get(pin) { return this.v[this.f.outNet[pin]]; }
  word(prefix, n) { let x = 0; for (let i = 0; i < n; i++) x += this.get(prefix + i) * 2 ** i; return x; }
  bus(prefix, n, val) { const o = {}; for (let i = 0; i < n; i++) o[prefix + i] = Math.floor(val / 2 ** i) % 2; return o; }
  // Pulso de clock: sobe e desce (D-FF grava na borda de subida).
  tick() { this.set({ CLK: 1 }); this.set({ CLK: 0 }); }
}

let pass = 0, fail = 0;
const fails = [];
function check(label, ok) { if (ok) pass++; else { fail++; fails.push(label); } }


// ---- bit cells ----
{
  const s = new Sim("BIT");
  s.set({ D: 1, WE: 0 }); s.tick(); check("BIT WE=0 não grava", s.get("Q") === 0);
  s.set({ D: 1, WE: 1 }); s.tick(); check("BIT grava 1", s.get("Q") === 1);
  s.set({ D: 0, WE: 0 }); s.tick(); check("BIT guarda 1", s.get("Q") === 1);
  s.set({ D: 0, WE: 1 }); check("BIT só grava na borda", s.get("Q") === 1);
  s.tick(); check("BIT grava 0", s.get("Q") === 0);
}
{
  const s = new Sim("BIT-RS");
  s.set({ SET: 1 }); s.tick(); check("BIT-RS set", s.get("Q") === 1);
  s.set({ SET: 1, CLR: 1 }); s.tick(); check("BIT-RS clr>set", s.get("Q") === 0);
}
{
  const s = new Sim("BIT-SEL");
  s.set({ D: 1, WE: 1, SEL: 0 }); s.tick(); check("BIT-SEL sel=0 não grava", s.get("Q") === 0);
  s.set({ SEL: 1 }); s.tick(); check("BIT-SEL grava", s.get("Q") === 1 && s.get("O") === 1);
  s.set({ SEL: 0 }); check("BIT-SEL O=0 sem sel", s.get("O") === 0 && s.get("Q") === 1);
}

// ---- RAM genérica: escreve tudo, lê tudo, sobrescreve aleatório ----
function testRam(name, k, B, extra = {}) {
  const s = new Sim(name);
  const W = 1 << k, mask = 2 ** B - 1;
  const mem = new Array(W).fill(0);
  const A = name.startsWith("RAM2P") || name.startsWith("REGF") ? "WA" : "A";
  s.set(extra);
  for (let a = 0; a < W; a++) {
    mem[a] = rnd(mask + 1);
    s.set({ ...s.bus(A, k, a), ...s.bus("D", B, mem[a]), WE: 1 }); s.tick();
  }
  s.set({ WE: 0 });
  for (let i = 0; i < W * 2; i++) {
    if (rnd(3) === 0) {
      const a = rnd(W), val = rnd(mask + 1);
      s.set({ ...s.bus(A, k, a), ...s.bus("D", B, val), WE: 1 }); s.tick(); s.set({ WE: 0 });
      mem[a] = val;
    }
    const a = rnd(W), b = rnd(W);
    if (A === "A") {
      s.set(s.bus("A", k, a));
      if (name.startsWith("RAMS")) { s.set({ RE: 1 }); s.tick(); s.set({ RE: 0 }); }
      check(`${name} [${a}]`, s.word("O", B) === mem[a]);
    } else if (name.startsWith("RAM2P")) {
      s.set(s.bus("RA", k, a));
      check(`${name} RA=${a}`, s.word("O", B) === mem[a]);
    } else {
      s.set({ ...s.bus("RA", k, a), ...s.bus("RB", k, b) });
      check(`${name} RA=${a} RB=${b}`, s.word("OA", B) === mem[a] && s.word("OB", B) === mem[b]);
    }
  }
  return s;
}
for (const [k, B] of [[1, 1], [2, 3], [3, 4], [4, 8], [5, 2], [6, 8], [4, 24]]) {
  testRam(`RAM-${1 << k}x${B}`, k, B);
  testRam(`RAM2P-${1 << k}x${B}`, k, B);
  testRam(`REGF-${1 << k}x${B}`, k, B);
  testRam(`RAMS-${1 << k}x${B}`, k, B);
}
{
  const s = testRam("RAMCS-8x4", 3, 4, { CS: 1 });
  s.set({ CS: 0 }); check("RAMCS CS=0 zera saída", s.word("O", 4) === 0);
  s.set({ ...s.bus("A", 3, 2), ...s.bus("D", 4, 5), WE: 1, CS: 1 }); s.tick();
  s.set({ ...s.bus("D", 4, 9), CS: 0 }); s.tick(); s.set({ WE: 0, CS: 1 });
  check("RAMCS CS=0 não grava", s.word("O", 4) === 5);
}
{
  const s = testRam("RAMC-8x4", 3, 4);
  s.set({ CLR: 1 }); s.tick(); s.set({ CLR: 0 });
  let ok = true;
  for (let a = 0; a < 8; a++) { s.set(s.bus("A", 3, a)); if (s.word("O", 4) !== 0) ok = false; }
  check("RAMC CLR zera tudo", ok);
}

// ---- STACK ----
function testStack(k, B) {
  const name = `STACK-${1 << k}x${B}`;
  const s = new Sim(name);
  const W = 1 << k, st = [];
  s.set({ RST: 1 }); s.tick(); s.set({ RST: 0 });
  for (let i = 0; i < 300; i++) {
    const op = rnd(3); // 0 push, 1 pop, 2 nada
    if (op === 0) {
      const v = rnd(2 ** B);
      s.set({ ...s.bus("D", B, v), PUSH: 1 }); s.tick(); s.set({ PUSH: 0 });
      if (st.length < W) st.push(v);
    } else if (op === 1) {
      s.set({ POP: 1 }); s.tick(); s.set({ POP: 0 });
      st.pop();
    }
    check(`${name} EMPTY`, s.get("EMPTY") === (st.length === 0 ? 1 : 0));
    check(`${name} FULL`, s.get("FULL") === (st.length === W ? 1 : 0));
    if (st.length) check(`${name} topo`, s.word("O", B) === st[st.length - 1]);
  }
}
testStack(2, 4); testStack(3, 3); testStack(1, 2); testStack(5, 8);

// ---- FIFO ----
function testFifo(k, B) {
  const name = `FIFO-${1 << k}x${B}`;
  const s = new Sim(name);
  const W = 1 << k, q = [];
  s.set({ RST: 1 }); s.tick(); s.set({ RST: 0 });
  for (let i = 0; i < 300; i++) {
    const wr = rnd(2), rd = rnd(2), v = rnd(2 ** B);
    const canW = q.length < W, canR = q.length > 0;
    s.set({ ...s.bus("D", B, v), WR: wr, RD: rd }); s.tick(); s.set({ WR: 0, RD: 0 });
    if (rd && canR) q.shift();
    if (wr && canW) q.push(v);
    check(`${name} EMPTY`, s.get("EMPTY") === (q.length === 0 ? 1 : 0));
    check(`${name} FULL`, s.get("FULL") === (q.length === W ? 1 : 0));
    if (q.length) check(`${name} cabeça`, s.word("O", B) === q[0]);
  }
}
testFifo(2, 4); testFifo(3, 2); testFifo(1, 3); testFifo(5, 8);

// ---- DLINE ----
{
  const s = new Sim("DLINE-4x4");
  s.set({ RST: 1 }); s.tick(); s.set({ RST: 0, EN: 1 });
  const hist = [];
  for (let i = 0; i < 40; i++) {
    const v = rnd(16);
    if (hist.length >= 4) check(`DLINE atraso ${i}`, s.word("O", 4) === hist[hist.length - 4]);
    s.set(s.bus("D", 4, v)); s.tick(); hist.push(v);
  }
}

// ---- PTR / ADEC ----
{
  const s = new Sim("PTR-4");
  s.set({ CLR: 1 }); s.tick(); s.set({ CLR: 0, EN: 1 });
  let ok = true;
  for (let i = 1; i < 40; i++) { s.tick(); if (s.word("Q", 4) !== i % 16) ok = false; }
  check("PTR-4 conta", ok);
}
for (const k of [1, 3, 5]) {
  const s = new Sim(`ADEC-${k}`);
  for (let a = 0; a < 1 << k; a++) for (const en of [0, 1]) {
    s.set({ ...s.bus("A", k, a), EN: en });
    check(`ADEC-${k} ${a}/${en}`, s.word("O", 1 << k) === (en ? 2 ** a : 0));
  }
}

// ---- BCD ----
const toBcd = (x, d) => { let r = 0; for (let i = 0; i < d; i++) { r += (x % 10) * 2 ** (4 * i); x = Math.floor(x / 10); } return r; };
for (const n of [4, 7, 8, 10, 16, 24, 32]) {
  const s = new Sim(`BIN2BCD-${n}`), nd = String(2 ** n - 1).length;
  for (let i = 0; i < 200; i++) {
    const x = i < 16 ? i : rnd(2 ** n);
    s.set(s.bus("B", n, x));
    check(`BIN2BCD-${n} ${x}`, s.word("D", 4 * nd) === toBcd(x, nd));
  }
}
for (const d of [2, 3, 4, 6, 9]) {
  const s = new Sim(`BCD2BIN-${d}`), nb = (10 ** d - 1).toString(2).length;
  for (let i = 0; i < 200; i++) {
    const x = rnd(10 ** d);
    s.set(s.bus("D", 4 * d, toBcd(x, d)));
    check(`BCD2BIN-${d} ${x}`, s.word("B", nb) === x);
  }
}
{
  const s = new Sim("BCD-VALID");
  for (let x = 0; x < 16; x++) { s.set(s.bus("D", 4, x)); check(`VALID ${x}`, s.get("VALID") === (x <= 9 ? 1 : 0)); }
}
for (const d of [1, 2, 3, 8]) {
  const add = new Sim(`BCD-ADD-${d}`), sub = new Sim(`BCD-SUB-${d}`), M = 10 ** d;
  const nine = new Sim(`BCD-9COMP-${d}`);
  for (let i = 0; i < 300; i++) {
    const a = d === 1 ? Math.floor(i / 20) % 10 : rnd(M), b = d === 1 ? Math.floor(i / 2) % 10 : rnd(M), c = i & 1;
    add.set({ ...add.bus("A", 4 * d, toBcd(a, d)), ...add.bus("B", 4 * d, toBcd(b, d)), Cin: c });
    const sum = a + b + c;
    check(`BCD-ADD-${d} ${a}+${b}+${c}`, add.word("S", 4 * d) === toBcd(sum % M, d) && add.get("Cout") === (sum >= M ? 1 : 0));
    sub.set({ ...sub.bus("A", 4 * d, toBcd(a, d)), ...sub.bus("B", 4 * d, toBcd(b, d)), Bin: c });
    const dif = a - b - c;
    check(`BCD-SUB-${d} ${a}-${b}-${c}`, sub.word("D", 4 * d) === toBcd(((dif % M) + M) % M, d) && sub.get("Bout") === (dif < 0 ? 1 : 0));
    nine.set(nine.bus("A", 4 * d, toBcd(a, d)));
    check(`9COMP-${d} ${a}`, nine.word("C", 4 * d) === toBcd(M - 1 - a, d));
  }
  const inc = new Sim(`BCD-INC-${d}`), dec = new Sim(`BCD-DEC-${d}`);
  for (let a = 0; a < Math.min(M, 300); a++) for (const c of [0, 1]) {
    const x = d >= 3 ? rnd(M) : a;
    inc.set({ ...inc.bus("A", 4 * d, toBcd(x, d)), Cin: c });
    check(`BCD-INC-${d} ${x}+${c}`, inc.word("S", 4 * d) === toBcd((x + c) % M, d) && inc.get("Cout") === (x + c >= M ? 1 : 0));
    dec.set({ ...dec.bus("A", 4 * d, toBcd(x, d)), Bin: c });
    check(`BCD-DEC-${d} ${x}-${c}`, dec.word("S", 4 * d) === toBcd((x - c + M) % M, d) && dec.get("Bout") === (x - c < 0 ? 1 : 0));
  }
}
for (const down of [false, true]) {
  const name = `BCD-${down ? "DCNT" : "CNT"}-2`;
  const s = new Sim(name);
  s.set({ CLR: 1 }); s.tick(); s.set({ CLR: 0, EN: 1 });
  let ok = true, x = 0;
  for (let i = 0; i < 130; i++) {
    s.tick(); x = down ? (x + 99) % 100 : (x + 1) % 100;
    if (s.word("Q", 8) !== toBcd(x, 2)) ok = false;
  }
  check(`${name} conta 130 ciclos`, ok);
}

console.log(`=== MEMÓRIA + BCD: ${pass} passou, ${fail} falhou ===`);
if (fail) { fails.slice(0, 20).forEach((f) => console.log("  - " + f)); process.exit(1); }
