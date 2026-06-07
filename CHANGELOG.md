# Changelog

All notable changes to Veil are documented here.

## 2.1.5 — 2026-06-07

### Changed

- The Veil collection in your Steam library is now managed entirely by the loader DLL — the app no longer syncs it, and the Settings toggle for it has been removed.
- Installed luas now go into `config/Veil` (alongside `config/stplug-in`); the `veil-plugin` folder is no longer used.
- `xinput1_4.dll` is once again a managed loader DLL alongside `dwmapi.dll` and `Veil.dll` — hash-checked and replaced on startup/in the background rather than deleted.

### Removed

- App-side mirroring of lua folders. Installs/removals still write to both folders; keeping them in sync is now handled by the DLL.

## 2.1.1 — 2026-06-07

### Fixed

- The Veil collection now updates for games added via the Catalog, drag-and-drop, and Import — not just on startup. The collection is written whenever Veil starts or restarts Steam (while it's closed, so the change sticks), with no forced restart.

## 2.1.0 — 2026-06-07

### Changed

- The Veil loader DLL is now `Veil.dll` (previously `xinput1_4.dll`); `dwmapi.dll` is unchanged.
- Lua plugins are kept mirrored across both `config/veil-plugin` and `config/stplug-in`, so the new and legacy loaders both work. Manifests are unchanged.

### Added

- On startup, on library load, and periodically in the background, Veil keeps the two plugin folders in sync (newest copy wins). Installs and removals apply to both.
- Veil removes the old `xinput1_4.dll` proxy on startup.

## 2.0.4 — 2026-06-06

### Added

- A "Game dump location" setting that lets you choose where dumped manifests are saved.

### Fixed

- The dumper no longer fails when the Documents folder is missing — on first run it uses Documents if present, otherwise falls back to your user folder.

### Changed

- Reorganized the Settings screen with a clearer header and grouped sections (Veil, Locations, Updates, Maintenance).

## 2.0.3 — 2026-06-06

### Added

- A "Join the Veil Discord" banner at the bottom of Settings that opens discord.gg/veilapp in your default browser.

## 2.0.2 — 2026-06-03

### Fixed

- Adding a game or DLC from the Catalog, or from a game's DLC list, now shows the "Steam Restart Required" indicator like drag-and-drop imports already did.
- The DLC list no longer scrolls or jumps when you install an item — entries keep a stable order instead of re-sorting installed items to the top.
- Install All DLC now locks the list while it runs, installs each DLC in turn, and flips each row from "Installing" to "Installed" as it completes.
- The Library search button no longer starts expanded and animate-collapses on load or when switching tabs — it starts as a button.
- Centered the magnifying-glass icon in the collapsed Library search button.
- A Steam path set manually in Settings now persists across restarts, and the Catalog clearly tells you to set your Steam path when none is found instead of failing silently.

## 2.0.1 — 2026-06-03

### Added

- **Library search** — a collapsible search button in the Library toolbar that expands into a full search bar, filtering your library by name or App ID.
- **Install All DLC** — games with DLC now have an Install All DLC button in their dropdown to add every missing DLC at once.

### Fixed

- Installing a single DLC from a long, expanded DLC list no longer scrolls the page back up.

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