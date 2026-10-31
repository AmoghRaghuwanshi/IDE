# CodeForge Cloud & Local Runner Protocol

This document defines the execution and visualization contract used by both the local runner and cloud Sandbox environments (Vercel Sandbox / microVMs).

## 1. Environment Requirements

To support compilation, execution, and real runtime visualization for C, C++, and Python, the runner host or container MUST provide:

1. **Compilers & Interpreters**:
   - `gcc` (C compiler)
   - `g++` (C++ compiler supporting C++11, C++14, C++17, C++20)
   - `python3` (Python 3.8+)
2. **Debugger**:
   - `gdb` with embedded Python support (`gdb.execute`, `gdb.parse_and_eval`). Note: standard `gdb` packages on Debian/Ubuntu/Fedora include Python support; minimal distributions may require `gdb-python`.
3. **Kernel & Tracing Permissions**:
   - `ptrace` syscall support without denial (`SYS_PTRACE` permitted). On hardened Linux hosts, `kernel.yama.ptrace_scope` must permit parent/debugger tracing of inferior child processes.
4. **Execution Protocol**:
   - Stdin streamed or supplied as input journal.
   - Stdout and Stderr streamed or buffered with timestamps/cursor offsets.
   - Monotonic event cursors for client polling/event streams.

## 2. Tracer Harness

The runner bundles three deterministic runtime tracers:
- `visualize.py`: Uses Python `sys.settrace` and AST inspection to record line-by-line frames, variables before/after, loops, branches, calls, and outputs.
- `visualize_cpp.py` & `gdb_trace.py`: Compiles C/C++ with `-g -O0` and runs the binary under GDB. Python inside GDB steps through instructions, inspects stack frames, extracts array contents (up to 100 cells), maps inputs from stdin, and streams structured JSONLines.

## 3. Toolchain Probe

Run `python3 runner/toolchain-probe.py` inside any container or VM to verify all prerequisites before dispatching student jobs. The probe validates:
- C++ compilation with debug symbols
- GDB startup and embedded Python version
- Setting breakpoints, stepping, and reading local variables
- ptrace non-denial

## 4. Resource & Security Limits

Every runner instance enforces:
- Max compilation time: 10 seconds
- Max execution time: 30 seconds
- Max memory: 256MB
- Max trace steps: 2,000 steps
- Max output size: 250KB
- Process group termination on stop/timeout
- No outbound network access during code execution
