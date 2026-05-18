// router.js — roteamento ortogonal dos fios.
// Calcula o array Points de cada wire: fios alinhados ficam retos; fios
// desalinhados viram H->V->H (ângulo reto) por um canal vertical.
// Formato Points: [{0,0}, ...curvas..., {0,0}] — o DLS substitui os {0,0}
// das pontas pela posição real do pino (confirmado nos chips do Lucas).

const ALIGNED_EPS = 0.05; // tolerância p/ considerar pinos alinhados

function route(chip, pinXY) {
  // canal por par de colunas, escalonado p/ os fios não se sobreporem
  const channelUse = {};

  chip.Wires.forEach((w) => {
    const s = pinXY(w.SourcePinAddress, true);
    const t = pinXY(w.TargetPinAddress, false);

    if (Math.abs(s.y - t.y) < ALIGNED_EPS) {
      // alinhados -> fio reto
      w.Points = [{ x: 0.0, y: 0.0 }, { x: 0.0, y: 0.0 }];
      return;
    }

    // canal vertical entre origem e destino
    const lo = Math.min(s.x, t.x);
    const hi = Math.max(s.x, t.x);
    const key = `${Math.round(lo)}_${Math.round(hi)}`;
    const n = channelUse[key] || 0;
    channelUse[key] = n + 1;

    let chX;
    if (hi - lo > 0.5) {
      // escalona o canal dentro do vão entre as colunas
      const span = hi - lo;
      const frac = 0.3 + ((n % 6) / 6) * 0.45;
      chX = lo + span * frac;
    } else {
      // origem e destino quase na mesma coluna (ex.: realimentação)
      chX = hi + 1.0 + (n % 5) * 0.4;
    }

    w.Points = [
      { x: 0.0, y: 0.0 },
      { x: chX, y: s.y },
      { x: chX, y: t.y },
      { x: 0.0, y: 0.0 }
    ];
  });
}

module.exports = { route };
