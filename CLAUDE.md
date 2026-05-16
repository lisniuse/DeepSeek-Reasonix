# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Reasonix is a DeepSeek-native coding agent with two surfaces: a **CLI/TUI** (Node.js, Ink 5 + Commander) and a **Desktop app** (Tauri v2 + React 19).

### CLI / Kernel (`src/`)

| Path | Role |
|---|---|
| `src/cli/` | CLI entry, Commander commands (`chat`, `code`, `diff`, `desktop`, etc.), Ink TUI components in `ui/` |
| `src/loop.ts` | **Core agent loop** — orchestrates prompt-build, model call, tool-execute, repair cycle |
| `src/core/events.ts` | Event union — every kernel event typed as a discriminated union |
| `src/core/reducers.ts` | Pure event log → state projections (no side effects) |
| `src/core/eventize.ts` | State-mutation helpers that produce events |
| `src/tools/` | Tool definitions: filesystem, shell, MCP, plan, subagent, web, workspace |
| `src/repair/` | Tool-call repair pipeline: flatten, scavenge, storm, truncation |
| `src/tools.ts` | Tool registry (all tools register here at startup) |
| `src/mcp/` | MCP client, stdio/SSE transports, registry, spec parser |
| `src/context-manager.ts` | Token-budget-aware context window management |
| `src/client.ts` | DeepSeek API client (HTTP SSE streaming) |
| `src/code/` | SEARCH/REPLACE edit-block parser + apply gate |
| `src/index/` | Semantic vector index for project knowledge |
| `src/ports/` | Port interfaces (ModelClient, ToolHost, EventSink, MemoryStore, HookRunner, CheckpointStore) |
| `src/adapters/` | Concrete adapters for ports |
| `src/memory/` | Session / runtime / user / project memory stores |
| `src/transcript/` | Transcript log writer, diff, replay |
| `src/telemetry/` | Usage records, cross-session stats |
| `src/hooks.ts` | Hook runner — project-level hooks (CLAUDE.md) |
| `src/frame/` | Frame compiler (cell grid → ANSI) for the TUI log renderer |
| `src/server/` | Dashboard HTTP server + JSON API |
| `src/tokenizer.ts` | DeepSeek tokenizer (uses bundled `data/deepseek-tokenizer.json.gz`) |
| `tests/` | Vitest tests, flat `*.test.ts` naming |

**Data flow:** `cli/command` → `loop.ts` (event-log kernel) → model call (via `client.ts`) → tool results → repair if needed → loop repeats. Events stream out through the `EventSink` port → adapter → IPC/file.

### Desktop app (`desktop/`)

Tauri v2 app — embedded Node.js kernel spawned as a child process, communicates via JSON-line IPC (`rpc.rs`).

| Path | Role |
|---|---|
| `desktop/src/App.tsx` | Root app component: Tauri event listener, tab lifecycle, session/scroll persistence, state reducer |
| `desktop/src/ui/thread.tsx` | Message thread: user and assistant message rendering |
| `desktop/src/ui/cards.tsx` | Tool/shell/reasoning card components rendered in message thread |
| `desktop/src/ui/composer.tsx` | Chat composer: textarea, mode switch, @-mention, slash commands |
| `desktop/src/ui/sidebar.tsx` | Session sidebar: workspace folders, pins, context menu |
| `desktop/src/Markdown.tsx` | react-markdown renderer with code blocks, file pills, workspace links |
| `desktop/src/ui/useAutoScroll.ts` | Hook: smart auto-scroll, pin-to-bottom detection |
| `desktop/src/protocol.ts` | All IPC event/command types shared between kernel and desktop |
| `desktop/src/styles.css` | Single CSS file — all component styling |
| `desktop/src-tauri/src/main.rs` | Tauri backend: child-process management, filesystem commands |
| `desktop/src-tauri/src/rpc.rs` | Tauri commands: `rpc_spawn`, `rpc_send`, `rpc_kill` |

**IPC flow:** `user types → composer.tsx → invoke("rpc_send", JSON line) → Tauri rpc.rs → stdin of Node.js kernel process → events flow back via rpc:event → App.tsx dispatches to TabRuntime reducer → React re-render`

### Rust crates (`crates/`)
- `reasonix-render` — Rust port of the frame renderer (used by `src/frame/` as a native addon)

## Build & Dev Commands

### CLI
```sh
npm run build      # tsup → dist/
npm run dev        # tsx src/cli/index.ts     (fast iteration, no build needed)
npm run chat       # alias for `tsx src/cli/index.ts chat`
npm run test       # vitest run
npm run test:watch # vitest
npm run lint       # biome check src tests
npm run format     # biome format --write src tests
npm run typecheck  # tsc --noEmit
npm run verify     # build + lint + typecheck + test
```

### Desktop
```sh
cd desktop
npm run dev        # Vite dev server (HMR)
npm run tauri dev  # Full Tauri dev (Vite HMR + native window)
npm run tauri build # Production build
```

### Watch
- **CLI changes** in `src/` need `npm run build` to take effect in the desktop app (the kernel is the bundled JS)
- **Desktop changes** in `desktop/src/` hot-reload via Vite HMR (no rebuild needed)
- **Tauri Rust changes** need `tauri dev` restart

## Conventions

- **Imports:** `import type` for type-only imports. Direct relative imports only — no barrel re-exports.
- **Exports:** Named exports only. No `export default`.
- **Types:** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Tools receive `ToolCallContext` (abort signal). Events are discriminated unions.
- **Format:** Biome — 2-space indent, double quotes, semicolons always, 100 line width.
- **Desktop CSS:** All styles in `styles.css` — no CSS modules or CSS-in-JS. Theme defined via CSS custom properties (oklch colors).
- **Tests:** Vitest, `describe`/`it`/`expect`, no globals. Test files flat in `tests/`.
- **Changelog:** Keep a Changelog format (CHANGELOG.md). Semver.
- **Pre-commit hook:** `npm run lint` runs biome check on all files. Pre-push runs full `verify`.

## Key Patterns

- **Event-sourced state:** The reducer pattern in `src/core/` (events→state) is used by both the kernel and desktop App.tsx. The desktop app has its own reducer that mirrors the kernel's state for rendering.
- **Tab lifecycle:** Each tab has its own `TabRuntime` with an independent reducer. Tabs are tracked in `tabs[]` at the top level. Busy state propagates via `onBusyChange` callback.
- **Session persistence:** `reasonix.*` keys in localStorage. Desktop saves last session name + per-session scroll positions. On startup, first blank tab auto-loads the last session.
- **MCP tools:** All implement `McpTransport` (stdio or SSE). Registered via `ToolRegistry` in `src/tools.ts`.
- **SEARCH/REPLACE gate:** The code-edit system in `src/code/` enforces exact byte-for-byte SEARCH block matching. Trailing whitespace or wrong indent → mismatch.
