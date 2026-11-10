"""Regressao: testes da calculadora nao podem gravar ou achatar Chips/.

Executa os dois CLIs com open() proibido para escrita, confere hashes/mtime
dos 12 chips e verifica --write numa pasta temporaria. Tanto a bateria
aritmetica quanto o roteiro de teclas sao executados completos, sem substituir
o simulador nem os testes por resultados artificiais.
    python tools/ai_style/dbg_calc_no_write.py
"""
import builtins
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_calc as BC
import build_calc2 as B2
import build_ram as BR

NAMES = ["DFF", "REG-17", "ADD-17", "MUL-17", "DIV-17", "SQRT-17", "DD-17",
         "CALC-ALU", "CALC-KEYPAD", "CALC-CORE", "BCD-SEG", "CALC CIENTIFICA"]


def snapshot():
    result = {}
    for name in NAMES:
        path = Path(BR.CHIPS) / (name + ".json")
        result[name] = (hashlib.sha256(path.read_bytes()).hexdigest(),
                        path.stat().st_mtime_ns)
    return result


class NoWriteTest(unittest.TestCase):
    def test_builder_write_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(BR, "CHIPS", tmp):
            builder = BR.Builder("TEST", (0.3, 0.5, 0.6))
            builder.in_pin("A")
            desc = builder.save(write=False)
            path = Path(tmp) / "TEST.json"
            self.assertFalse(path.exists())
            self.assertEqual(builder.save(), desc)   # compatibilidade RAM/GPU
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), desc)

    def test_dry_runs_do_not_open_for_write(self):
        before = snapshot()
        real_open = builtins.open

        def read_only(file, mode="r", *args, **kwargs):
            if any(flag in mode for flag in "wax+"):
                raise AssertionError("dry-run tentou gravar: " + str(file))
            return real_open(file, mode, *args, **kwargs)

        with patch("builtins.open", side_effect=read_only):
            for module in (BC, B2):
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(module.main(False), 0)
        self.assertEqual(snapshot(), before, "dry-run alterou netlist ou mtime")

    def test_write_includes_dependencies_and_displays(self):
        before = snapshot()
        with tempfile.TemporaryDirectory() as tmp, patch.object(B2, "CHIPS", tmp):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(B2.main(True), 0)
            paths = list(Path(tmp).glob("*.json"))
            self.assertEqual({p.stem for p in paths}, set(NAMES))
            for path in paths:
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")),
                                 B2.REG[path.stem])
            top = json.loads((Path(tmp) / "CALC CIENTIFICA.json").read_text(
                encoding="utf-8"))
            self.assertEqual(len(top["Displays"]), 5)
        self.assertEqual(snapshot(), before, "--write temporario alterou Chips/")


if __name__ == "__main__":
    unittest.main(verbosity=2)
