// logic.js — helpers de construção lógica reaproveitados pelos geradores.
// Todos recebem o `chip` e devolvem refs de pino (compatíveis com wire()).

const { addSubChip, wire } = require("./chip-builder");
const registry = require("./pin-registry");

let _laneY = 0;
function nextY() { _laneY -= 0.35; return _laneY; }

// NOT(ref) -> out ref
function notOf(chip, ref, x) {
  const n = addSubChip(chip, "NOT", registry.KNOWN, {
    position: { x: x == null ? 0 : x, y: nextY() }
  });
  wire(chip, ref, n.in(0));
  return n.out(0);
}

// gate2(base, a, b) -> out ref.  base ∈ {AND,OR,XOR,NOR}
function gate2(chip, base, a, b, x) {
  const g = addSubChip(chip, base, registry.KNOWN, {
    position: { x: x == null ? 0 : x, y: nextY() }
  });
  wire(chip, a, g.in(0));
  wire(chip, b, g.in(1));
  return g.out(0);
}

// Reduz uma lista de refs com um gate associativo (AND/OR/XOR) em árvore
// balanceada. Retorna o ref final. Lista vazia -> erro; 1 item -> ele mesmo.
function reduce(chip, base, refs, x) {
  if (refs.length === 0) throw new Error("reduce: lista vazia");
  let level = refs.slice();
  let col = x == null ? 0 : x;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(gate2(chip, base, level[i], level[i + 1], col));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
    col += 1.5;
  }
  return level[0];
}

// Decodifica K bits de seleção em 2^K minterms one-hot.
// selectRefs[0] é o bit menos significativo.
// Retorna array de 2^K refs (índice = valor binário).
function decodeSelect(chip, selectRefs, x) {
  const k = selectRefs.length;
  const col = x == null ? -4 : x;
  const perBit = selectRefs.map((s) => [notOf(chip, s, col), s]);
  const n = 1 << k;
  const minterms = [];
  for (let j = 0; j < n; j++) {
    const terms = [];
    for (let b = 0; b < k; b++) {
      const bit = (j >> b) & 1;
      terms.push(perBit[b][bit]);
    }
    if (terms.length === 1) {
      minterms.push(terms[0]);
    } else {
      minterms.push(reduce(chip, "AND", terms, col + 2));
    }
  }
  return minterms;
}

module.exports = { notOf, gate2, reduce, decodeSelect };
