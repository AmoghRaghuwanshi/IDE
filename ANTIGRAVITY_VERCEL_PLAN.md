# CodeForge: architecture explained and Vercel deployment plan

Prepared on 31 October 2026 from the source in `D:\IDE`.

Status: planning and handoff only. This file does not deploy or change the app by
itself. Give it to Antigravity as an implementation instruction. Items marked
"current" describe inspected code; items marked "proposed" describe work to build.

## Part 1 — Understand the project first

### 1. What we have made

CodeForge is currently a desktop application built with Electron. Its interface
uses React and TypeScript. Monaco is the code editor; xterm.js draws the terminal.
Zustand holds editor, execution, and visualizer state.

Electron supplies the local abilities a normal website does not automatically
have: reading local file paths, starting GCC/G++, starting Python and GDB, and
connecting a program to a native terminal process.

Gemini is an optional external assistant. Our compiler, debugger, tracing code,
state comparison, and visualizer do their work without Gemini.

### 2. The three desktop layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Interface / renderer | `src/renderer/src` | Code editor, tabs, chat, terminal display, errors, visualizer playback |
| Preload bridge | `src/preload/index.ts` | Exposes the typed `window.api` methods and forwards calls/events through Electron IPC |
| Main process | `src/main` | Runs local compilers/processes, reads/writes files, invokes tracers, and calls Gemini |

IPC means communication between these parts of the desktop app. A normal browser
does not provide Electron's IPC or preload bridge.

```text
Student uses editor, terminal, chat, or visualizer
                    |
                    v
React interface and Zustand stores
                    |
                    v
window.api in the preload bridge
                    |
                    v
Electron IPC handlers in src/main/ipc/handlers.ts
       |                     |                       |
       v                     v                       v
Local execution       Local trace recording       Gemini API
GCC/G++ / Python      Python tracer / GDB           Google service
       |                     |                       |
       v                     v                       v
Terminal output       Recorded states             Answer / proposed code
                      and explanations
```

### 3. Exactly what uses Gemini

All actual Gemini network requests currently go through
`src/main/ipc/handlers.ts`, using the `@google/genai` SDK and
`ai.models.generateContent(...)`.

| Feature | Where it begins | What is sent | What comes back |
| --- | --- | --- | --- |
| Chat about code | `ChatbotPanel.tsx` calls `window.api.aiChat` | Instruction text, active filename/language, first 200 source lines, available compiler errors, optional recent output, current question | Natural-language answer and sometimes a small code block or line suggestions |
| Explain an error | `ErrorsPanel.tsx` calls `window.api.aiChat` | Error, filename/line, and approximately 20 surrounding lines on each side when the file is found | Explanation and suggested correction |
| Automatic compiler-error help | `App.tsx` calls `window.api.aiChat` after a failed run when keys exist | First compiler error, its line/column, and that source line | An additional AI suggestion marker |
| Merge a suggestion into the file | Chat code-block review calls `window.api.aiMergeCode` | Full current file, suggested snippet, and language | A complete proposed replacement file, held for review |

The full-file merge request is intentional: the chat displays a concise answer,
while the separate merge operation needs enough context to prepare a complete
file. Receiving that file does not immediately overwrite the student's file.

Gemini does not browse the computer or continuously inspect every project file.
The app selects text and includes it in each request. The current chat context
is truncated after 200 lines; it is not whole-project retrieval. The visible
conversation is also not the same as a full conversation history sent on every
request: the current implementation constructs a prompt for the current question.

Current key handling: keys are stored in renderer localStorage under
`codeforge_gemini_keys`, then passed through IPC to the main process. This is
local storage, not a secure credential vault. The main process orders keys,
tracks cooldowns, handles failures/timeouts, and attempts model fallbacks.

### 4. What our code does without Gemini

| Work | Implementation | Source of truth |
| --- | --- | --- |
| Compile C/C++ | `compiler/CompilerManager.ts` | GCC/G++ output and executable |
| Execute Python | Python adapter in `CompilerManager.ts` | Python interpreter |
| Start/stop the running program and pass input | `execution/PtyManager.ts` | Native process and node-pty |
| Extract error line and column | `errors/GccErrorParser.ts`, `PythonErrorParser.ts` | Compiler diagnostics or Python traceback |
| Explain common errors offline | `errors/OfflineAssistant.ts` | Our regular-expression rules and explanation templates |
| Record Python execution | `execution/visualize.py` | `sys.settrace`, runtime frame locals, AST metadata, intercepted input, captured output |
| Record C/C++ execution | `visualize_cpp.py` and `gdb_trace.py` | Compiled program running under GDB with Python support |
| Compare before/after values | `execution/traceNormalizer.ts` | Recorded variable snapshots |
| Identify changed array cells | `traceNormalizer.ts` | Differences between recorded collection elements |
| Describe a recorded action in simple words | `traceNormalizer.ts` | Our fixed explanation templates plus recorded values |
| Render red/green code changes | `components/Editor/MonacoEditor.tsx` | Monaco's local diff computation |
| Accept/reject changes safely | `state/editorStore.ts` | File ID and original-content checks |
| Step backward/forward and filter events | `VisualizerPanel.tsx` | The stored trace and selected index |
| Optional source flowchart | `VisualizerPanel.tsx` | Local source-pattern and block analysis |

Example of our own wording: if an input event records value `20` and destination
`arr[1]`, the normalizer produces "You entered 20. It was stored in arr[1]."
That sentence does not spend Gemini tokens.

Compiler errors such as a missing semicolon come from the compiler. Our offline
assistant can simplify them using a known rule. Gemini can add a more flexible
explanation; an AI suggestion is not the authoritative compiler diagnostic.

The source labels and optional flowchart use simplified analysis. They are not a
complete C++ parser. Actual variable values come from runtime recording, but this
does not mean every possible C++ construct is fully visualized.

### 5. How the important features connect

#### Running code

1. The student clicks Run.
2. `App.tsx` takes the active source and stores the run's source snapshot.
3. `window.api.compileAndRun` forwards the request to the main process.
4. `CompilerManager` creates temporary files and compiles C/C++, or prepares Python.
5. `PtyManager` starts the program.
6. Terminal keystrokes are forwarded to that process; output is forwarded to xterm.
7. Execution state records input and output and receives exit/error events.

#### Visualizing a completed run

1. The student finishes entering input and opens Visualize.
2. The app checks that the source matches the run snapshot.
3. `normalizeTerminalInput` reconstructs submitted input from terminal keystrokes.
4. The main process reruns the source with that input under the appropriate tracer.
5. The tracer records executed lines, functions/frames, before/after locals,
   input destinations, loop/branch observations, and output snapshots.
6. `normalizeVisualizationTrace` creates the consistent student-facing events.
7. React displays the trace; Next and Previous select recorded states.

This is a real execution replay using the recorded input, not a recording of
the original process's memory. Randomness, time, external files, or network state
can make replay differ. Native tracing is source-line based, currently bounded
to 2,000 steps, and native arrays record up to 100 cells. Unknown cells must not
be invented as zero. Preserve these distinctions in the website.

#### AI code review

1. Chat receives a small suggested snippet from Gemini.
2. The student selects Review changes in editor.
3. Gemini is asked to merge that snippet into the current file.
4. The proposal is stored separately from the original file.
5. Monaco shows old lines in red and proposed lines in green.
6. Accept applies it only if the correct file and original contents still match.
7. Reject discards it. Run is a separate action after accepting.

Pasted multiline code can also open the local diff review without a Gemini call.
Code edits belong in the editor; terminal input belongs to the running program.

### 6. Existing limitations to account for during migration

- `window.api` requires Electron today; simply hosting renderer HTML will break it.
- Chat reads `compilationOutput`, while terminal output is recorded separately in
  `recordedOutput`. Inspect and fix that connection before advertising complete
  terminal-output context in web chat.
- The current model fallback lists contain hard-coded names. Do not assume every
  name is available to the configured Google project.
- Some compiler environment construction assumes Windows separators. A Linux
  cloud runner must use Linux paths and `os.pathsep`/the appropriate separator.
- Source/filename handling safe enough for a local desktop is not automatically
  safe for an internet API. Cloud jobs need independent paths and ownership.
- The current terminal bridge is local and event-based. Cloud execution needs a
  different transport and lifecycle.
- The current localStorage key setup must not be copied into a publicly hosted
  app as a way to store the owner's production key.

## Part 2 — The deployment decision

### 7. What "deploy to Vercel" means for this project

We are deploying a browser version of CodeForge while retaining the desktop app.
We are not uploading the Windows executable and expecting browsers to execute it.

Proposed default architecture:

```text
Browser: React + Monaco + xterm + visualizer + browser file storage
                            |
                            v
Vercel: authenticated HTTP APIs for AI and execution orchestration
             |                              |
             v                              v
Gemini API                      Vercel Sandbox microVM per job/session
                                GCC/G++ + Python + GDB + tracer scripts
```

The frontend/API can be one Vercel project. User programs execute in a separate
sandbox, not inside the API process holding Gemini and deployment credentials.

Official Vercel documentation currently describes Sandbox for isolated code
execution, WebSocket support in Functions, and a Container Runtime in Beta.
Their existence does not prove that our GDB tracing works in the selected cloud
environment. Verify that first. Do not repeat outdated blanket claims that
Vercel has no WebSocket or container support.

Primary route: Vite web UI + Vercel APIs + Vercel Sandbox.
Fallback if a required Sandbox capability fails: keep the UI/API on Vercel and
use a compatible isolated runner elsewhere. Report that decision explicitly;
do not hide a nonfunctional C++ visualizer behind static simulated steps.

## Part 3 — Execution instructions for Antigravity

### 8. Scope and preservation rules

Work only on this migration. Preserve the desktop app and its tests.

Never modify, move, or delete:

- `D:\Courses`, including course videos and downloader tools.
- `C:\Users\Amogh\AppData\Local\CoursePlayer`, its database, caches, or player.
- `C:\Users\Amogh\Desktop\Course Player.bat`.
- Existing LinkedIn screenshots and posts.
- The user's installed compiler/debugger or unrelated projects.

Do not perform another workspace cleanup. Do not execute course downloaders.
Do not commit or upload localStorage, real keys, course manifests, course media,
`.env` files, or the existing desktop distribution.

Local implementation and reversible tests are part of this plan. Do not create
paid resources, publish a repository, change a custom domain, or deploy production
without the user's corresponding authorization. If credentials or account access
are missing, finish the local work and identify the specific missing prerequisite.

### 9. Deliverable structure

Create a separately installable `web/` project so Vercel never runs Electron's
root `postinstall` or attempts to build `node-pty` as an ordinary API dependency.

```text
D:\IDE\
  src/                         existing desktop app; retain its behavior
  tests/                       existing desktop checks
  web/
    package.json               web-only scripts and dependencies
    package-lock.json
    index.html
    vite.config.ts
    tsconfig.json
    vercel.json
    .env.example               names/placeholders only
    .vercelignore
    src/
      main.tsx
      App.tsx
      components/              adapted editor/chat/terminal/visualizer UI
      state/
      platform/
        types.ts               interface used by UI
        browserAdapter.ts      browser file/settings behavior
        remoteAdapter.ts       HTTP calls and execution event subscription
      shared/                  trace/error/job types and pure helpers
    api/
      health.ts
      ai/chat.ts
      ai/merge.ts
      jobs/index.ts
      jobs/[id]/index.ts
      jobs/[id]/input.ts
      jobs/[id]/events.ts
      jobs/[id]/trace.ts
      jobs/[id]/cancel.ts
    server/
      auth.ts
      validation.ts
      rateLimit.ts
      gemini.ts
      jobStore.ts
      runner.ts
      sourceContext.ts
    runner/
      protocol.md
      toolchain-probe.py
      runtime harness and versioned tracer scripts
    tests/
    README.md
  docs/
    web-deployment-results.md   actual commands, gates, evidence and limitations
```

The tree is a concrete implementation target, not a claim that these files exist
yet. Validate Vercel route-file conventions before creating the handlers. Expose
the URL contracts below regardless of the chosen supported file mapping.

The initial web port may adapt copies of the current UI/pure helpers to keep
`web/` independently buildable. Record that choice and preserve golden fixtures
for the trace protocol. Do not silently let web and desktop semantics diverge.
Extract shared packages later only if it improves maintainability without making
this first deployment depend on a root Electron install.

### 10. Phase 0 — Baseline inspection and regression record

Tasks:

1. Read this file and applicable `AGENTS.md` files.
2. Inspect current sources rather than assuming this document remains exact.
3. Check whether Git is initialized. At preparation time `D:\IDE` was not a Git
   repository. Do not run commands that discard local changes.
4. Record the current dependency versions and test results.
5. Establish a local checkpoint/backup of files that will actually be edited.
6. Keep secrets out of commands, logs, screenshots and documentation.

Run from `D:\IDE`:

```powershell
npm run typecheck
node --test tests/review-and-trace.cjs
python -B -m unittest discover -s tests -p test_visualizer.py -v
```

Acceptance: baseline behavior is understood; failures are recorded with actual
messages. A transient local compiler-start error must not be reported as a
successful check until a justified rerun succeeds.

### 11. Phase 1 — Cloud feasibility probe, before building the full web app

This is a required technical gate because visualization is a core feature.

1. Confirm the user's Vercel team/project, Sandbox availability, current limits,
   and allowed budget. Do not assume unlimited free compute.
2. Use a development/preview environment. Never send real project secrets into
   the user-program VM.
3. Create an isolated sandbox using the supported current SDK/authentication.
4. Identify its Linux distribution, compiler/interpreter versions, and package
   installation mechanism. Do not hard-code `apt` or `dnf` before inspecting it.
5. Verify `gcc`, `g++`, Python, and GDB with embedded Python support.
6. Run a tiny C++ program under GDB and read a local variable.
7. Verify source-level stepping, stdout redirection, stdin from a file, nested
   frames, recursion, and a three-element array with the current tracer.
8. Verify remote interactive input after a detached process starts. The current
   SDK documents `runCommand`, `stdin`, `writeStdin`, and command/session lookup;
   confirm the exact installed SDK signatures before coding against them.
9. Verify that a second API invocation can reconnect to the same job and obtain
   output/status. Do not rely on an in-memory object from the first request.
10. Verify cancellation and timeout actually terminate the user's process and
    release the sandbox. Verify outbound network restrictions during execution.
11. Prepare a clean reusable toolchain snapshot/image if supported, containing
    only trusted tools and tracers. Never snapshot user source or credentials
    into a template reused across users.

Acceptance evidence must include a real cloud trace, expected variable values,
input/output, function frames, job reattachment, and cleanup. Local GDB success
alone is insufficient. The public documentation does not establish `ptrace`/GDB
compatibility for our selected environment; measure it.

If this gate fails: document the exact failure, keep feasible local work moving,
and use the explicit runner fallback only after the user agrees to any additional
provider or cost. Never present static source analysis as runtime visualization.

### 12. Phase 2 — Make the browser UI independently buildable

Tasks:

1. Create the web package with React, TypeScript, Vite, Monaco, xterm, and Zustand.
2. Pin compatible versions in the web lockfile. Choose a Node LTS version
   supported by the current Vercel runtime and dependencies; specify it in the
   web package rather than relying on an unspecified machine default.
3. Adapt existing UI components and pure trace/error helpers deliberately.
4. Introduce a typed platform interface; web UI calls the web adapter. Do not
   sprinkle Electron detection and fallback fetches throughout every component.
5. Keep Electron imports, native `node-pty`, Windows paths, and local filesystem
   APIs out of the web client and ordinary web API dependency graph.
6. Configure Monaco's bundled editor/language workers, including the diff worker.
7. Preserve red/green review, loading behavior, Accept/Reject, file identity checks,
   and safe model disposal. The previous missing worker and model-disposal bugs
   have regression coverage; do not reintroduce them.
8. Keep Vite's browser policy suitable for same-origin APIs and worker assets.
   Add only the connection origins actually needed by the selected transport.
9. Make loading, offline, expired-session, and backend-unavailable states readable.

Commands after the web files/scripts exist:

```powershell
cd D:\IDE\web
npm install
npm run typecheck
npm run build
npm run dev
```

Commit the resulting web lockfile. Later clean installations must use `npm ci`.

Acceptance: the UI opens in an ordinary browser with no Electron preload,
`window.api is undefined`, native-module import, worker-loading, or hydration
errors. It is not yet a complete IDE until the following backend phases pass.

### 13. Phase 3 — Browser files and settings

Map desktop features as follows:

| Desktop operation | Browser behavior |
| --- | --- |
| Open file | Standard file chooser and `File.text()` |
| Open folder | Supported directory picker where available; explicit fallback elsewhere |
| Save project draft | IndexedDB/local browser persistence with failure handling |
| Save/export file | Browser download; optional File System Access API after a user gesture |
| Read an arbitrary Windows path | Not exposed to the server |
| Terminal resize | Supported PTY resize, or a clear no-op capability for pipe-based output |
| Local compiler detection | Remote runner capability endpoint |

Use browser storage for source drafts and non-secret preferences. Do not promise
automatic disk writes across all browsers. Server-side cloud project storage is
optional for the initial release and must be described separately from drafts.

Validate imported sizes, extensions/language IDs, and relative paths. Never send
arbitrary local absolute paths as runner destinations.

Acceptance: new/open/edit/reload/export works, source remains intact after a
refresh, and unsupported browser capabilities have a usable fallback.

### 14. Phase 4 — Gemini as a server-side service

Proposed endpoints:

- `POST /api/ai/chat`
- `POST /api/ai/merge`

Move/refactor provider logic into `web/server/gemini.ts`. The browser sends its
question and selected code context. The server uses its configured provider key;
the browser never receives that key.

Tasks:

1. Configure `GEMINI_API_KEY` as a server secret. Never use a `VITE_` prefix for it.
2. Use `GEMINI_MODEL` as a configurable model identifier and verify access against
   the configured project. Do not copy the unverified hard-coded fallback list.
3. Cache model capability discovery where appropriate; avoid discovering models
   and retrying many invalid IDs for every chat message.
4. Keep a bounded total request deadline, remaining-time-aware attempts, and
   `Retry-After` handling. Handle quota, invalid key, unavailable model, empty
   output, and deadline failures as distinct cases.
5. Rate-limit by authenticated user/session with durable storage. Multiple keys
   in one Google project can share quota; rotation is not a quota bypass.
6. Send useful bounded context with actual line numbers. For errors outside the
   first 200 lines, include the relevant region instead of silently omitting it.
7. Wire terminal-output context to the real recorded output, with strict length
   limits. Show users what context the AI is being given.
8. Add bounded conversation history if desired; do not imply it already exists.
9. Validate any returned line suggestions against the current source snapshot.
10. For merge, retain the original source hash/file ID and return a proposal.
    Accept must reject stale proposals if the user has edited or changed tabs.
11. Abort superseded browser requests; prevent stale responses replacing newer
    answers. Never log raw keys or complete private source by default.
12. Keep compilation and visualization usable when AI is absent or unavailable.

Acceptance: actual Gemini answers refer to the supplied code; no owner key is
visible in the browser bundle, localStorage, network responses, or screenshots.
The full-file merge preview shows genuine old/new lines and changes the editor
only after Accept. Tests can mock provider transport, but live verification must
be labeled separately from mock results.

### 15. Phase 5 — Remote job execution contract

Proposed URL contracts:

| Method / URL | Purpose |
| --- | --- |
| `GET /api/health` | Configuration/capability summary without secrets |
| `POST /api/jobs` | Validate input, create a job, return its app-owned ID |
| `GET /api/jobs/:id` | Return current job state |
| `POST /api/jobs/:id/input` | Submit ordered stdin bytes or end-of-input |
| `GET /api/jobs/:id/events?after=cursor` | Retrieve ordered output/status events |
| `GET /api/jobs/:id/trace?after=cursor` | Retrieve trace chunks or an authorized artifact reference |
| `POST /api/jobs/:id/cancel` | Stop the process and release resources |

Initial create request shape:

```json
{
  "language": "cpp",
  "sourceName": "main.cpp",
  "sourceCode": "...",
  "mode": "run",
  "stdin": "",
  "cppStandard": "c++17",
  "sourceHash": "server-validated-hash"
}
```

`mode` is `run` or `trace`. A trace request contains the completed run's normalized
input and source hash. Hashes identify snapshots; they are not authorization.

Persist at least: job ID, owner ID, source hash, language, run/trace mode, state,
sandbox/session/command identifiers, creation/deadline/expiry times, output
cursor, exit status, cleanup status, and trace artifact location.

Use a durable job store. Ordinary module variables in a Vercel function cannot
be the only record of sessions, jobs, cooldowns, quota, or process handles.
Never return provider credentials or administrative sandbox tokens to the browser.

The runner must:

1. Create a unique job workspace inside the sandbox.
2. Write the source through a file API, not by interpolating it into a shell command.
3. Compile using validated argument arrays and an allowlist of language/standards.
4. Use Linux-native paths, executables, and environment separators.
5. Bound compilation, execution, stdout/stderr, file sizes, and trace size.
6. Track the whole process tree/group so Stop terminates children too.
7. Keep Gemini keys, Vercel credentials, and other users' files outside the VM.
8. Deny unnecessary outbound access once trusted tool provisioning is complete.
9. Separate stdout, stderr, control/status events, and trace JSON. User output
   must not be able to impersonate trusted trace/control messages.
10. Treat source, filenames, terminal output and model text as untrusted input.

Acceptance: a normal run returns a handle promptly, the UI streams or retrieves
output, Stop works, expiry is visible, and one user's job cannot be accessed by
another session.

### 16. Phase 6 — Interactive input and terminal transport

Start with ordered HTTP input plus cursor-based event polling if that is the
simplest verified SDK integration. WebSockets can be added after the job contract
works; they are not a reason to skip durable job ownership or state.

For a pipe-based run, detached command stdin must be explicitly kept open and
reattachable. The documented `writeStdin` API writes to a pipe, not a PTY. Confirm
this distinction in the UI and capability report. Python stdout may need
unbuffered mode; C/C++ prompts without a newline must become visible appropriately.

For a true terminal, verify the documented interactive controller/PTY protocol,
resize, disconnections, and credentials. Do not assume that receiving an
`openInteractive()` URL is sufficient to connect raw xterm bytes to it. Keep
administrative VM access separate from the student's program input.

Input requests need sequence numbers/idempotency so network retries cannot enter
`20` twice. Store the accepted input journal for replay. Echo is a display detail,
not a second copy of the submitted input. Handle paste, Enter, backspace,
multiline input, Unicode, EOF and cancellation deliberately.

Output events need monotonic cursors. Decode UTF-8 across chunk boundaries.
Use adaptive polling/backoff and output caps, not unlimited full-output responses.
If using WebSockets, reconnect using job ID and cursor; handle current function
duration limits and connection expiry without losing the job's recorded state.

Acceptance example: run an array program, wait for `Count:`, enter `3`, then
`10`, `20`, `30`, and see the correct output. Input is requested during execution,
not only through a batch form. Repeat after a simulated temporary disconnect.

### 17. Phase 7 — Cloud visualizer

Keep runtime truth independent of Gemini.

1. Port/package `visualize.py`, `visualize_cpp.py`, and `gdb_trace.py` for the
   verified Linux sandbox environment. Preserve user source-line mappings.
2. Bundle trusted runner assets explicitly; test their presence in the deployed
   function bundle, not only in a local source directory.
3. Run trace jobs against the exact saved source snapshot and accepted input.
4. Normalize using the shared `NormalizedVisualizerStep` contract or a
   deliberately versioned compatible successor.
5. Preserve before/after values, per-cell changes, function frames, input targets,
   loop passes, branch observations, cumulative output, and current-step output.
6. Preserve safe bounds and show truncation visibly. Limit trace response bytes
   as well as step count. Chunk large traces/store artifacts instead of exceeding
   the hosting provider's current response limits.
7. Show explanatory text such as "20 was stored in arr[1]" and readable values.
8. Keep the flowchart optional and secondary. Label static analysis accurately.
9. Preserve the source snapshot when a user edits the file during replay.
10. Stop the entire trace process/sandbox on cancellation, timeout, or disconnect
    according to the documented retention policy.

Required evidence:

- Input `3, 10, 20, 30` creates three distinct array-input events.
- The input loop has three taken passes and the final non-taken check.
- Sum changes show the intermediate values, ending at `60`.
- A helper function's arguments and local result are visible separately from main.
- Nested loops and recursive frames remain distinguishable.
- Output is correct at each print step, not just appended at the very end.
- Missing/invalid input produces a readable input-line error.
- Unknown/unwritten native cells are not displayed as invented values.
- Tracing still works when the Gemini secret is absent.

### 18. Phase 8 — Sessions, limits and release readiness

For a private preview, use deployment access protection plus owner-bound app
sessions. For a public release, implement and test application authentication and
server-side authorization before enabling execution or owner-funded AI calls.

Every job, input write, event read, trace read, and cancellation must verify its
owner. Use secure, HttpOnly, SameSite cookies or a correctly verified equivalent.
Protect mutating cookie-authenticated routes against cross-site requests.

Set and enforce configurable limits for source size, input bytes, output bytes,
trace bytes/steps, job lifetime, concurrent jobs/user, AI request rate, and daily
execution/AI budget. Pick values against the actual Vercel plan and measured
examples; do not advertise an untested unlimited free service.

Clean expired jobs and stopped sandboxes even if the browser tab is closed. Do
not reuse a previous user's writable VM/workspace as a new user's clean session.

Acceptance: cross-user access tests fail correctly; a runaway program cannot
consume unbounded resources; no key reaches student code; repeated failed jobs
do not leave orphaned sandboxes or quota reservations.

### 19. Phase 9 — Automated and manual verification

Add web scripts for `typecheck`, unit tests, browser tests, and build. Name the
actual commands in `web/README.md`; do not document a command before creating it.

Test matrix:

| Area | Required checks |
| --- | --- |
| Editor | File import/export, drafts, tab identity, missing/invalid files |
| Review | Visible red deletion and green insertion, Accept, Reject, stale requests, repeated open/close without model errors |
| AI | Context beyond line 200, exact relevant lines, unavailable key/model, quota, cancellation, bounded retries, no secret leak |
| Run | C, C++, Python, compiler errors, normal exit, nonzero exit, runtime error |
| Input | Interactive prompts, array input, paste, edited input, Unicode, EOF, duplicate network requests |
| Trace | Three-item sum, sorting swaps, nested loops, recursion, early return, zero-pass loops, missing input, truncation |
| Ownership | Two independent users/sessions, wrong job ID, expired session, unauthorized trace/input/cancel |
| Lifecycle | Stop, browser close, function restart, reconnect, VM expiry, cleanup |
| UI | Desktop and narrow layouts, readable labels, keyboard controls, no console exceptions |
| Isolation | User code cannot read app secrets, other job files, or unintended network targets |

Mock tests do not replace actual compiler, GDB, and cloud Sandbox tests. Keep test
source harmless and use isolated test sessions instead of the user's real files.

Acceptance: the production-built web UI passes the matrix locally and in a
protected Vercel preview; the existing desktop baseline still passes.

### 20. Phase 10 — Prepare the repository and Vercel project

Do this after the web package works locally.

1. If needed, initialize Git locally. Do not assume an existing remote.
2. Inspect the exact staged file list before any commit/push.
3. Exclude `node_modules`, desktop `dist`/`out`, browser build output, screenshots
   unless intentionally public, `.env*` except `.env.example`, local keys,
   personal source drafts, course manifests/media, and player files.
4. Create/use a repository under the user's chosen account and visibility only
   when authorized. A private repository is sufficient for deployment.
5. Import that repository into the intended Vercel team/project.
6. Configure the project as below, using current supported Vercel settings.

| Setting | Proposed value |
| --- | --- |
| Root Directory | `web` |
| Framework Preset | Vite, if using the Vite + API layout described here |
| Install Command | `npm ci` inside `web` |
| Build Command | `npm run build` inside `web` |
| Output Directory | `dist` inside `web` |
| Node version | The tested supported LTS pinned in the web package |
| Preview access | Protected while cloud execution is being verified |

Do not use the root Electron `npm run build` or point Vercel at
`dist/win-unpacked`. Ensure root-directory isolation actually prevents the root
Electron `postinstall` from running during the web install.

Environment configuration:

| Name | Placement | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Server-only secret | Owner's Gemini credential |
| `GEMINI_MODEL` | Server config | Model verified for this Google project |
| Sandbox authentication | Server only | Current Vercel OIDC method or documented scoped alternative |
| `RUNNER_SNAPSHOT_ID` or verified equivalent | Server config | Clean trusted toolchain template, if used |
| Durable job-store credentials | Server only | Jobs, ownership, cursors, limits, cleanup records |
| Application session/auth configuration | Server only, except deliberately public client identifiers | Private/public access model |
| Budget and concurrency settings | Server config | Enforced resource limits |

Create `.env.example` with names and placeholders only. Use the current Sandbox
authentication documentation: local `vercel env pull`/OIDC tokens can expire,
and deployment authentication must work in preview and production. Do not paste
tokens into this plan or assume one development token is permanent.

Configure SPA routing so browser-page refreshes work without rewriting `/api/*`
to `index.html`. Bundle runner assets explicitly using the supported function
file-inclusion configuration. Verify dependency tracing in the deployed bundle.

### 21. Phase 11 — Local Vercel checks and protected preview

After the web package and actual test scripts exist:

```powershell
cd D:\IDE\web
npm ci
npm run typecheck
npm test
npm run build
cd D:\IDE
npx vercel login
npx vercel link
npx vercel pull --environment=development
npx vercel env pull web/.env.local
npx vercel dev
```

Use the account/team selected by the user. Credential entry is an account action;
do not print credentials or write them into tracked files.

For this repository layout, link the repository root to the Vercel project whose
Root Directory is `web`. Run repository deployments from `D:\IDE`, including
the `web` directory in the upload. Do not combine an upload rooted inside `web`
with a project setting that then searches for another `web` beneath it. Confirm
the current CLI's monorepo behavior in the linked project settings. If the web
app is instead put in its own separate repository, that repository's Root
Directory is `.` and its commands run from that separate repository.

After local verification and authorization to create a preview:

```powershell
cd D:\IDE
npx vercel
```

Use the returned preview URL; do not invent one. Check its homepage, worker assets,
API health, real Gemini call, interactive program run, GDB trace, file export,
refresh, cancellation, reconnect, and cleanup. Confirm required environment
variables are available to preview deployments, not only production.

### 22. Phase 12 — Production handoff

Production prerequisites:

- All technical gates have evidence, including actual cloud GDB tracing.
- Authentication, ownership, resource limits, and cleanup are verified.
- The user has accepted the provider/account/budget and production release.
- No secrets or course/player files are in the repository or build artifacts.
- A last-known-good deployment is recorded for rollback.

Production command, only after those prerequisites:

```powershell
cd D:\IDE
npx vercel --prod
```

Then repeat the essential smoke checks against the actual production URL.
Add a custom domain only if requested. Confirm rollback through Vercel's supported
deployment controls; a Git revert may be appropriate for source rollback, but do
not use destructive Git resets.

Record in `docs/web-deployment-results.md`:

1. Which provider/team/project and runtime were actually used.
2. The actual preview/production URL, if created.
3. Toolchain/SDK/model versions and validated cloud capabilities.
4. Test commands and actual pass/fail results.
5. Current limits and observed behavior for cold starts and long jobs.
6. Known limitations and anything not yet implemented.
7. Where configuration lives, without including secret values.
8. How to stop execution resources and roll back a deployment.

Do not mark the migration complete merely because the homepage loads. Run,
interactive input, actual visualization, and AI review are core acceptance gates.

## Part 4 — Troubleshooting guide

| Symptom | Check and correction |
| --- | --- |
| `window.api is undefined` | A desktop-only call remains; route it through the typed web adapter |
| `node-pty`/Electron install fails on Vercel | Wrong project root or dependency graph; isolate the web package |
| Red/green review opens but lines do not appear | Verify Monaco worker configuration, network/CSP, and distinct original/modified models |
| Model disposed errors after Accept/Reject | Preserve the tested model-detach/disposal order |
| Gemini returns missing model/quota/deadline | Verify accessible model and project quota; bound retries and report the real error |
| Gemini cannot explain line 250 | Context selection omitted it; send the relevant numbered region |
| Prompt appears only after program exit | Check stdout buffering and whether pipe or PTY mode is being used |
| Input arrives twice | Add input sequencing/idempotency; do not record terminal echo as input |
| Job disappears after another API request | Job state/remote command identity was stored only in memory |
| GDB not found | Toolchain template lacks GDB with Python support; repair and revalidate the trusted template |
| GDB cannot start/inspect the inferior | Inspect cloud debugging permissions; do not substitute a fabricated trace |
| Variables are attributed to the next line | Preserve the after-statement trace contract and before/after snapshots |
| A trace request exceeds response limits | Enforce byte limits and deliver trace chunks/artifacts |
| Build deploys but APIs return HTML | Fix SPA rewrite precedence for `/api/*` |
| An expired session leaves running VMs | Fix deadlines, process cleanup and the independent expiry cleanup path |

## Part 5 — Official references to recheck during implementation

These were consulted while preparing the plan. Platforms and SDKs change; verify
their current API/version and limits again when implementing.

- Vercel Sandbox overview: https://vercel.com/docs/sandbox
- Sandbox JavaScript SDK, command input, interactive access, sessions and network
  policies: https://vercel.com/docs/sandbox/sdk-reference
- Sandbox authentication: https://vercel.com/docs/sandbox/concepts/authentication
- Vercel OIDC: https://vercel.com/docs/oidc
- Vercel build settings: https://vercel.com/docs/builds/configure-a-build
- Vercel monorepo/root-directory behavior: https://vercel.com/docs/monorepos
- Vercel CLI project/environment pull: https://vercel.com/docs/cli/pull
- Vercel function limits: https://vercel.com/docs/functions/limitations
- Vercel WebSockets: https://vercel.com/docs/functions/websockets
- Vercel Container Runtime: https://vercel.com/docs/functions/runtimes/container
- Vite production build: https://vite.dev/guide/build
- Gemini model listing: https://ai.google.dev/api/models
- Gemini API key handling: https://ai.google.dev/gemini-api/docs/api-key
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits

## Copy this instruction into Antigravity

> Read `D:\IDE\ANTIGRAVITY_VERCEL_PLAN.md` completely. Implement its proposed
> browser version in phases while preserving the existing Electron app. Start
> with the baseline and the cloud runner feasibility gate. Use real execution
> traces; keep Gemini separate from compilation and visualization. Preserve the
> course folders, course player, viewing records, and personal screenshots.
> Complete authorized local implementation and tests, record evidence and actual
> blockers, and prepare a protected Vercel preview. Do not claim the web IDE is
> complete until interactive input, C++/Python execution, actual GDB/Python
> visualization, AI context, and Accept/Reject review all work. Follow the plan's
> account, resource, and production-release authorization boundaries.
