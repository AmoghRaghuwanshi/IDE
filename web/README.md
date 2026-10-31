# CodeForge Web

CodeForge Web is the browser edition of the CodeForge beginner-friendly IDE for C, C++, and Python with real runtime execution visualization and server-orchestrated AI assistance.

## Architecture

- **Client (`web/src/`)**: React 19, TypeScript, Monaco Editor (with custom red/green diff view and local workers), xterm.js terminal, and Zustand state stores.
- **Platform Adapter (`web/src/platform/`)**: Typed interface abstracting storage (IndexedDB drafts), file export/import, server execution jobs, and AI queries.
- **Serverless API (`web/api/`)**: Vercel-compatible serverless handlers for health checks, job execution, stdin submission, cursor-based event polling, visualization trace retrieval, and server-side Gemini requests.
- **Execution Runner (`web/server/runner.ts`)**: Modular execution engine supporting both local toolchains and isolated cloud microVMs (Vercel Sandbox).
- **Tracers (`web/runner/`)**: Native line-level Python (`visualize.py`) and GDB+Python (`visualize_cpp.py`, `gdb_trace.py`) runtime execution tracers.

## Available Scripts

From `D:\IDE\web`:

```bash
# Typecheck
npm run typecheck

# Unit and integration tests
npm test

# Production build
npm run build

# Local development server with integrated API middleware
npm run dev

# Preview production build locally
npm run preview
```

## Environment Variables

Copy `.env.example` to `.env.local`:

- `GEMINI_API_KEY`: Server-side Gemini API key (never sent to client browsers).
- `GEMINI_MODEL`: Verified Gemini model (defaults to `gemini-2.5-flash`).
- `VERCEL_SANDBOX_TOKEN`: Scoped token for Vercel Sandbox / microVMs when running in cloud mode.
- `MAX_EXECUTION_TIME_MS`: Maximum job runtime before termination (defaults to 30000ms).
- `MAX_OUTPUT_BYTES`: Maximum program output bytes (defaults to 250KB).
- `MAX_TRACE_STEPS`: Maximum trace steps recorded (defaults to 2000 steps).
