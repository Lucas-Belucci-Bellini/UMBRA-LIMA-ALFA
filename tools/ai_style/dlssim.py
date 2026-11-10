"""Minimal combinational simulator for Digital Logic Sim 2 chip JSON files."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))  # tools/ai_style -> tools -> project
CHIPS = os.environ.get("DLS_CHIPS", os.path.join(PROJECT, "Chips"))
EXTRA = {}  # name -> description (not yet written to disk)
_cache = {}


def load(name):
    if name in EXTRA:
        return EXTRA[name]
    if name not in _cache:
        with open(os.path.join(CHIPS, name + ".json"), encoding="utf-8-sig") as f:
            _cache[name] = json.load(f)
    return _cache[name]


def builtin(name, ins):
    if name == "NAND":
        return {2: 0 if (ins.get(0, 0) and ins.get(1, 0)) else 1}
    if name == "8-1BIT":
        v = ins.get(0, 0)
        return {1 + i: (v >> (7 - i)) & 1 for i in range(8)}
    if name == "4-1BIT":
        v = ins.get(0, 0)
        return {1 + i: (v >> (3 - i)) & 1 for i in range(4)}
    if name == "1-8BIT":
        return {8: sum((ins.get(i, 0) & 1) << (7 - i) for i in range(8))}
    if name == "1-4BIT":
        return {4: sum((ins.get(i, 0) & 1) << (3 - i) for i in range(4))}
    if name == "7-SEGMENT":
        return {}
    if name in ("LED", "BUZZER"):
        # Somente terminal: consome uma rede e nao tem saida. Modelar como
        # no-op e exato para qualquer assinatura que so dependa de saidas/displays.
        return {}
    return None


DISPLAY_LOG = []
_memo = {}
_has_disp = {}

# Quando NET_ON, NET[caminho_da_instancia] = {pinID: valor} para cada subchip
# avaliado, e NET[""] = entradas do chip raiz. Serve para o renderizador
# desenhar os fios no estado vivo (aceso/apagado) igual ao jogo.
NET = {}
NET_ON = False


def has_display(name):
    if name in _has_disp:
        return _has_disp[name]
    if name == "7-SEGMENT":
        return True
    if builtin(name, {}) is not None:
        return False
    _has_disp[name] = False
    _has_disp[name] = any(has_display(s["Name"]) for s in load(name)["SubChips"])
    return _has_disp[name]


def run(name, ins, path=""):
    if name not in EXTRA and builtin(name, {}) is None and not has_display(name):
        key = (name, tuple(sorted(ins.items())))
        if key not in _memo:
            _memo[key] = _run(name, ins, path)
        return _memo[key]
    return _run(name, ins, path)


def _run(name, ins, path=""):
    if NET_ON:
        NET[path] = dict(ins)
    b = builtin(name, ins)
    if b is not None:
        if name == "7-SEGMENT":
            DISPLAY_LOG.append((path, tuple(ins.get(i, 0) for i in range(7))))
        return b
    d = load(name)
    in_ids = {p["ID"] for p in d["InputPins"]}
    subs = {s["ID"]: s for s in d["SubChips"]}
    # Indice local por dono -> pino -> fonte: cada subchip visita apenas suas
    # entradas, em vez de varrer todos os fios a cada avaliacao (custo quadratico).
    drv = {}
    for w in d["Wires"]:
        s, t = w["SourcePinAddress"], w["TargetPinAddress"]
        owner, pin = t["PinOwnerID"], t["PinID"]
        inputs = drv.setdefault(owner, {})
        source = (s["PinOwnerID"], s["PinID"])
        if pin in inputs and inputs[pin] != source:
            raise RuntimeError(f"{name}: pin {(owner, pin)} driven twice")
        inputs[pin] = source
    sub_out = {}

    def val(owner, pin):
        if owner in in_ids:
            return ins.get(owner, 0)
        if owner not in sub_out:
            evaluate(owner)
        return sub_out[owner][pin]

    def evaluate(sid):
        sins = {p: val(*src) for p, src in drv.get(sid, {}).items()}
        sub_out[sid] = run(subs[sid]["Name"], sins, path + "/" + subs[sid]["Name"] + "#" + str(sid))
        if NET_ON:
            NET[path + "/" + subs[sid]["Name"] + "#" + str(sid)] = dict(sub_out[sid])

    for sid in subs:
        if sid not in sub_out:
            evaluate(sid)
    res = {}
    for p in d["OutputPins"]:
        src = drv.get(p["ID"], {}).get(0)
        res[p["ID"]] = val(*src) if src else None
    return res


def pins(name):
    d = load(name)
    return [(p["Name"], p["ID"]) for p in d["InputPins"]], [(p["Name"], p["ID"]) for p in d["OutputPins"]]
