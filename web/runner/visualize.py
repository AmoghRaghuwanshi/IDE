"""Python execution recorder. A step describes a statement AFTER it executes."""
import ast
import builtins
import io
import json
import os
import sys
import types

real_stdout = sys.stdout
captured = io.StringIO()
pending = {}
nodes = {}
loop_counts = {}
step_count = 0
target = os.path.abspath(sys.argv[1])
source_lines = []


class TraceLimit(BaseException):
    pass


def snapshot(frame):
    result = {}
    for name, value in list(frame.f_locals.items()):
        if name.startswith('__') or isinstance(value, (types.ModuleType, types.FunctionType, type)):
            continue
        try:
            result[name] = repr(value)[:4000]
        except Exception:
            result[name] = 'not available'
    return result


def emit(entry):
    global step_count
    step_count += 1
    real_stdout.write(json.dumps(entry, ensure_ascii=True) + '\n')
    real_stdout.flush()


def target_name(node, frame):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        index = node.slice
        value = index.value if isinstance(index, ast.Constant) else frame.f_locals.get(index.id) if isinstance(index, ast.Name) else None
        return node.value.id + '[' + (str(value) if value is not None else ast.unparse(index)) + ']'
    return ast.unparse(node)


def finish(frame, next_line=0, error=None):
    state = pending.pop(id(frame), None)
    if not state:
        return
    node = state.pop('_node')
    if isinstance(node, (ast.For, ast.While, ast.If)):
        in_body = bool(node.body) and node.body[0].lineno <= next_line <= node.body[-1].end_lineno
        state['conditionResult'] = in_body
        if isinstance(node, (ast.For, ast.While)):
            key = (id(frame), node.lineno)
            if in_body:
                loop_counts[key] = loop_counts.get(key, 0) + 1
            state['iteration'] = loop_counts.get(key, 0)
    state.update(locals=snapshot(frame), stdout=captured.getvalue()[-100000:], nextLine=next_line, frames=frames(frame))
    if error:
        state.update(event='exception', action='exception', error=error)
    emit(state)


original_input = builtins.input


def traced_input(prompt=''):
    frame = sys._getframe(1)
    value = original_input(prompt)
    state = pending.get(id(frame))
    if state:
        state['action'] = 'input'
        state.setdefault('inputs', []).append({'target': state.get('inputTarget', 'input()'), 'value': value})
        state.update(inputValue=value, inputPrompt=str(prompt))
    return value


def frames(frame):
    result = []
    while frame:
        if os.path.abspath(frame.f_code.co_filename) == target:
            result.append({'id': str(id(frame)), 'name': frame.f_code.co_name, 'line': frame.f_lineno, 'locals': snapshot(frame)})
        frame = frame.f_back
    return result


def tracer(frame, event, arg):
    if os.path.abspath(frame.f_code.co_filename) != target:
        return None
    if step_count >= 2000:
        raise TraceLimit()
    if event == 'call':
        emit({'event': 'call', 'action': 'call', 'line': frame.f_lineno, 'source': source_lines[frame.f_lineno - 1].strip(), 'function': frame.f_code.co_name,
              'frameId': str(id(frame)), 'variablesBefore': snapshot(frame), 'locals': snapshot(frame), 'phase': 'after', 'stdout': captured.getvalue(), 'frames': frames(frame)})
    if event == 'line':
        finish(frame, frame.f_lineno)
        node = nodes.get(frame.f_lineno)
        source = source_lines[frame.f_lineno - 1].strip()
        action = 'execute'
        if isinstance(node, (ast.For, ast.While)):
            action = 'loop'
        elif isinstance(node, ast.If):
            action = 'condition'
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            action = 'calculation' if isinstance(node, ast.AugAssign) or isinstance(getattr(node, 'value', None), ast.BinOp) else 'assignment'
        elif isinstance(node, ast.Return):
            action = 'return'
        if node and any(isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == 'print' for child in ast.walk(node) if not isinstance(node, (ast.For, ast.While, ast.If))):
            action = 'output'
        entry = {'event': 'line', 'action': action, 'line': frame.f_lineno,
                 'function': frame.f_code.co_name, 'frameId': str(id(frame)), 'source': source,
                 'variablesBefore': snapshot(frame), 'phase': 'after', '_node': node}
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            destination = node.targets[0] if isinstance(node, ast.Assign) else node.target
            entry['inputTarget'] = target_name(destination, frame)
        if isinstance(node, (ast.If, ast.While)):
            entry['condition'] = ast.unparse(node.test)
        if isinstance(node, ast.For):
            entry['condition'] = ast.unparse(node.target) + ' in ' + ast.unparse(node.iter)
        pending[id(frame)] = entry
    elif event == 'return':
        finish(frame)
        emit({'event': 'return', 'action': 'return', 'line': frame.f_lineno, 'function': frame.f_code.co_name, 'frameId': str(id(frame)),
              'locals': snapshot(frame), 'variablesBefore': snapshot(frame), 'return_value': repr(arg), 'phase': 'after', 'stdout': captured.getvalue(), 'frames': frames(frame)})
    elif event == 'exception':
        kind, value, _ = arg
        # StopIteration is the normal end of a for loop, not a student error.
        if kind is not StopIteration:
            finish(frame, error=kind.__name__ + ': ' + str(value))
    return tracer


try:
    with open(target, encoding='utf-8') as stream:
        code = stream.read()
    source_lines = code.splitlines()
    tree = ast.parse(code, target)
    for node in ast.walk(tree):
        if isinstance(node, ast.stmt):
            nodes[node.lineno] = node
    builtins.input = traced_input
    sys.stdout = captured
    sys.settrace(tracer)
    exec(compile(tree, target, 'exec'), {'__name__': '__main__', '__file__': target})
except TraceLimit:
    sys.settrace(None)
    emit({'event': 'exception', 'action': 'exception', 'line': 0, 'locals': {}, 'stdout': captured.getvalue(), 'phase': 'after', 'error': 'Playback stopped after 2,000 steps. Check whether a loop keeps running.'})
except BaseException as error:
    sys.settrace(None)
    if not isinstance(error, SystemExit) or error.code not in (None, 0):
        line = getattr(error, 'lineno', 0) or 0
        tb = error.__traceback__
        state = {}
        while tb:
            if os.path.abspath(tb.tb_frame.f_code.co_filename) == target:
                line = tb.tb_lineno
                state = snapshot(tb.tb_frame)
            tb = tb.tb_next
        emit({'event': 'exception', 'action': 'exception', 'line': line, 'locals': state,
              'stdout': captured.getvalue(), 'phase': 'after', 'final': True, 'error': type(error).__name__ + ': ' + str(error)})
finally:
    sys.settrace(None)
    sys.stdout = real_stdout
    builtins.input = original_input
