"""Regressoes do simulador combinacional, sem gravar chips.

Confere DAGs contra um modelo independente, ordem de barramentos, hierarquia,
displays, pinos ausentes e drivers duplicados. Conta comparacoes de IDs para
impedir a volta da varredura quadratica, sem depender do tempo da maquina.
    python tools/ai_style/dbg_dlssim.py
"""
import copy
import itertools
import random
import unittest
from unittest.mock import patch

from build_ram import Builder
import dlssim as S


def builder(name):
    return Builder(name, (0.3, 0.5, 0.6))


class CountedOwner(int):
    comparisons = 0
    __hash__ = int.__hash__

    def __eq__(self, other):
        type(self).comparisons += 1
        return super().__eq__(other)


class DlsSimTest(unittest.TestCase):
    def setUp(self):
        for name in ("EXTRA", "_cache", "_memo", "_has_disp", "NET"):
            patcher = patch.object(S, name, {})
            patcher.start()
            self.addCleanup(patcher.stop)
        for name, value in (("NET_ON", False), ("DISPLAY_LOG", [])):
            patcher = patch.object(S, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def register(self, b):
        d = b.save(write=False)
        S.EXTRA[d["Name"]] = d
        return d

    def test_random_dags_match_independent_model(self):
        rng = random.Random(1701)
        for case in range(8):
            b = builder("DAG-" + str(case))
            inputs = [b.in_pin("I" + str(i)) for i in range(4)]
            sources = [(pin, 0) for pin in inputs]
            gates = []
            for _ in range(70):
                a, c = rng.choice(sources), rng.choice(sources)
                out = b.nand(a, c)
                gates.append((a, c, out))
                sources.append(out)
            outputs = {}
            for i, source in enumerate(sources[-12:]):
                pin = b.out_pin("O" + str(i))
                b.wire(source, (pin, 0))
                outputs[pin] = source
            d = self.register(b)
            d["SubChips"].reverse()
            rng.shuffle(d["Wires"])
            before = copy.deepcopy(d)
            for bits in itertools.product((0, 1), repeat=4):
                values = {(pin, 0): bit for pin, bit in zip(inputs, bits)}
                for a, c, out in gates:
                    values[out] = int(not (values[a] and values[c]))
                expected = {pin: values[source] for pin, source in outputs.items()}
                with self.subTest(case=case, bits=bits):
                    self.assertEqual(S.run(d["Name"], dict(zip(inputs, bits))), expected)
            self.assertEqual(d, before, "a simulacao alterou o netlist")

    def test_bus_pin_order(self):
        for width in (4, 8):
            b = builder("BUS-" + str(width))
            pin = b.in_pin("A", width)
            split = b.sub(str(width) + "-1BIT")
            merge = b.sub("1-" + str(width) + "BIT")
            b.wire((pin, 0), (split, 0))
            for i in range(width):
                b.wire((split, 1 + i), (merge, width - 1 - i))
            out = b.out_pin("REVERSE", width)
            b.wire((merge, width), (out, 0))
            d = self.register(b)
            d["SubChips"].reverse()
            for value in range(1 << width):
                expected = int(format(value, "0" + str(width) + "b")[::-1], 2)
                self.assertEqual(S.run(d["Name"], {pin: value}), {out: expected})

    def test_hierarchy_and_memoized_child(self):
        child = builder("CHILD")
        pin = child.in_pin("D")
        source = child.inv((pin, 0))
        out = child.out_pin("Q")
        child.wire(source, (out, 0))
        # Como um chip carregado do disco: pode usar memo, sem criar arquivo.
        S._cache[child.name] = child.save(write=False)
        b = builder("PARENT")
        a = b.in_pin("A")
        first, second = b.sub(child.name), b.sub(child.name)
        b.wire((a, 0), (first, pin))
        b.wire((first, out), (second, pin))
        q = b.out_pin("Q")
        b.wire((second, out), (q, 0))
        d = self.register(b)
        d["SubChips"].reverse()
        for value in (0, 1, 0, 1):
            self.assertEqual(S.run(d["Name"], {a: value}), {q: value})
        self.assertEqual(len(S._memo), 2)

    def test_unwired_pins_and_duplicate_wire(self):
        b = builder("DEFAULTS")
        a, c = b.in_pin("A"), b.in_pin("B")
        gate = b.sub("NAND")
        q, floating = b.out_pin("Q"), b.out_pin("FLOATING")
        b.wire((a, 0), (gate, 0))
        b.wire((a, 0), (gate, 0))  # repeticao da MESMA fonte e aceita
        b.wire((gate, 2), (q, 0))
        d = self.register(b)
        self.assertEqual(S.run(d["Name"], {}), {q: 1, floating: None})
        self.assertEqual(S.run(d["Name"], {a: 1}), {q: 1, floating: None})
        d["Wires"].append(copy.deepcopy(d["Wires"][0]))
        d["Wires"][-1]["SourcePinAddress"]["PinOwnerID"] = c
        with self.assertRaisesRegex(RuntimeError, "driven twice"):
            S.run(d["Name"], {})

    def test_duplicate_output_driver_rejected(self):
        b = builder("BAD-OUTPUT")
        a, c, q = b.in_pin("A"), b.in_pin("B"), b.out_pin("Q")
        b.wire((a, 0), (q, 0))
        b.wire((c, 0), (q, 0))
        d = self.register(b)
        with self.assertRaisesRegex(RuntimeError, "driven twice"):
            S.run(d["Name"], {a: 0, c: 1})

    def test_displays_and_net_log(self):
        b = builder("TRACE")
        a = b.in_pin("A")
        source = b.inv((a, 0))
        display, led, buzzer = b.sub("7-SEGMENT"), b.sub("LED"), b.sub("BUZZER")
        for pin in range(7):
            b.wire(source, (display, pin))
        for sid in (led, buzzer):
            b.wire(source, (sid, 0))
        orphan = b.sub("NAND")  # ate subchips sem fanout sao avaliados
        q = b.out_pin("Q")
        b.wire(source, (q, 0))
        d = self.register(b)
        S.NET_ON = True
        for value in (0, 1):
            S.NET.clear()
            S.DISPLAY_LOG.clear()
            prefix = "/instance-" + str(value)
            self.assertEqual(S.run(d["Name"], {a: value}, prefix), {q: 1 - value})
            self.assertEqual(S.NET[prefix], {a: value})
            self.assertEqual(S.NET[prefix + "/NAND#" + str(source[0])], {2: 1 - value})
            self.assertEqual(S.NET[prefix + "/NAND#" + str(orphan)], {2: 1})
            self.assertEqual(S.DISPLAY_LOG, [(prefix + "/7-SEGMENT#" + str(display),
                                             (1 - value,) * 7)])
            self.assertIn(prefix + "/LED#" + str(led), S.NET)
            self.assertIn(prefix + "/BUZZER#" + str(buzzer), S.NET)

    def test_driver_lookup_is_not_quadratic(self):
        b = builder("LOOKUP")
        a = b.in_pin("A")
        for _ in range(256):
            source = b.inv((a, 0))
        q = b.out_pin("Q")
        b.wire(source, (q, 0))
        d = self.register(b)
        for wire in d["Wires"]:
            target = wire["TargetPinAddress"]
            target["PinOwnerID"] = CountedOwner(target["PinOwnerID"])
        CountedOwner.comparisons = 0
        self.assertEqual(S.run(d["Name"], {a: 1}), {q: 0})
        size = len(d["Wires"]) + len(d["SubChips"])
        self.assertLess(CountedOwner.comparisons, 16 * size,
                        "cada subchip voltou a percorrer todos os drivers")


if __name__ == "__main__":
    unittest.main(verbosity=2)
