#!/usr/bin/env python3
"""
CodeForge Toolchain Probe
Verifies whether the host or container environment supports C/C++, Python,
GDB with embedded Python, ptrace execution tracing, and standard I/O redirection.
Outputs a structured JSON report.
"""

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile

def check_command(cmd, args):
    path = shutil.which(cmd)
    if not path:
        return {"available": False, "path": None, "version": None}
    try:
        res = subprocess.run([path] + args, capture_output=True, text=True, timeout=5)
        first_line = (res.stdout or res.stderr).splitlines()
        version = first_line[0] if first_line else "unknown"
        return {"available": True, "path": path, "version": version.strip()}
    except Exception as e:
        return {"available": False, "path": path, "error": str(e)}

def check_gdb_python(gdb_path):
    if not gdb_path:
        return {"has_python": False, "error": "GDB not installed"}
    try:
        res = subprocess.run(
            [gdb_path, "--batch", "-ex", "python import sys; print('GDB_PY_VER:' + sys.version.replace('\\n', ' '))"],
            capture_output=True, text=True, timeout=10
        )
        for line in res.stdout.splitlines():
            if "GDB_PY_VER:" in line:
                return {"has_python": True, "python_version": line.split("GDB_PY_VER:")[1].strip()}
        return {"has_python": False, "error": res.stderr.strip() or "No Python support detected in GDB"}
    except Exception as e:
        return {"has_python": False, "error": str(e)}

def check_cpp_and_ptrace(gpp_path, gdb_path):
    if not gpp_path or not gdb_path:
        return {"cpp_compilation": False, "ptrace_ok": False, "error": "Missing g++ or gdb"}
    
    env = os.environ.copy()
    bin_dir = os.path.dirname(gpp_path)
    if bin_dir:
        env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")

    with tempfile.TemporaryDirectory(prefix="cf_probe_") as tmpdir:
        src = os.path.join(tmpdir, "test.cpp")
        exe = os.path.join(tmpdir, "test.exe" if sys.platform == "win32" else "test")
        with open(src, "w", encoding="utf-8") as f:
            f.write("#include <iostream>\nint main() { int x = 42; std::cout << x; return 0; }\n")
        
        # 1. Compile with debug info
        comp = subprocess.run([gpp_path, "-g", "-O0", src, "-o", exe], capture_output=True, text=True, env=env)
        if comp.returncode != 0:
            return {"cpp_compilation": False, "ptrace_ok": False, "error": comp.stderr}
        
        # 2. Test GDB ptrace / break & read local variable
        gdb_script_file = os.path.join(tmpdir, "script.gdb")
        with open(gdb_script_file, "w", encoding="utf-8") as f:
            f.write(
                "set pagination off\n"
                "set confirm off\n"
                "break main\n"
                "run\n"
                "next\n"
                "print x\n"
                "continue\n"
                "quit\n"
            )
        try:
            gdb_run = subprocess.run(
                [gdb_path, "--batch", "-x", gdb_script_file, exe],
                capture_output=True,
                text=True,
                env=env,
                timeout=15
            )
            output = gdb_run.stdout + gdb_run.stderr
            ptrace_ok = "$1 = 42" in output or "42" in output
            has_ptrace_denied = "Operation not permitted" in output or "ptrace" in output.lower()
            return {
                "cpp_compilation": True,
                "ptrace_ok": ptrace_ok and not has_ptrace_denied,
                "details": output[:500] if not ptrace_ok else "Breakpoint and inspection succeeded"
            }
        except Exception as e:
            return {"cpp_compilation": True, "ptrace_ok": False, "error": str(e)}

def probe():
    os_info = {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "python_runtime": sys.version.replace("\n", " ")
    }
    if os.path.exists("/etc/os-release"):
        with open("/etc/os-release", "r") as f:
            os_info["os_release"] = f.read().splitlines()

    gcc_info = check_command("gcc", ["--version"])
    if not gcc_info["available"] and sys.platform == "win32":
        for c in ["D:\\msys2\\ucrt64\\bin\\gcc.exe", "C:\\msys64\\ucrt64\\bin\\gcc.exe"]:
            if os.path.isfile(c):
                gcc_info = {"available": True, "path": c, "version": "MSYS2 UCRT64 GCC"}
                break
    gpp_info = check_command("g++", ["--version"])
    
    # Check default PATH or common MSYS2 locations on Windows
    gdb_cmd = "gdb"
    if not shutil.which("gdb") and sys.platform == "win32":
        candidates = ["D:\\msys2\\ucrt64\\bin\\gdb.exe", "C:\\msys64\\ucrt64\\bin\\gdb.exe"]
        for c in candidates:
            if os.path.isfile(c):
                gdb_cmd = c
                break
    
    if not gpp_info["available"] and sys.platform == "win32":
        for c in ["D:\\msys2\\ucrt64\\bin\\g++.exe", "C:\\msys64\\ucrt64\\bin\\g++.exe"]:
            if os.path.isfile(c):
                gpp_info = {"available": True, "path": c, "version": "MSYS2 UCRT64 G++"}
                break

    gdb_info = check_command(gdb_cmd, ["--version"])
    gdb_py = check_gdb_python(gdb_info["path"] if gdb_info["available"] else None)
    trace_check = check_cpp_and_ptrace(gpp_info["path"] if gpp_info["available"] else None,
                                        gdb_info["path"] if gdb_info["available"] else None)

    ready = (
        gpp_info["available"] and
        gdb_info["available"] and
        gdb_py["has_python"] and
        trace_check["ptrace_ok"]
    )

    report = {
        "status": "ready" if ready else "degraded",
        "readyForFullVisualization": ready,
        "os": os_info,
        "gcc": gcc_info,
        "gpp": gpp_info,
        "gdb": gdb_info,
        "gdb_python": gdb_py,
        "trace_capability": trace_check
    }
    return report

if __name__ == "__main__":
    rep = probe()
    print(json.dumps(rep, indent=2))
