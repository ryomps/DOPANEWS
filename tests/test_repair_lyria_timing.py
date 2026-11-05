import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('repair', Path(__file__).resolve().parents[1]/'tools/repair_lyria_timing.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class WordAlignmentTests(unittest.TestCase):
    def test_actual_words_override_uniform_grid_and_keep_confirmed_start(self):
        words = [{'word': '猫が歩く', 'start': 10., 'end': 12.8},
                 {'word': '犬が走る', 'start': 13.1, 'end': 16.2}]
        result = repair.align_lines(['猫が歩く', '犬が走る'], words, 10.2, 20.)
        self.assertEqual(result[0]['start'], 10.2)
        self.assertEqual(result[1]['start'], 13.1)
        self.assertEqual(result[1]['end'], 16.2)

    def test_unrelated_intro_and_next_verse_are_excluded(self):
        words = [{'word': '猫が歩く', 'start': 1., 'end': 3.},
                 {'word': '猫が歩く', 'start': 10., 'end': 12.},
                 {'word': '猫が歩く', 'start': 30., 'end': 32.}]
        result = repair.align_lines(['猫が歩く'], words, 10., 20.)
        self.assertEqual((result[0]['start'], result[0]['end']), (10., 12.))

    def test_missing_words_stop_before_editing(self):
        with self.assertRaises(ValueError):
            repair.align_lines(['猫が歩く', '犬が走る'], [{'word': '無関係', 'start': 10., 'end': 12.}], 10., 20.)


if __name__ == '__main__':
    unittest.main()
