"""Re-serializa os chips no formato do projeto, sem tocar em nada do conteudo.

Dois estilos:
  pretty  (padrao do repo / de HEAD):  json.dumps(indent=2, ensure_ascii=False),
                                      sem newline final
  compact (o que o proprio DLS grava): separadores ":" e "," sem espaco

A passada de estilo original gravou pretty e ficou tudo bem; o experimento
compact chegou a reduzir 520->259 MB em disco, mas quebra o `git diff` (cada
chip vira uma linha unica, impossivel de revisar) e sai da convencao commitada.
Entao o padrao aqui e RESTAURAR pretty.

Em ambos os casos a prova e: o objeto python re-lido do arquivo novo e
IDENTICO ao lido do arquivo atual.
"""
import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
CHIPS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Chips")


def dumps(d, style):
    if style == "compact":
        return json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    return json.dumps(d, indent=2, ensure_ascii=False)


def one(name, style):
    p = os.path.join(CHIPS, name + ".json")
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        out = dumps(d, style)
        if json.loads(out) != d:
            return {"name": name, "status": "roundtrip-diferente"}
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(out)
        return {"name": name, "status": "ok"}
    except Exception as e:
        return {"name": name, "status": "error", "err": f"{type(e).__name__}: {e}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", choices=["pretty", "compact"], default="pretty")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    names = sorted(f[:-5] for f in os.listdir(CHIPS) if f.endswith(".json"))
    if args.limit:
        names = names[:args.limit]
    t0 = time.time()
    stats, errs, done = {}, [], 0
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        futs = [ex.submit(one, n, args.style) for n in names]
        for fut in as_completed(futs):
            r = fut.result()
            stats[r["status"]] = stats.get(r["status"], 0) + 1
            if r["status"] == "error":
                errs.append((r["name"], r["err"]))
            done += 1
            if done % 5000 == 0 or done == len(names):
                el = time.time() - t0
                print(f"  {done}/{len(names)}  {stats}  {done / el:.0f} chips/s",
                      flush=True)
    tot = sum(os.path.getsize(os.path.join(CHIPS, n + ".json")) for n in names)
    print(f"\ntempo {time.time() - t0:.1f}s | estilo={args.style} | "
          f"{len(names)} chips | {tot / 1e6:.0f} MB | {stats}")
    for n, e in errs[:20]:
        print("  ERRO", n, e)


if __name__ == "__main__":
    main()
