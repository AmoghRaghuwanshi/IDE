"""End-to-end tests: real compilers/interpreters, real input, actual trace values."""
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'src' / 'main' / 'execution'
CPP = '''#include <iostream>
using namespace std;
int add(int value, int other)
{
    int result = value + other;
    return result;
}
int main()
{
    int n, arr[3], sum = 0;
    cout << "Count: ";
    cin >> n;
    for (int i = 0; i < n; i++)
    {
        cin >> arr[i];
    }
    for (int j = 0; j < n; j++)
    {
        sum = add(sum, arr[j]);
    }
    if (sum == 60)
    {
        cout << "Total: " << sum;
    }
    else
    {
        cout << "Other";
    }
    return 0;
}
'''
PYTHON = '''def add(value, other):
    result = value + other
    return result

def main():
    n = int(input("Count: "))
    arr = [0] * n
    for i in range(n):
        arr[i] = int(input())
    total = 0
    for j in range(n):
        total = add(total, arr[j])
    if total == 60:
        print("Total:", total)
    else:
        print("Other")

main()
'''


class VisualizerTests(unittest.TestCase):
    def run_trace(self, text, language, input_value='3\n10\n20\n30\n'):
        with tempfile.TemporaryDirectory(prefix='codeforge trace ') as directory:
            source = Path(directory) / ('main.py' if language == 'python' else 'main.cpp')
            source.write_text(text, encoding='utf-8')
            args = [sys.executable, str(SCRIPTS / 'visualize.py'), str(source)]
            if language == 'cpp':
                compiler = shutil.which('g++') or 'D:/msys2/ucrt64/bin/g++.exe'
                if not Path(compiler).is_file():
                    self.skipTest('C++ compiler is not installed')
                args = [sys.executable, str(SCRIPTS / 'visualize_cpp.py'), str(source), 'unused', compiler, 'cpp', base64.b64encode(input_value.encode()).decode()]
            result = subprocess.run(args, input=input_value, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=100)
            self.assertEqual(result.returncode, 0, result.stderr)
            steps = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
            self.assertTrue(steps, result.stderr + result.stdout)
            return steps

    def assert_execution(self, steps):
        self.assertFalse([step for step in steps if step.get('event') == 'exception'], steps[-1])
        inputs = [item for step in steps for item in step.get('inputs', [])]
        self.assertEqual([item['target'] for item in inputs], ['n', 'arr[0]', 'arr[1]', 'arr[2]'])
        self.assertEqual([item['value'] for item in inputs], ['3', '10', '20', '30'])
        loops = {}
        for step in steps:
            if step.get('action') == 'loop':
                loops[step['line']] = step
        self.assertEqual(len(loops), 2)
        self.assertEqual([step['iteration'] for step in loops.values()], [3, 3])
        self.assertTrue(all(step['conditionResult'] is False for step in loops.values()))
        self.assertTrue(any(step.get('function') == 'add' for step in steps))
        self.assertTrue(any(len(step.get('frames', [])) > 1 for step in steps))
        self.assertIn('Total: 60', steps[-1].get('stdout', ''))
        self.assertTrue(any(step.get('action') == 'output' and 'Total: 60' in step.get('stdout', '') for step in steps))
        self.assertFalse(any('Other' in step.get('stdout', '') for step in steps))

    def test_python_input_loops_functions_output(self):
        self.assert_execution(self.run_trace(PYTHON, 'python'))

    def test_cpp_input_loops_functions_output(self):
        self.assert_execution(self.run_trace(CPP, 'cpp'))

    def test_python_missing_input_reports_line(self):
        steps = self.run_trace('n = int(input())\nprint(n)\n', 'python', '')
        self.assertTrue(any(step.get('event') == 'exception' and step.get('line') == 1 for step in steps))

    def test_python_infinite_loop_is_bounded(self):
        steps = self.run_trace('i = 0\nwhile True:\n    i += 1\n', 'python', '')
        self.assertIn('2,000', steps[-1]['error'])
        self.assertLessEqual(len(steps), 2001)

    def test_cpp_nested_loops(self):
        program = '''#include <iostream>
int main() {
    int total = 0;
    for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 3; j++) {
            total++;
        }
    }
    std::cout << total;
    return 0;
}
'''
        steps = self.run_trace(program, 'cpp', '')
        self.assertFalse([s for s in steps if s.get('error')])
        self.assertEqual(sum(s.get('action') == 'loop' and s.get('conditionResult') is True for s in steps), 8)
        self.assertEqual(steps[-1]['stdout'], '6')

    def test_cpp_recursion(self):
        program = '''#include <iostream>
int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    int result = n * factorial(n - 1);
    return result;
}
int main() {
    int value = factorial(4);
    std::cout << value;
    return 0;
}
'''
        steps = self.run_trace(program, 'cpp', '')
        self.assertFalse([s for s in steps if s.get('error')])
        self.assertEqual(steps[-1]['stdout'], '24')
        self.assertGreaterEqual(max(len(s.get('frames', [])) for s in steps), 5)

    def test_cpp_compile_error_is_structured(self):
        steps = self.run_trace('int main() { wrong code }', 'cpp', '')
        self.assertEqual(steps[-1]['event'], 'exception')
        self.assertIn('error:', steps[-1]['stdout'])

    def test_cpp_zero_pass_loop(self):
        steps = self.run_trace(CPP, 'cpp', '0\n')
        self.assertFalse([s for s in steps if s.get('error')])
        self.assertFalse([s for s in steps if s.get('action') == 'loop' and s.get('conditionResult') is True])
        self.assertEqual(steps[-1]['stdout'], 'Count: Other')

    def test_cpp_missing_input_reports_input_failure(self):
        steps = self.run_trace(CPP, 'cpp', '')
        self.assertEqual(steps[-1]['event'], 'exception')
        self.assertEqual(steps[-1]['line'], 12)
        self.assertIn('input', steps[-1]['error'])


if __name__ == '__main__':
    unittest.main()
