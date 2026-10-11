// memory.js — tudo que é preciso para montar um BIT de memória e, a partir
// dele, RAM de qualquer tamanho. Construção hierárquica de baixo para cima:
//
//   BIT-*          célula de 1 bit (D-FF + realimentação de escrita)
//   WREG-*         palavra de N bits (N células BIT lado a lado)
//   WMUX2 / WGATE  utilitários de palavra (mux 2:1 e máscara por enable)
//   ADEC / PTR     decodificador de endereço e ponteiro (contador)
//   RAM-WxB        RAM recursiva: RAM-2W = 2×RAM-W + 1 bit de endereço
//   RAMC/RAMS/RAMCS  variantes (clear, leitura síncrona, chip-select)
//   RAM2P / REGF   dual-port (end. de escrita e leitura separados) e
//                  banco de registradores 1W2R (estilo CPU)
//   STACK / FIFO / DLINE  memórias com ponteiro interno
//
// A RAM é recursiva de propósito: cada arquivo tem só 2 subchips de RAM
// menores + um punhado de portas, então RAM-4096x64 continua um JSON
// pequeno. W = 2^k palavras, B = bits por palavra. Leitura assíncrona
// (combinacional) e escrita na borda de subida do CLK com WE=1.

const {
  newChip, addInputPin, addOutputPin, addSubChip, wire, validate
} = require("../chip-builder");
const registry = require("../pin-registry");
const palette = require("../palette");
const { gate2, notOf, reduce } = require("../logic");

const WIDTHS = Array.from({ length: 64 }, (_, i) => i + 1); // B = 1..64
const MAX_K = 12;     // até 4096 palavras
const DLINE_MAX_K = 6; // linha de atraso até 64 posições
const PTR_MAX = 13;   // FIFO-4096 usa PTR-13
const ADEC_MAX = 7;

const seq = (p, n, base = 0) => Array.from({ length: n }, (_, i) => `${p}${i + base}`);

// Cria o chip, os pinos (todos de 1 bit) e devolve refs por nome.
// `done()` valida, registra no pin-registry e devolve o item do gerador.
function mk(name, cat, ins, outs, sizeX = 2.0) {
  const pins = Math.max(ins.length, outs.length);
  const chip = newChip(name, {
    size: { x: sizeX, y: Math.max(0.6, pins * 0.45) },
    colour: palette.colourOf(cat)
  });
  const I = {};
  ins.forEach((n) => { I[n] = addInputPin(chip, n, 1); });
  const O = {};
  outs.forEach((n) => { O[n] = addOutputPin(chip, n, 1); });
  return {
    chip, I, O,
    sub: (ref) => addSubChip(chip, ref, registry.KNOWN),
    w: (from, to) => wire(chip, from, to),
    done() {
      validate(chip);
      registry.register(name, ins, outs);
      return { name, chip, collection: palette.collectionOf(cat) };
    }
  };
}

// mux de 1 bit: S ? b : a
function mux1(chip, s, a, b) {
  return gate2(chip, "OR",
    gate2(chip, "AND", notOf(chip, s), a),
    gate2(chip, "AND", s, b));
}

// ---------------------------------------------------------------- BIT ----

// BIT-LATCH: célula transparente por nível (EN=1 copia D, EN=0 guarda).
function buildBitLatch() {
  const m = mk("BIT-LATCH", "MEMBIT", ["D", "EN"], ["Q"], 1.4);
  const l = m.sub("D - Latch");
  m.w(m.I.D, l.in(0)); m.w(m.I.EN, l.in(1)); m.w(l.out(0), m.O.Q);
  return m.done();
}

// BIT: 1 bit de memória. Na borda de subida do CLK, grava D se WE=1.
function buildBit() {
  const m = mk("BIT", "MEMBIT", ["D", "WE", "CLK"], ["Q"], 1.4);
  const ff = m.sub("D-FF");
  m.w(mux1(m.chip, m.I.WE, ff.out(0), m.I.D), ff.in(0));
  m.w(m.I.CLK, ff.in(1));
  m.w(ff.out(0), m.O.Q);
  return m.done();
}

// BIT-CLR: BIT com clear síncrono (CLR tem prioridade sobre WE).
function buildBitClr() {
  const m = mk("BIT-CLR", "MEMBIT", ["D", "WE", "CLR", "CLK"], ["Q"], 1.4);
  const ff = m.sub("D-FF");
  const d = mux1(m.chip, m.I.WE, ff.out(0), m.I.D);
  m.w(gate2(m.chip, "AND", notOf(m.chip, m.I.CLR), d), ff.in(0));
  m.w(m.I.CLK, ff.in(1));
  m.w(ff.out(0), m.O.Q);
  return m.done();
}

// BIT-RS: BIT com set e clear síncronos (CLR > SET > WE).
function buildBitRS() {
  const m = mk("BIT-RS", "MEMBIT", ["D", "WE", "SET", "CLR", "CLK"], ["Q"], 1.4);
  const ff = m.sub("D-FF");
  const d = gate2(m.chip, "OR", m.I.SET, mux1(m.chip, m.I.WE, ff.out(0), m.I.D));
  m.w(gate2(m.chip, "AND", notOf(m.chip, m.I.CLR), d), ff.in(0));
  m.w(m.I.CLK, ff.in(1));
  m.w(ff.out(0), m.O.Q);
  return m.done();
}

// BIT-SEL: a célula clássica de RAM — só grava se SEL=1 e só aparece em O
// quando selecionada (O = Q AND SEL, pronto para um barramento OR).
function buildBitSel(clr) {
  const name = clr ? "BIT-SEL-CLR" : "BIT-SEL";
  const ins = clr ? ["D", "SEL", "WE", "CLR", "CLK"] : ["D", "SEL", "WE", "CLK"];
  const m = mk(name, "MEMBIT", ins, ["Q", "O"], 1.6);
  const b = m.sub(clr ? "BIT-CLR" : "BIT");
  m.w(m.I.D, b.in(0));
  m.w(gate2(m.chip, "AND", m.I.WE, m.I.SEL), b.in(1));
  if (clr) { m.w(m.I.CLR, b.in(2)); m.w(m.I.CLK, b.in(3)); }
  else m.w(m.I.CLK, b.in(2));
  m.w(b.out(0), m.O.Q);
  m.w(gate2(m.chip, "AND", b.out(0), m.I.SEL), m.O.O);
  return m.done();
}

// ---------------------------------------------------------- PALAVRA ----

// WREG-B: registrador de B bits com load (WE). WREG-CLR-B: + clear.
function buildWReg(B, clr) {
  const name = clr ? `WREG-CLR-${B}` : `WREG-${B}`;
  const ins = [...seq("D", B), "WE", ...(clr ? ["CLR"] : []), "CLK"];
  const m = mk(name, "MEMWORD", ins, seq("Q", B), 1.8);
  for (let i = 0; i < B; i++) {
    const b = m.sub(clr ? "BIT-CLR" : "BIT");
    m.w(m.I[`D${i}`], b.in(0));
    m.w(m.I.WE, b.in(1));
    if (clr) { m.w(m.I.CLR, b.in(2)); m.w(m.I.CLK, b.in(3)); }
    else m.w(m.I.CLK, b.in(2));
    m.w(b.out(0), m.O[`Q${i}`]);
  }
  return m.done();
}

// WMUX2-B: mux 2:1 de palavra. S=0 -> A, S=1 -> B.
function buildWMux2(B) {
  const m = mk(`WMUX2-${B}`, "MEMWORD", [...seq("A", B), ...seq("B", B), "S"], seq("O", B), 1.8);
  for (let i = 0; i < B; i++) {
    const x = m.sub("MUX-2"); // I0, I1, S0 -> OUT
    m.w(m.I[`A${i}`], x.in(0));
    m.w(m.I[`B${i}`], x.in(1));
    m.w(m.I.S, x.in(2));
    m.w(x.out(0), m.O[`O${i}`]);
  }
  return m.done();
}

// WGATE-B: O = D AND EN em cada bit (máscara / saída habilitada).
function buildWGate(B) {
  const m = mk(`WGATE-${B}`, "MEMWORD", [...seq("D", B), "EN"], seq("O", B), 1.6);
  for (let i = 0; i < B; i++) m.w(gate2(m.chip, "AND", m.I[`D${i}`], m.I.EN), m.O[`O${i}`]);
  return m.done();
}

// WREG-OE-B: registrador cuja saída só aparece com OE=1.
function buildWRegOE(B) {
  const m = mk(`WREG-OE-${B}`, "MEMWORD", [...seq("D", B), "WE", "OE", "CLK"], seq("Q", B), 1.8);
  const r = m.sub(`WREG-${B}`);
  const g = m.sub(`WGATE-${B}`);
  for (let i = 0; i < B; i++) {
    m.w(m.I[`D${i}`], r.in(i));
    m.w(r.out(i), g.in(i));
    m.w(g.out(i), m.O[`Q${i}`]);
  }
  m.w(m.I.WE, r.in(B)); m.w(m.I.CLK, r.in(B + 1));
  m.w(m.I.OE, g.in(B));
  return m.done();
}

// INC de n bits (refs de saída, sem carry). n=1 -> NOT.
function incRefs(m, bits) {
  const n = bits.length;
  if (n === 1) return [notOf(m.chip, bits[0])];
  const inc = m.sub(`INC-${n}`); // A1..An -> S1..Sn, Cout
  bits.forEach((b, i) => m.w(b, inc.in(i)));
  return bits.map((_, i) => inc.out(i));
}

// PTR-n: contador de n bits (ponteiro de endereço). EN incrementa, CLR zera.
function buildPtr(n) {
  const m = mk(`PTR-${n}`, "MEMWORD", ["EN", "CLR", "CLK"], seq("Q", n), 1.8);
  const r = m.sub(`WREG-CLR-${n}`);
  const q = seq("Q", n).map((_, i) => r.out(i));
  incRefs(m, q).forEach((s, i) => m.w(s, r.in(i)));
  m.w(m.I.EN, r.in(n)); m.w(m.I.CLR, r.in(n + 1)); m.w(m.I.CLK, r.in(n + 2));
  q.forEach((s, i) => m.w(s, m.O[`Q${i}`]));
  return m.done();
}

// ADEC-k: decodificador de endereço com enable (k bits -> 2^k linhas),
// recursivo: ADEC-k = 2×ADEC-(k-1) habilitados pelo bit de cima.
function buildADec(k) {
  const W = 1 << k;
  const m = mk(`ADEC-${k}`, "MEMWORD", [...seq("A", k), "EN"], seq("O", W), 1.8);
  const top = m.I[`A${k - 1}`];
  const enLo = gate2(m.chip, "AND", m.I.EN, notOf(m.chip, top));
  const enHi = gate2(m.chip, "AND", m.I.EN, top);
  if (k === 1) {
    m.w(enLo, m.O.O0); m.w(enHi, m.O.O1);
  } else {
    const h = W / 2;
    [enLo, enHi].forEach((en, half) => {
      const d = m.sub(`ADEC-${k - 1}`);
      for (let i = 0; i < k - 1; i++) m.w(m.I[`A${i}`], d.in(i));
      m.w(en, d.in(k - 1));
      for (let j = 0; j < h; j++) m.w(d.out(j), m.O[`O${half * h + j}`]);
    });
  }
  return m.done();
}

// --------------------------------------------------------------- RAM ----

const ramName = (fam, k, B) => `${fam}-${1 << k}x${B}`;

// Divide uma RAM de 2^k palavras em duas metades pelo bit de endereço
// mais alto. `kind`: "RAM" (async), "RAMC" (com CLR), "RAM2P" (end. de
// escrita WA e de leitura RA separados), "REGF" (1 escrita, 2 leituras).
function buildRamRec(kind, k, B) {
  const name = ramName(kind, k, B);
  const wa = kind === "RAM" || kind === "RAMC" ? "A" : "WA";
  const readPorts = kind === "REGF" ? ["RA", "RB"] : kind === "RAM2P" ? ["RA"] : [];
  const outs = kind === "REGF" ? [...seq("OA", B), ...seq("OB", B)] : seq("O", B);
  const ins = [
    ...seq(wa, k),
    ...readPorts.flatMap((p) => seq(p, k)),
    ...seq("D", B), "WE", ...(kind === "RAMC" ? ["CLR"] : []), "CLK"
  ];
  const m = mk(name, "RAM", ins, outs, 2.2);
  const top = m.I[`${wa}${k - 1}`];
  const weLo = gate2(m.chip, "AND", m.I.WE, notOf(m.chip, top));
  const weHi = gate2(m.chip, "AND", m.I.WE, top);

  // Metades: k=1 -> registradores de palavra; senão a RAM de k-1.
  const halves = [weLo, weHi].map((we) => {
    if (k === 1) {
      const r = m.sub(kind === "RAMC" ? `WREG-CLR-${B}` : `WREG-${B}`);
      for (let i = 0; i < B; i++) m.w(m.I[`D${i}`], r.in(i));
      m.w(we, r.in(B));
      if (kind === "RAMC") { m.w(m.I.CLR, r.in(B + 1)); m.w(m.I.CLK, r.in(B + 2)); }
      else m.w(m.I.CLK, r.in(B + 1));
      const q = seq("Q", B).map((_, i) => r.out(i));
      return { ports: readPorts.length ? readPorts.map(() => q) : [q] };
    }
    const s = m.sub(ramName(kind, k - 1, B));
    let p = 0;
    for (let i = 0; i < k - 1; i++) m.w(m.I[`${wa}${i}`], s.in(p++));
    for (const rp of readPorts) for (let i = 0; i < k - 1; i++) m.w(m.I[`${rp}${i}`], s.in(p++));
    for (let i = 0; i < B; i++) m.w(m.I[`D${i}`], s.in(p++));
    m.w(we, s.in(p++));
    if (kind === "RAMC") m.w(m.I.CLR, s.in(p++));
    m.w(m.I.CLK, s.in(p++));
    const nPorts = Math.max(1, readPorts.length);
    return {
      ports: Array.from({ length: nPorts }, (_, r) =>
        Array.from({ length: B }, (_, i) => s.out(r * B + i)))
    };
  });

  // Leitura: um mux de palavra por porta, selecionado pelo bit de cima do
  // endereço daquela porta.
  const selects = readPorts.length ? readPorts.map((p) => m.I[`${p}${k - 1}`]) : [top];
  const outPref = kind === "REGF" ? ["OA", "OB"] : ["O"];
  selects.forEach((sel, r) => {
    const mx = m.sub(`WMUX2-${B}`);
    for (let i = 0; i < B; i++) {
      m.w(halves[0].ports[r][i], mx.in(i));
      m.w(halves[1].ports[r][i], mx.in(B + i));
      m.w(mx.out(i), m.O[`${outPref[r]}${i}`]);
    }
    m.w(sel, mx.in(2 * B));
  });
  return m.done();
}

// RAMS: leitura síncrona — a saída é um registrador que captura a palavra
// endereçada na borda do CLK quando RE=1 (como uma block-RAM de FPGA).
function buildRamSync(k, B) {
  const m = mk(ramName("RAMS", k, B), "RAMPLUS",
    [...seq("A", k), ...seq("D", B), "WE", "RE", "CLK"], seq("O", B), 2.2);
  const ram = m.sub(ramName("RAM", k, B));
  const out = m.sub(`WREG-${B}`);
  let p = 0;
  for (let i = 0; i < k; i++) m.w(m.I[`A${i}`], ram.in(p++));
  for (let i = 0; i < B; i++) m.w(m.I[`D${i}`], ram.in(p++));
  m.w(m.I.WE, ram.in(p++)); m.w(m.I.CLK, ram.in(p++));
  for (let i = 0; i < B; i++) {
    m.w(ram.out(i), out.in(i));
    m.w(out.out(i), m.O[`O${i}`]);
  }
  m.w(m.I.RE, out.in(B)); m.w(m.I.CLK, out.in(B + 1));
  return m.done();
}

// RAMCS: chip-select — CS=0 bloqueia escrita e zera a saída (para ligar
// vários bancos num barramento OR e montar memórias maiores).
function buildRamCS(k, B) {
  const m = mk(ramName("RAMCS", k, B), "RAMPLUS",
    [...seq("A", k), ...seq("D", B), "WE", "CS", "CLK"], seq("O", B), 2.2);
  const ram = m.sub(ramName("RAM", k, B));
  const g = m.sub(`WGATE-${B}`);
  let p = 0;
  for (let i = 0; i < k; i++) m.w(m.I[`A${i}`], ram.in(p++));
  for (let i = 0; i < B; i++) m.w(m.I[`D${i}`], ram.in(p++));
  m.w(gate2(m.chip, "AND", m.I.WE, m.I.CS), ram.in(p++));
  m.w(m.I.CLK, ram.in(p++));
  for (let i = 0; i < B; i++) { m.w(ram.out(i), g.in(i)); m.w(g.out(i), m.O[`O${i}`]); }
  m.w(m.I.CS, g.in(B));
  return m.done();
}

// Liga uma RAM2P (WA, RA, D, WE, CLK -> O) e devolve as refs de saída.
function ram2p(m, k, B, waRefs, raRefs, dRefs, we) {
  const r = m.sub(ramName("RAM2P", k, B));
  let p = 0;
  waRefs.forEach((x) => m.w(x, r.in(p++)));
  raRefs.forEach((x) => m.w(x, r.in(p++)));
  dRefs.forEach((x) => m.w(x, r.in(p++)));
  m.w(we, r.in(p++));
  m.w(m.I.CLK, r.in(p++));
  return Array.from({ length: B }, (_, i) => r.out(i));
}

// STACK (LIFO): PUSH grava D no topo, POP descarta o topo; O mostra o topo.
// SP tem k+1 bits: EMPTY = SP==0, FULL = SP==W. PUSH tem prioridade.
function buildStack(k, B) {
  const n = k + 1;
  const m = mk(ramName("STACK", k, B), "STACKFIFO",
    [...seq("D", B), "PUSH", "POP", "RST", "CLK"], [...seq("O", B), "EMPTY", "FULL"], 2.2);
  const c = m.chip;
  const sp = m.sub(`WREG-CLR-${n}`);
  const s = Array.from({ length: n }, (_, i) => sp.out(i));
  const full = s[k];
  const empty = notOf(c, reduce(c, "OR", s));
  const inc = m.sub(`INC-${n}`);
  const dec = m.sub(`DEC-${n}`);
  s.forEach((b, i) => { m.w(b, inc.in(i)); m.w(b, dec.in(i)); });
  const pushOK = gate2(c, "AND", m.I.PUSH, notOf(c, full));
  const popOK = gate2(c, "AND", gate2(c, "AND", m.I.POP, notOf(c, m.I.PUSH)), notOf(c, empty));
  const nx = m.sub(`WMUX2-${n}`);
  for (let i = 0; i < n; i++) {
    m.w(dec.out(i), nx.in(i));
    m.w(inc.out(i), nx.in(n + i));
    m.w(nx.out(i), sp.in(i));
  }
  m.w(m.I.PUSH, nx.in(2 * n));
  m.w(gate2(c, "OR", pushOK, popOK), sp.in(n));
  m.w(m.I.RST, sp.in(n + 1));
  m.w(m.I.CLK, sp.in(n + 2));
  const o = ram2p(m, k, B, s.slice(0, k),
    Array.from({ length: k }, (_, i) => dec.out(i)),
    seq("D", B).map((x) => m.I[x]), pushOK);
  o.forEach((x, i) => m.w(x, m.O[`O${i}`]));
  m.w(empty, m.O.EMPTY);
  m.w(full, m.O.FULL);
  return m.done();
}

// FIFO: WR enfileira D, RD descarta a cabeça; O mostra a cabeça.
// Ponteiros de k+1 bits: iguais = vazio; só o bit de cima diferente = cheio.
function buildFifo(k, B) {
  const n = k + 1;
  const m = mk(ramName("FIFO", k, B), "STACKFIFO",
    [...seq("D", B), "WR", "RD", "RST", "CLK"], [...seq("O", B), "EMPTY", "FULL"], 2.2);
  const c = m.chip;
  const wp = m.sub(`PTR-${n}`);
  const rp = m.sub(`PTR-${n}`);
  const w = Array.from({ length: n }, (_, i) => wp.out(i));
  const r = Array.from({ length: n }, (_, i) => rp.out(i));
  const diffLow = reduce(c, "OR", w.slice(0, k).map((x, i) => gate2(c, "XOR", x, r[i])));
  const msbDiff = gate2(c, "XOR", w[k], r[k]);
  const empty = notOf(c, gate2(c, "OR", diffLow, msbDiff));
  const full = gate2(c, "AND", notOf(c, diffLow), msbDiff);
  const wrOK = gate2(c, "AND", m.I.WR, notOf(c, full));
  const rdOK = gate2(c, "AND", m.I.RD, notOf(c, empty));
  [[wp, wrOK], [rp, rdOK]].forEach(([p, en]) => {
    m.w(en, p.in(0)); m.w(m.I.RST, p.in(1)); m.w(m.I.CLK, p.in(2));
  });
  const o = ram2p(m, k, B, w.slice(0, k), r.slice(0, k), seq("D", B).map((x) => m.I[x]), wrOK);
  o.forEach((x, i) => m.w(x, m.O[`O${i}`]));
  m.w(empty, m.O.EMPTY);
  m.w(full, m.O.FULL);
  return m.done();
}

// DLINE: linha de atraso circular. A cada CLK com EN=1 grava D e avança;
// O é o valor gravado W escritas atrás.
function buildDLine(k, B) {
  const m = mk(ramName("DLINE", k, B), "STACKFIFO",
    [...seq("D", B), "EN", "RST", "CLK"], seq("O", B), 2.2);
  const p = m.sub(`PTR-${k}`);
  m.w(m.I.EN, p.in(0)); m.w(m.I.RST, p.in(1)); m.w(m.I.CLK, p.in(2));
  const a = Array.from({ length: k }, (_, i) => p.out(i));
  const o = ram2p(m, k, B, a, a, seq("D", B).map((x) => m.I[x]), m.I.EN);
  o.forEach((x, i) => m.w(x, m.O[`O${i}`]));
  return m.done();
}

function generate() {
  const out = [];
  out.push(buildBitLatch(), buildBit(), buildBitClr(), buildBitRS(),
    buildBitSel(false), buildBitSel(true));
  for (const B of WIDTHS) {
    out.push(buildWReg(B, false), buildWReg(B, true), buildWMux2(B), buildWGate(B), buildWRegOE(B));
  }
  for (let n = 1; n <= PTR_MAX; n++) out.push(buildPtr(n));
  for (let k = 1; k <= ADEC_MAX; k++) out.push(buildADec(k));
  // Por k crescente: cada RAM-k usa a RAM-(k-1) já gerada.
  for (let k = 1; k <= MAX_K; k++) {
    for (const B of WIDTHS) {
      out.push(buildRamRec("RAM", k, B), buildRamRec("RAMC", k, B),
        buildRamRec("RAM2P", k, B), buildRamRec("REGF", k, B),
        buildRamSync(k, B), buildRamCS(k, B),
        buildStack(k, B), buildFifo(k, B));
      if (k <= DLINE_MAX_K) out.push(buildDLine(k, B));
    }
  }
  return out;
}

module.exports = { generate };
