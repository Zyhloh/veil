# Changelog

All notable changes to Veil are documented here.

## 2.0.0 — 2026-06-02

Veil 2.0.0 is a complete, ground-up rewrite. The app was rebuilt on Tauri 2 (Rust + WebView2) with a new React front end, replacing the previous build entirely. Everything below is new or reworked relative to the 1.x line.

### Added

- **Library** — a single view of every manifest you've installed, with live per-game DLC counts, per-DLC install and uninstall on hover, a library-wide DLC summary, and launch-with-Steam / launch-without-Steam for each title.
- **Catalog** — search the full Steam catalog by name (fuzzy and exact) or by App ID, browse trending titles, and open full game details with screenshots. Install a game outright or pick exactly which DLC to add; missing DLC is appended to the existing game's lua automatically.
- **Drag-and-drop import** — drop `.zip`, `.lua`, or `.manifest` files anywhere in the window at any time, or use the Import button in the Library. Files are routed to the correct Steam folders and any missing manifests are backfilled.
- **Patcher** — one-click DLL patches: Capcom cloud-save fix and offline first-run setup, with a restore-to-pristine option. Custom launch arguments are handled across all Steam accounts.
- **Bypasses** — apply and remove per-game bypasses, with automatic launch-argument handling and build-version checks.
- **Dumper** — sign in to Steam, including mobile confirmation and 2FA, with saved sessions. Dump manifests and depot keys for games you own and open the output folder when a dump finishes.
- **Settings** — toggle Veil on and off, manage the Veil collection in your Steam library, change your Steam path, reset Steam's core files, and check for updates with release notes.
- **Local image cache** — game art is downloaded and stored on disk, so it loads instantly and is only fetched once.
- **Automatic updates** — Veil checks for new versions on launch and updates itself, with an in-app update badge and release notes.

### Changed

- Manifests are now sourced from a primary repository with an automatic fallback, and are verified and repaired in the background while Veil is open and after every import.
- Steam is closed and reopened automatically around operations that require it (patching, bypasses, collection changes, reset).
- All network requests are made from the Rust backend, removing browser CORS limitations entirely.

### Notes

- Veil is Windows-only and requires Steam.
