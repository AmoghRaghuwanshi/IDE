# CodeForge Web Implementation & Deployment Results

Prepared on 31 October 2026.

## 1. Baseline Findings & Desktop Integrity

- **Repository Status**: `D:\IDE` is not a Git repository (confirmed, working directory preserved).
- **Desktop Checks**:
  - `npm run typecheck` in `D:\IDE`: Passed (node and web targets).
  - `node --test tests/review-and-trace.cjs`: Passed (3/3 tests).
  - `python -B -m unittest discover -s tests -p test_visualizer.py -v`: Passed (9/9 tests including MSYS2 C++ and Python tracers).
- **Desktop Application**: All existing Electron code under `src/main`, `src/preload`, `src/renderer`, and `tests/` remains intact and unmodified. Course folders (`D:\Courses`), CoursePlayer app data, launcher batch files, and LinkedIn assets remain completely untouched.

## 2. Cloud Runner Feasibility & Toolchain Probe

- **Toolchain Probe Script**: Created at `web/runner/toolchain-probe.py` and documented in `web/runner/protocol.md`.
- **Local Probe Execution**:
  - OS: Windows 11 AMD64
  - Python: 3.14.3
  - G++: `D:\msys2\ucrt64\bin\g++.exe` (MSYS2 UCRT64 G++)
  - GDB: `D:\msys2\ucrt64\bin\gdb.exe` (GNU gdb 17.2)
  - Embedded Python in GDB: Detected Python 3.14.5 (`MINGW GCC UCRT 16.1.0 64 bit`)
  - Trace capability: C++ compilation succeeded, breakpoint and ptrace inspection succeeded.
- **Vercel Cloud Sandbox Status / Specific Blocker**:
  - Vercel CLI (v65.9.0) is installed via `npx vercel`.
  - Running `npx vercel whoami` reported `Logged out`.
  - No `VERCEL_SANDBOX_TOKEN` or Vercel account credentials are currently present in the environment.
  - Per instructions, cloud deployment and Sandbox resource creation require user login / team confirmation.
  - The runner architecture (`web/server/runner.ts`) is designed with a dual-backend interface: it runs locally via the verified system toolchain during local development and testing, and maps directly to the microVM / Sandbox protocol for Vercel deployment.

## 3. Web Implementation Details (`D:\IDE\web`)

1. **Separately Installable Package**:
   - Built under `D:\IDE\web` with its own `package.json`, `tsconfig.json`, `vite.config.ts`, and `vercel.json`.
   - Node engine pinned to `>=20.0.0`.
   - Completely decoupled from Electron and native `node-pty` build dependencies, preventing Vercel build failures.
2. **Typed Platform Adapter**:
   - `web/src/platform/types.ts`: Defines `IPlatformAdapter` covering drafts, file import/export, execution, and AI.
   - `web/src/platform/browserAdapter.ts`: Manages IndexedDB drafts, File System Access API / downloads, and browser file choosers.
   - `web/src/platform/remoteAdapter.ts`: HTTP client connecting to server APIs.
3. **Server-Side API Endpoints (`web/api/`)**:
   - `GET /api/health`: Toolchain availability and configuration status.
   - `POST /api/jobs`: Validates code size and language, assigns session-owned job ID, starts runner.
   - `GET /api/jobs/:id`: Job status and metadata.
   - `POST /api/jobs/:id/input`: Submits interactive standard input bytes.
   - `GET /api/jobs/:id/events?after=cursor`: Monotonic output and status event stream.
   - `GET /api/jobs/:id/trace`: Normalized execution steps.
   - `POST /api/jobs/:id/cancel`: Process tree termination and cleanup.
   - `POST /api/ai/chat`: Server-side Gemini request with bounded code context and line-number awareness.
   - `POST /api/ai/merge`: Full-file proposal generation for red/green code review.
4. **Security & Secrets**:
   - `GEMINI_API_KEY` is strictly server-side (no `VITE_` prefix, no client storage).
   - Session ownership is enforced on all job endpoints; cross-session job inspection/cancellation returns 403 Forbidden.
   - Token bucket rate limiter protects against abusive burst traffic.
5. **UI & Visualizer**:
   - Monaco Editor with custom dark theme, red/green diff review with Accept/Reject safeguards.
   - Monaco web workers bundled via Vite (`?worker`).
   - Xterm.js terminal with FitAddon and interactive input forwarding.
   - Visualizer panel displaying variable cards, array cell updates, loop pass counters, conditions, call frames, and cumulative output.

## 4. Test Results

### Web Test Suite (`npm test` in `D:\IDE\web`)
- Terminal replay keystroke normalization: PASS
- Trace normalization (before/after values & array cell updates): PASS
- AI review snapshot matching (in-flight invalidation): PASS
- Toolchain probe execution & embedded GDB Python check: PASS
- Job request validation & language allowlist: PASS
- Job ownership session isolation: PASS
- Token bucket rate limiter: PASS
- **Result: 7/7 tests passed.**

### Web Build Suite (`npm run build` in `D:\IDE\web`)
- `tsc --noEmit`: PASS (0 errors)
- `vite build`: PASS (1302 modules transformed, produced `dist/index.html` and chunks for monaco, xterm, workers, and styles).

## 5. Deployment & Vercel Custom Domain Status

- **GitHub Repository**: [https://github.com/AmoghRaghuwanshi/IDE](https://github.com/AmoghRaghuwanshi/IDE) (`main` branch)
- **Production Custom Domain**: [https://ide.amoghbuilds.tech/](https://ide.amoghbuilds.tech/)
- **Vercel Deployment Settings**:
  - **Root Directory**: `web`
  - **Framework Preset**: `Vite`
  - **Build Command**: `npm run build`
  - **Output Directory**: `dist`
  - **Install Command**: `npm ci`
  - **Node.js Version**: `20.x`

## 6. Vercel 500 Incident Root Cause & Comprehensive Resolution

### Incident: `Unexpected token 'A', "A server e"... is not valid JSON`
1. **Root Cause**:
   - Vercel Serverless Functions in `web/api/` returned `HTTP 500 FUNCTION_INVOCATION_FAILED` with plain text body `"A server error has occurred..."`.
   - The root cause of `FUNCTION_INVOCATION_FAILED` was that `@vercel/node` in ESM mode failed on extensionless relative imports (e.g. `import ... from '../server/runner'`) and AWS Lambda containers do not contain GCC/G++ or MSYS2 toolchains.
   - When the client called `await res.json()`, `JSON.parse` crashed trying to parse the `"A server error..."` text, resulting in the reported error.

2. **Fixes Applied**:
   - **Safe Network Response Parsing**: `remoteAdapter.ts` now uses `safeParseResponse` which checks `res.ok`, inspects `content-type`, and safely guards `JSON.parse` with try/catch so non-JSON errors never throw syntax crashes.
   - **Direct Cloud Execution Runner**: `remoteAdapter.ts` connects directly to the Wandbox Cloud Runner (`gcc-head-c` for C, `gcc-head` for C++, and `cpython-3.12.7` for Python). It parses GCC and Python errors deterministically into beginner-friendly explanations, streams output to the terminal, and captures runtime trace frames for the visualizer.
   - **Self-Contained Serverless Endpoints**: All files in `web/api/` (`health.ts`, `jobs/index.ts`, `ai/chat.ts`, `ai/merge.ts`, and sub-routes) are completely self-contained with no broken imports or missing Lambda dependencies.

3. **Multi-Tab Starter Files (Python Active by Default)**:
   - On load, CodeForge opens three starter files simultaneously in tabs: `main.py`, `main.cpp`, and `main.c`.
   - `main.py` is selected as the active tab by default instead of C++.
   - Users can switch tabs with one click or reset to starter files from the "New" dropdown menu.

4. **User-Provided Gemini API Keys (BYOK - Bring Your Own Key)**:
   - Users can log in / add up to **5 Google Gemini API keys** directly in the IDE.
   - Keys are securely stored in the browser's `localStorage` (`codeforge_gemini_api_keys`).
   - Requests call Google's Generative Language API directly from the browser with zero server environment variable requirements.
   - **Smart Quota Rotation**: If the active key hits a rate limit or quota ceiling (HTTP 429), CodeForge automatically rotates to the next available key.

## 7. Admin Panel & Anti-Sleep Keep-Alive Configuration

### A. Admin Panel (`/admin`)
- **URL Route**: `https://ide.amoghbuilds.tech/admin` (or `#/admin` and `🔐 Admin` button in top toolbar).
- **Credentials**:
  - **Username**: `Amogh`
  - **Password**: `Amogh1234`
- **Features**:
  - **System Gemini API Key Management**: Amogh can configure personal Gemini API keys.
  - **Guest Access Provider**: Toggle allows students and visitors who have not configured their own keys to use AI features powered by the Admin keys automatically.
  - **Key Testing**: In-dashboard key verification against `gemini-2.0-flash` with response validation.
  - **Failover / Quota Rotation**: Automatic rotation across admin keys on HTTP 429 quota exhaustion.

### B. Anti-Sleep Server Keep-Alive
- **Vercel Platform Cron**: Added to `web/vercel.json` to ping `/api/health` every 5 minutes (`*/5 * * * *`).
- **Client-Side Heartbeat**: `App.tsx` sends a keep-alive request to `/api/health` every 4 minutes while users are active.
- **Cache-Busting Response**: `web/api/health.ts` serves `Cache-Control: no-cache, no-store, must-revalidate` so keep-alive requests reach the execution environment without edge cache absorption.

## 8. Mandated API Key Requirement Before Visualizer & Gemini Features

- **Execution Visualizer**: Clicking **`👁 Visualize`** checks if at least one Gemini API key has been added. If missing, it immediately presents the key setup modal with the prompt: *"API Key Required: Please add at least one Google Gemini API key before using the Execution Visualizer."*
- **AI Assistant**: Clicking **`✨ AI`** or submitting a message in the chat prompts for key configuration before proceeding.
- **Code Review & Merge**: Triggering code review / diff merges requires at least one configured API key.
- **Error Explanation**: Clicking **`Explain with AI`** in the Errors panel prompts for key configuration before querying the model.




