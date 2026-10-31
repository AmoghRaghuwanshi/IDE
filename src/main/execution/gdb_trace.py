"""Runs inside GDB's Python interpreter, never inside the student's program."""
import gdb
import json
import os
import re

source_path = os.environ['CODEFORGE_TRACE_SOURCE']
trace_path = os.environ['CODEFORGE_TRACE_OUTPUT']
stdin_path = os.environ['CODEFORGE_TRACE_STDIN']
stdout_path = os.environ['CODEFORGE_TRACE_STDOUT']
source_lines = open(source_path, encoding='utf-8').read().splitlines()
trace_file = open(trace_path, 'w', encoding='utf-8')
loop_counts = {}
written = {}
pending_calls = {}
initialized = set()
user_functions = set(re.findall(r'\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{', '\n'.join(source_lines))) - {'if', 'for', 'while', 'switch', 'catch'}
input_remaining = open(stdin_path, encoding='utf-8').read()


def frame_key(frame):
    try:
        return str(frame.read_register('sp')) + ':' + str(frame.name())
    except gdb.error:
        return str(frame.level()) + ':' + str(frame.name())


def frames():
    result = []
    try:
        current = gdb.newest_frame()
        while current:
            sal = current.find_sal()
            if sal.symtab and os.path.normcase(os.path.abspath(sal.symtab.fullname())) == os.path.normcase(os.path.abspath(source_path)):
                result.append({'id': frame_key(current), 'name': current.name(), 'line': sal.line, 'locals': values(current)})
            current = current.older()
    except gdb.error:
        pass
    return result


def emit(entry):
    trace_file.write(json.dumps(entry, ensure_ascii=True) + '\n')
    trace_file.flush()


def output():
    try:
        with open(stdout_path, encoding='utf-8', errors='replace') as stream:
            return stream.read()[-100000:]
    except OSError:
        return ''


def values(frame):
    result = {}
    try:
        block = frame.block()
        while block and not block.is_global and not block.is_static:
            for symbol in block:
                if not (symbol.is_variable or symbol.is_argument) or not symbol.name or symbol.name in result:
                    continue
                try:
                    value = frame.read_var(symbol)
                    typ = value.type.strip_typedefs()
                    if typ.code == gdb.TYPE_CODE_ARRAY:
                        low, high = typ.range()
                        known = written.get((frame_key(frame), symbol.name), set())
                        result[symbol.name] = '[' + ', '.join(str(value[i]) if i in known else '?' for i in range(low, min(high + 1, low + 100))) + ']'
                    else:
                        result[symbol.name] = str(value)[:2000] if symbol.is_argument or (frame_key(frame), symbol.name) in initialized else 'not initialized'
                except (gdb.error, RuntimeError):
                    result[symbol.name] = 'not available'
            block = block.superblock
    except (gdb.error, RuntimeError):
        pass
    return result


def resolve_target(text):
    def replace_index(match):
        try:
            expr = match.group(1)
            if re.fullmatch(r'[\w\s+*/%()-]+', expr):
                return '[' + str(int(gdb.parse_and_eval(expr))) + ']'
        except (gdb.error, ValueError):
            pass
        return match.group(0)
    return re.sub(r'\[([^\]]+)\]', replace_index, text.strip())


def mark_written(target, function):
    match = re.fullmatch(r'(\w+)\[(\d+)\]', target)
    if match:
        written.setdefault((function, match.group(1)), set()).add(int(match.group(2)))
    else:
        initialized.add((function, target))


def boolean_value(expression):
    if not expression or re.search(r'(?<![=!<>])=(?!=)|\+\+|--|\b\w+\s*\(', expression):
        return None
    try:
        return bool(gdb.parse_and_eval(expression))
    except (gdb.error, RuntimeError):
        return None


try:
    gdb.execute('set pagination off')
    gdb.execute('set confirm off')
    gdb.execute('set print repeats 0')
    gdb.execute('set print elements 100')
    gdb.execute('set print pretty off')
    gdb.execute('set language auto')
    gdb.Breakpoint('main', temporary=True)
    command = 'run < "' + stdin_path.replace('\\', '/') + '" > "' + stdout_path.replace('\\', '/') + '"'
    gdb.execute(command, to_string=True)
    last = {}
    for sequence in range(2000):
        try:
            frame = gdb.selected_frame()
            sal = frame.find_sal()
        except gdb.error:
            break
        if not sal.symtab or os.path.normcase(os.path.abspath(sal.symtab.fullname())) != os.path.normcase(os.path.abspath(source_path)):
            gdb.execute('finish', to_string=True)
            continue
        line = sal.line
        source = source_lines[line - 1].strip() if 0 < line <= len(source_lines) else ''
        function = frame.name() or 'main'
        before = values(frame)
        key = frame_key(frame)
        if key in pending_calls:
            completed = pending_calls.pop(key)
            completed.update(locals=before, stdout=output(), nextLine=line, frames=frames())
            emit(completed)
        action = 'execute'
        entry = {'event': 'line', 'line': line, 'source': source, 'function': function,
                 'frameId': key, 'variablesBefore': before, 'phase': 'after'}
        targets = []
        if re.search(r'\bcin\s*>>', source):
            action = 'input'
            targets = [resolve_target(t) for t in re.findall(r'>>\s*((?!std\b|ws\b)[\w]+(?:\s*\[[^\]]+\])?)', source)]
        elif re.search(r'\b(?:std::)?getline\s*\(', source):
            action = 'input'
            match = re.search(r'getline\s*\(\s*(?:std::)?cin\s*,\s*(\w+)', source)
            targets = [match.group(1)] if match else []
        elif re.search(r'\bscanf\s*\(', source):
            action = 'input'
            targets = [resolve_target(t) for t in re.findall(r'&\s*(\w+(?:\[[^\]]+\])?)', source)]
        elif re.search(r'\b(cout|printf|puts)\b', source):
            action = 'output'
        elif re.match(r'(?:else\s+)?if\s*\(', source):
            action = 'condition'
            expression = source[source.find('(') + 1:source.rfind(')')]
            entry.update(condition=expression, conditionResult=boolean_value(expression))
        elif re.match(r'(for|while)\s*\(', source):
            action = 'loop'
            inside = source[source.find('(') + 1:source.rfind(')')]
            parts = inside.split(';')
            expression = parts[1].strip() if len(parts) == 3 else inside
            entry['condition'] = expression
        elif re.match(r'(?:const\s+)?(?:int|long|double|float|char|bool|string|auto|vector)\b', source):
            action = 'declaration'
        elif re.search(r'(?<![=!<>])=(?!=)|\+\+|--', source):
            action = 'calculation' if re.search(r'[+*/%-]', source) else 'assignment'
        assigned = re.search(r'(\w+\s*\[[^\]]+\])\s*(?:[+*/%-]?=)', source)
        if assigned:
            mark_written(resolve_target(assigned.group(1)), key)
        for target in re.findall(r'\b([A-Za-z_]\w*)\s*(?:(?:[+*/%-]?=)(?!=)|\+\+|--)', source):
            initialized.add((key, target))
        for target in re.findall(r'\b([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]\s*=\s*\{', source):
            written[(key, target[0])] = set(range(int(target[1])))
        for target in targets:
            mark_written(target, key)
        if action == 'input' and re.search(r'\bcin\s*>>', source):
            problem = ''
            for target in targets:
                input_remaining = input_remaining.lstrip()
                if not input_remaining:
                    problem = 'This line needs more input than was recorded. Run the program again and enter all requested values.'
                    break
                token = re.match(r'\S+', input_remaining).group(0)
                try:
                    typ = gdb.parse_and_eval(target).type.strip_typedefs()
                    pattern = r'^[+-]?\d+' if typ.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_BOOL) else r'^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?' if typ.code == gdb.TYPE_CODE_FLT else None
                    if pattern:
                        numeric = re.match(pattern, input_remaining)
                        if not numeric:
                            problem = 'The value "' + token + '" could not be read into ' + target + '. This variable expects a number.'
                            break
                        token = numeric.group(0)
                    elif typ.code == gdb.TYPE_CODE_CHAR:
                        token = token[:1]
                except gdb.error:
                    pass
                input_remaining = input_remaining[len(token):]
            if problem:
                emit(dict(entry, event='exception', action='exception', locals=before, stdout=output(), frames=frames(),
                          error=problem, final=True))
                break
        elif action == 'input' and 'getline' in source:
            newline = input_remaining.find('\n')
            input_remaining = input_remaining[newline + 1:] if newline >= 0 else ''
        previous_output = output()
        call = any(re.search(r'\b' + re.escape(name) + r'\s*\(', source) for name in user_functions if name != 'main') and not re.match(r'.*\)\s*\{\s*$', source)
        original_frame = frame
        try:
            gdb.execute('step' if call else 'next', to_string=True)
        except gdb.error as error:
            if gdb.selected_inferior().pid:
                raise error
        alive = bool(gdb.selected_inferior().pid)
        current_frame = gdb.selected_frame() if alive else None
        changed_frame = alive and frame_key(current_frame) != key
        if changed_frame and call:
            pending_calls[key] = dict(entry, action=action)
            emit(dict(entry, action='call', calledFunction=current_frame.name(), locals=before, stdout=output(), frames=frames(), nextLine=current_frame.find_sal().line))
            continue
        after = values(original_frame) if alive and original_frame.is_valid() else before
        next_line = gdb.selected_frame().find_sal().line if alive else 0
        if action in ('loop', 'condition'):
            depth, end, opened = 0, line + 1, False
            for offset in range(line - 1, len(source_lines)):
                text = re.sub(r'"(?:\\.|[^"\\])*"', '', source_lines[offset])
                depth += text.count('{') - text.count('}')
                opened = opened or '{' in text
                if opened and depth <= 0:
                    end = offset + 1
                    break
                if not opened and offset == line:
                    end = offset + 1
                    break
            taken = alive and line < next_line <= end
            entry['conditionResult'] = taken
            if action == 'loop':
                if taken:
                    loop_counts[line] = loop_counts.get(line, 0) + 1
                entry['iteration'] = loop_counts.get(line, 0)
        inputs = []
        input_failed = False
        if action == 'input' and 'cin' in source and alive:
            try:
                input_failed = bool(int(gdb.parse_and_eval('std::cin._M_streambuf_state')) & 5)
            except gdb.error:
                pass
        for target in targets:
            try:
                value = str(gdb.parse_and_eval(target)) if alive else after.get(target, 'not available')
            except gdb.error:
                value = after.get(target, 'not available')
            inputs.append({'target': target, 'value': value})
        current_output = output()
        if changed_frame and not call:
            action = 'return'
        entry.update(action=action, locals=after, stdout=current_output, nextLine=next_line, frames=frames())
        if input_failed:
            entry.update(event='exception', action='exception', error='This input statement could not read the expected value. Check for missing input or a value with the wrong type.', final=True)
            emit(entry)
            break
        if inputs:
            entry.update(inputs=inputs, inputTarget=inputs[0]['target'], inputValue=inputs[0]['value'])
        if current_output != previous_output:
            entry['outputText'] = current_output[len(previous_output):]
        emit(entry)
        last = after
        if alive:
            reason = gdb.execute('info program', to_string=True)
            if 'signal' in reason.lower():
                emit({'event': 'exception', 'line': next_line, 'error': reason.strip(), 'locals': after, 'stdout': current_output, 'final': True, 'phase': 'after'})
                break
        else:
            break
    else:
        emit({'event': 'exception', 'line': 0, 'error': 'Playback stopped after 2,000 steps. Check whether a loop keeps running.', 'locals': last, 'stdout': output(), 'phase': 'after'})
except Exception as error:
    emit({'event': 'exception', 'line': 0, 'error': 'Runtime tracing failed: ' + str(error), 'locals': {}, 'stdout': output(), 'phase': 'after'})
finally:
    trace_file.close()
