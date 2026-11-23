// test-memoria256x8.js — testa o MEMORIA 256x8 com um simulador COM ESTADO
// que entende os builtins usados pelo MEM-256 (3-STATE BUFFER, BUS-1,
// splits/merges) e lê o que cada display de 7 segmentos mostra.
//
// Roda as 8 operações da atividade, confere o número nos 3 dígitos do
// display e a SAIDA, e depois uma bateria aleatória nos 256 endereços.
// Uso: node tools/test-memoria256x8.js

const fs = require("fs");
const path = require("path");

const CHIPS = path.join(__dirname, "..", "Chips");
const cache = {};
function load(name) {
  if (!(name in cache)) {
    const f = path.join(CHIPS, `${name}.json`);
    cache[name] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }
  return cache[name];
}

const Z = -1; // desconectado (alta impedância)

// Builtins: pinos posicionais conforme o fonte do DLS.
// nIn entradas (IDs 0..nIn-1) e nOut saídas (IDs nIn..), f(valores) -> saídas.
const bits = (v, n) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1); // MSB primeiro
const pack = (a) => a.reduce((v, b) => (v << 1) | (b === 1 ? 1 : 0), 0);
const BUILTIN = {
  NAND: { nIn: 2, nOut: 1, f: ([a, b]) => [(a === 1 && b === 1) ? 0 : 1] },
  "3-STATE BUFFER": { nIn: 2, nOut: 1, f: ([d, en]) => [en === 1 ? (d === Z ? 0 : d) : Z] },
  "BUS-1": { nIn: 1, nOut: 1, f: ([x]) => [x] },
  "BUS-TERMINUS-1": { nIn: 1, nOut: 0, f: () => [] },
  "8-1BIT": { nIn: 1, nOut: 8, f: ([x]) => bits(x === Z ? 0 : x, 8) },
  "8-4BIT": { nIn: 1, nOut: 2, f: ([x]) => { const v = x === Z ? 0 : x; return [(v >> 4) & 15, v & 15]; } },
  "4-1BIT": { nIn: 1, nOut: 4, f: ([x]) => bits(x === Z ? 0 : x, 4) },
  "1-8BIT": { nIn: 8, nOut: 1, f: (a) => [pack(a)] },
  "1-4BIT": { nIn: 4, nOut: 1, f: (a) => [pack(a)] },
  "7-SEGMENT": { nIn: 8, nOut: 0, f: () => [], display: true }
};

// Achata o chip em primitivos. Cada net tem uma lista de "drivers"
// (saídas de primitivos ou pinos de entrada do topo); o valor da net é a
// resolução deles (Z some; se sobrar algum, OR).
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
  const prims = [];

  function inst(name, p) {
    const b = BUILTIN[name];
    if (b) {
      const ins = Array.from({ length: b.nIn }, (_, i) => net(`${p}#${i}`));
      const outs = Array.from({ length: b.nOut }, (_, i) => net(`${p}#${b.nIn + i}`));
      prims.push({ name, b, ins, outs, path: p });
      return { pin: (id) => net(`${p}#${id}`) };
    }
    const c = load(name);
    if (!c) throw new Error(`chip ausente: ${name}`);
    const pinNet = (owner, id) => net(`${p}/${owner}:${id}`);
    for (const s of c.SubChips) {
      const sub = inst(s.Name, `${p}/${s.ID}`);
      if (BUILTIN[s.Name]) {
        // pinos do builtin: liga a net do pai à net interna do primitivo
        const nPins = BUILTIN[s.Name].nIn + BUILTIN[s.Name].nOut;
        for (let id = 0; id < nPins; id++) union(pinNet(s.ID, id), sub.pin(id));
      } else {
        const ref = load(s.Name);
        for (const q of [...ref.InputPins, ...ref.OutputPins]) union(pinNet(s.ID, q.ID), sub.pin(q.ID));
      }
    }
    for (const w of c.Wires) {
      union(pinNet(w.SourcePinAddress.PinOwnerID, w.SourcePinAddress.PinID),
        pinNet(w.TargetPinAddress.PinOwnerID, w.TargetPinAddress.PinID));
    }
    return { pin: (id) => pinNet(id, 0) };
  }

  const root = inst(top, "");
  const c = load(top);
  const N = parent.length;
  const r = (x) => find(x);
  return {
    N, r,
    prims: prims.map((q) => ({ ...q, ins: q.ins.map(r), outs: q.outs.map(r) })),
    inNet: Object.fromEntries(c.InputPins.map((q) => [q.Name, r(root.pin(q.ID))])),
    outNet: Object.fromEntries(c.OutputPins.map((q) => [q.Name, r(root.pin(q.ID))]))
  };
}

let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

class Sim {
  constructor(name) {
    const f = flatten(name);
    this.f = f;
    // drivers: um slot por saída de primitivo + um por pino de entrada do topo
    this.slots = [];
    this.netDrivers = Array.from({ length: f.N }, () => []);
    const addSlot = (n) => { const s = this.slots.length; this.slots.push(Z); this.netDrivers[n].push(s); return s; };
    this.inSlot = {};
    for (const [k, n] of Object.entries(f.inNet)) this.inSlot[k] = { s: addSlot(n), n };
    for (const p of f.prims) p.outSlots = p.outs.map(addSlot);
    this.netVal = new Array(f.N).fill(Z);
    this.displays = f.prims.filter((p) => p.b.display);
    this.settle();
  }
  resolve(n) {
    let v = Z;
    for (const s of this.netDrivers[n]) {
      const x = this.slots[s];
      if (x !== Z) v = v === Z ? x : (v | x);
    }
    return v;
  }
  setSlot(s, n, v) {
    if (this.slots[s] === v) return false;
    this.slots[s] = v;
    const nv = this.resolve(n);
    if (nv === this.netVal[n]) return false;
    this.netVal[n] = nv;
    return true;
  }
  set(pins) {
    for (const [k, v] of Object.entries(pins)) {
      const x = this.inSlot[k];
      if (!x) throw new Error(`sem pino ${k}`);
      this.setSlot(x.s, x.n, v);
    }
    this.settle();
  }
  pass(skip) {
    let changed = false;
    for (const p of this.f.prims) {
      if (!p.outs.length || (skip && rnd(2))) continue;
      const ins = p.ins.map((n) => this.netVal[n]);
      const out = p.b.f(ins.map((v) => (v === Z && p.name !== "3-STATE BUFFER" && p.name !== "BUS-1") ? 0 : v));
      out.forEach((v, i) => { if (this.setSlot(p.outSlots[i], p.outs[i], v)) changed = true; });
    }
    return changed;
  }
  settle() {
    for (let it = 0; it < 4000; it++) {
      if (!this.pass(false)) return;
      if (it > 40) this.pass(true); // quebra oscilação simétrica de latch
    }
    throw new Error("não estabilizou");
  }
  get(pin) { const v = this.netVal[this.f.outNet[pin]]; return v === Z ? 0 : v; }
  // Número mostrado nos displays de 7 segmentos (da esquerda p/ a direita).
  shown() {
    const DIG = { 0x3f: 0, 0x06: 1, 0x5b: 2, 0x4f: 3, 0x66: 4, 0x6d: 5, 0x7d: 6, 0x07: 7, 0x7f: 8, 0x6f: 9 };
    // A..G = pinos 0..6 -> bits a..g
    const digits = this.displays.map((d) => {
      let m = 0;
      for (let i = 0; i < 7; i++) if (this.netVal[d.ins[i]] === 1) m |= 1 << i;
      return m in DIG ? String(DIG[m]) : "?";
    });
    return digits.join("");
  }
}

let pass = 0, fail = 0;
const fails = [];
function check(label, ok) { if (ok) pass++; else { fail++; fails.push(label); } }

const s = new Sim("MEMORIA 256x8");
check("8 MEM-256 no chip", load("MEMORIA 256x8").SubChips.filter((x) => x.Name === "MEM-256").length === 8);
check("3 dígitos de display", s.displays.length === 3);
console.log(`primitivos: ${s.f.prims.length}, displays: ${s.displays.length}`);

const write = (a, d) => { s.set({ ENDERECO: a, DADO: d, WRITE: 0 }); s.set({ WRITE: 1 }); s.set({ WRITE: 0 }); };
const read = (a) => { s.set({ ENDERECO: a, WRITE: 0 }); return { saida: s.get("SAIDA"), display: s.shown() }; };

// As 8 operações da atividade, na ordem.
const OPS = [
  ["W", 0, 100], ["R", 0, 100],
  ["W", 42, 255], ["R", 42, 255],
  ["W", 128, 73], ["R", 128, 73],
  ["W", 0, 199], ["R", 0, 199]
];
s.set({ WRITE: 0 });
for (const [op, a, d] of OPS) {
  if (op === "W") {
    s.set({ ENDERECO: a, DADO: d, WRITE: 1 });
    const disp = s.shown();
    console.log(`  WRITE end=${String(a).padStart(3)} dado=${String(d).padStart(3)} -> display ${disp}`);
    check(`write ${a}<=${d} mostra o dado`, disp === String(d).padStart(3, "0"));
    s.set({ WRITE: 0 });
  } else {
    const r = read(a);
    console.log(`  READ  end=${String(a).padStart(3)}           -> display ${r.display}, SAIDA ${r.saida}`);
    check(`read ${a} == ${d}`, r.saida === d && r.display === String(d).padStart(3, "0"));
  }
}
// Os outros endereços continuam com o que tinham.
check("end 42 intacto", read(42).saida === 255);
check("end 128 intacto", read(128).saida === 73);

// Bateria aleatória: escreve e confere contra um modelo.
const mem = new Map([[0, 199], [42, 255], [128, 73]]);
for (let i = 0; i < 120; i++) {
  const a = rnd(256), d = rnd(256);
  write(a, d); mem.set(a, d);
  const b = [...mem.keys()][rnd(mem.size)];
  const r = read(b);
  check(`aleatório end ${b}`, r.saida === mem.get(b) && r.display === String(mem.get(b)).padStart(3, "0"));
}

console.log(`=== MEMORIA 256x8: ${pass} passou, ${fail} falhou ===`);
if (fail) { fails.slice(0, 15).forEach((f) => console.log("  - " + f)); process.exit(1); }
