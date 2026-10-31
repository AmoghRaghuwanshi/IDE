# Running and reviewing CodeForge changes

AI changes appear as an inline review in the editor. Red lines show the previous
code and green lines show the proposed code. Accept updates the file; Reject
keeps it unchanged. Choose **Review changes in editor** on an AI code block, or
paste a multiline replacement into the editor. Program input belongs in the
terminal; pasting source into the terminal does not change an editor file.

To visualize a program:

1. Run the file and enter its input in the terminal.
2. Wait for execution to finish, then select Visualize.
3. Use Next step, Previous, or Play to inspect the recorded execution.
4. Read the current line's explanation and before/after values. Array cells
   identify their index and highlight changes. Select a function in the call
   stack to inspect its local variables.
5. Use the step filter to jump between inputs, value changes, decisions, or output.
   The optional flowchart is a source overview; the playback contains the actual
   branch results and loop passes.

Playback reruns the exact source snapshot with the input captured from that run.
It records actual execution, including functions and recursive calls. Editing the
file requires another run before creating a new trace. Programs using randomness,
time, external files, or other external state may produce a different replay.

C/C++ playback requires a compatible GDB with Python support beside the compiler.
For MSYS2 UCRT64: `pacman -S mingw-w64-ucrt-x86_64-gdb`. The tracer records source
line steps; several statements written on one source line may appear together.
Playback is bounded to 2,000 steps. Arrays record up to 100 cells, with unwritten
C/C++ cells marked unknown rather than given invented values.

Development checks:

```
npm run test:visualizer
npm run build
npm run test:ui
```

The UI check starts a separate Electron profile. It verifies visible red and green
lines, Accept/Reject, terminal input capture, and Python/C++ playback, and writes
screenshots to `test-results`. It does not use the user's saved files or API keys.
