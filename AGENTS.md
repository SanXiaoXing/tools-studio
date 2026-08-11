# AGENTS.md — Assets Studio

Desktop image-workflow tool (drag → compress → upload → copy Markdown link). Currently a fresh **Tauri 2 + Vite 6 + Vanilla TypeScript** scaffold: frontend lives at repo root (`src/`, `index.html`), Rust backend in `src-tauri/`.

## Commands

- `npm run tauri dev` — full dev (runs `npm run dev` as `beforeDevCommand`; Vite serves on fixed port **1420, strictPort** — dev fails if the port is busy).
- `npm run build` — `tsc && vite build` (frontend type-check + build; Rust untouched).
- `npm run tauri build` — release bundle (runs `npm run build` via `beforeBuildCommand`; `frontendDist` is `../dist`).
- `cargo check` / `cargo test` — run inside `src-tauri/` for the Rust side.
- **No lint / test / format scripts exist** for the frontend. `tsconfig.json` enforces `strict`, `noUnusedLocals`, `noUnusedParameters`.

## Docs are the contract — but not the reality

`docs/` (all in Chinese) defines the intended product: `PRD.md` (spec), `DECISIONS.md` (ADRs), `Architecture.md`, `API.md`. **Read them before implementing.** Gotchas:

- Docs describe a future state: React frontend, pnpm monorepo (`apps/desktop`, `apps/worker`, `packages/shared`), Cloudflare Worker + R2. **None of that exists yet** — the code is a stock `greet` template. Treat docs as requirements, not as a description of current code.
- `docs/assets/worker.md` is a bundled/compiled reference of an older worker — not source, don't edit.

## Design rules from DECISIONS.md (follow when implementing)

- Business logic in Rust (`commands/ → services/ → models/`), presentation only in frontend — no image bytes/HTTP/Base64 in JS (D-002).
- Commands only start jobs, return `Result<(), AppError>`; results/progress/errors go via **Tauri Events** (D-003).
- `Job` = one user workflow; `ProcessResult` = `ImageInfo` + `OutputFormats`; generate all formats, consumer picks by UI state (D-004/005/006).
- Pure-Rust image crates only (`oxipng` + `image`), zero C dependencies (D-001).
- Worker = storage gateway only (`PUT/DELETE/GET /objects`, `X-API-Key`), never image processing (D-007).
- Code organization: keep files focused on a single responsibility. Do not put all components, functions, or utilities into one file. Extract reusable components, helper functions, and independent modules into dedicated files, and prefer reuse/composition over duplicating similar code.

## Other gotchas

- `src-tauri/src/lib.rs` is named `assets_studio_lib` — the `_lib` suffix is required to avoid a Windows crate-name conflict; `main.rs` calls `assets_studio_lib::run()`.
- Do **not** remove `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` from `main.rs`.
- New plugin/command permissions must be declared in `src-tauri/capabilities/default.json`. `withGlobalTauri: true`.
- `src-tauri/gen/` is generated — never edit.
- v1 has no settings UI; config is `%USERPROFILE%\.assets-studio\config.json` (Windows) / `~/.assets-studio/config.json` (macOS).
