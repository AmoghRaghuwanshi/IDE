"""Compile and trace a real C/C++ execution with isolated input and output."""
import base64
import json
import os
import shutil
import subprocess
import sys
import time


def error(message, details=''):
    print(json.dumps({'event': 'exception', 'line': 0, 'locals': {}, 'stdout': details,
                      'error': message, 'final': True, 'phase': 'after'}), flush=True)


def main():
    source, compiler, language = sys.argv[1], sys.argv[3], sys.argv[4]
    directory = os.path.dirname(os.path.abspath(compiler))
    env = os.environ.copy()
    old_path = next((v for k, v in env.items() if k.lower() == 'path'), '')
    env = {k: v for k, v in env.items() if k.lower() != 'path'}
    env['PATH'] = directory + os.pathsep + old_path
    executable = source + '.trace.exe' if os.name == 'nt' else source + '.trace'
    gdb = shutil.which('gdb', path=env['PATH'])
    if not gdb:
        error('C/C++ visualization needs GDB to inspect actual variable values. Install GDB alongside your compiler. For MSYS2 UCRT64, run: pacman -S mingw-w64-ucrt-x86_64-gdb')
        return
    # Unbuffer the trace copy so each print is visible at its own source step.
    # #line keeps the student's original filename and line numbers in GDB.
    instrumented = source + ('.instrumented.cpp' if language == 'cpp' else '.instrumented.c')
    with open(source, encoding='utf-8') as stream:
        original = stream.read()
    prefix = '#include <stdio.h>\n'
    if language == 'cpp':
        prefix += '#include <iostream>\nnamespace { struct CodeForgeTraceOutput { CodeForgeTraceOutput() { setvbuf(stdout, nullptr, _IONBF, 0); std::cout.setf(std::ios::unitbuf); } } codeforge_trace_output; }\n'
    else:
        prefix += '__attribute__((constructor)) static void codeforge_trace_output(void) { setvbuf(stdout, NULL, _IONBF, 0); }\n'
    with open(instrumented, 'w', encoding='utf-8') as stream:
        stream.write(prefix + '#line 1 ' + json.dumps(os.path.abspath(source).replace('\\', '/')) + '\n' + original)
    command = [compiler, '-g', '-O0', '-fno-inline', instrumented, '-o', executable]
    if language == 'cpp':
        command.append('-std=c++17')
    compiled = subprocess.run(command, capture_output=True, text=True, errors='replace', env=env, timeout=30)
    if compiled.returncode:
        error('The program could not be compiled. Read the compiler details below.', compiled.stderr[-8000:])
        return
    input_value = base64.b64decode(sys.argv[5]).decode('utf-8') if len(sys.argv) > 5 and sys.argv[5] else sys.stdin.read()
    input_path, output_path, trace_path = source + '.stdin', source + '.stdout', source + '.jsonl'
    with open(input_path, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(input_value.replace('\r\n', '\n').replace('\r', '\n'))
    env.update(CODEFORGE_TRACE_SOURCE=os.path.abspath(source), CODEFORGE_TRACE_OUTPUT=trace_path,
               CODEFORGE_TRACE_STDIN=input_path, CODEFORGE_TRACE_STDOUT=output_path)
    driver = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gdb_trace.py').replace('\\', '/')
    debugger_command = [gdb, '--batch', '--quiet', '-nx', executable,
                        '-ex', "python exec(compile(open(" + repr(driver) + ", encoding='utf-8').read(), " + repr(driver) + ", 'exec'))"]
    for attempt in range(3):
        result = subprocess.run(debugger_command, capture_output=True, text=True, errors='replace', env=env, timeout=80)
        startup_error = ''
        if os.path.isfile(trace_path):
            with open(trace_path, encoding='utf-8') as stream:
                startup_error = stream.read()
        # Windows can briefly lock a freshly compiled executable while scanning it.
        if 'Error creating process' not in startup_error or attempt == 2:
            break
        time.sleep(0.4 * (attempt + 1))
    count = 0
    if os.path.isfile(trace_path):
        with open(trace_path, encoding='utf-8') as stream:
            for line in stream:
                print(line.rstrip(), flush=True)
                count += 1
    if not count:
        error('The debugger did not capture any steps.', (result.stderr + result.stdout)[-4000:])


if __name__ == '__main__':
    try:
        main()
    except subprocess.TimeoutExpired:
        error('Visualization took too long. Check for a loop that never ends or missing input.')
    except Exception as exception:
        error('Visualization could not start: ' + str(exception))
