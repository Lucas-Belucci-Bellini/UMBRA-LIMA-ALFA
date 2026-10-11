// test-display7.js — confere BIN2BCD-4..13 (exaustivo) e a ligação de cada
// dígito dos displays de vários dígitos (BCD e BIN). Uso: node tools/test-display7.js
const { evalChip, loadChip } = require("./simulate");
let bad = 0, cases = 0;
// 1) BIN2BCD-n exaustivo (n até 13 = 8192 valores)
for (let n = 4; n <= 13; n++) {
  const nd = String(2 ** n - 1).length;
  for (let v = 0; v < 2 ** n; v++) {
    const o = evalChip(`BIN2BCD-${n}`, Array.from({ length: n }, (_, i) => (v >> i) & 1));
    let got = "";
    for (let d = nd - 1; d >= 0; d--) got += o[4 * d] + 2 * o[4 * d + 1] + 4 * o[4 * d + 2] + 8 * o[4 * d + 3];
    cases++; if (got !== String(v).padStart(nd, "0")) { bad++; if (bad < 5) console.log("BIN2BCD", n, v, got); }
  }
}
// 2) cada display de vários dígitos: o dígito na posição k (esquerda->direita,
// pela posição x do Displays) recebe exatamente D,C,B,A do dígito certo.
function digitFeeds(name) {
  const c = loadChip(name);
  const subs = Object.fromEntries(c.SubChips.map((s) => [s.ID, s]));
  const inName = Object.fromEntries(c.InputPins.map((p) => [p.ID, p.Name]));
  const dsp = loadChip("DISPLAY 7-SEG");
  const order = [...c.Displays].sort((a, b) => a.Position.x - b.Position.x).map((d) => d.SubChipID);
  return order.map((id) => dsp.InputPins.map((p) => {
    const w = c.Wires.find((w) => w.TargetPinAddress.PinOwnerID === id && w.TargetPinAddress.PinID === p.ID);
    const src = w.SourcePinAddress.PinOwnerID;
    if (inName[src] !== undefined) return { pin: inName[src] };
    const s = subs[src]; const ref = loadChip(s.Name);
    return { sub: s.Name, out: ref.OutputPins.findIndex((op) => op.ID === w.SourcePinAddress.PinID) };
  }));
}
for (const N of [2, 3, 4]) {
  const f = digitFeeds(`DISPLAY ${N}-DIG BCD`);
  const pref = ["M", "C", "D", "U"].slice(4 - N);
  f.forEach((dig, k) => dig.forEach((x, j) => { cases++; if (x.pin !== `${pref[k]}-${"DCBA"[j]}`) { bad++; console.log(N, k, j, x); } }));
}
for (let n = 4; n <= 13; n++) {
  const nd = String(2 ** n - 1).length;
  const f = digitFeeds(`DISPLAY BIN-${n}`);
  if (f.length !== nd) { bad++; console.log("ndig", n); }
  const c = loadChip(`DISPLAY BIN-${n}`);
  // entradas B(n-1)..B0 em ordem; checa que o conversor recebe B_i no pino i
  const conv = c.SubChips.find((s) => s.Name === `BIN2BCD-${n}`); const cref = loadChip(conv.Name);
  cref.InputPins.forEach((p, i) => {
    const w = c.Wires.find((w) => w.TargetPinAddress.PinOwnerID === conv.ID && w.TargetPinAddress.PinID === p.ID);
    const nm = c.InputPins.find((ip) => ip.ID === w.SourcePinAddress.PinOwnerID).Name;
    cases++; if (nm !== `B${i}`) { bad++; console.log("conv in", n, i, nm); }
  });
  f.forEach((dig, k) => dig.forEach((x, j) => {
    const exp = 4 * (nd - 1 - k) + (3 - j); // D,C,B,A = bits 3..0 do dígito
    cases++; if (x.sub !== conv.Name || x.out !== exp) { bad++; console.log(n, k, j, x, exp); }
  }));
}
console.log(`casos ${cases}, erros ${bad}`);
process.exit(bad ? 1 : 0);
