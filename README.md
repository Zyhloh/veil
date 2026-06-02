# Veil

A modern Steam manifest manager for Windows. Veil installs game manifests into Steam, keeps them up to date, and bundles the tools around them — a catalog, a manifest dumper, a DLL patcher, and per-game bypasses — behind one clean interface.

Veil 2.0.0 is a full ground-up rewrite built on Tauri 2 (Rust + WebView2) with a React front end.

## Download

Grab the latest installer from the [Releases](../../releases) page and run it. Veil is Windows-only and auto-updates itself on launch.

## Features

- **Library** — every manifest you've installed, with live DLC counts pulled per game, per-DLC install/uninstall, and launch-with/without-Steam.
- **Catalog** — search the full Steam catalog (fuzzy, exact, and by App ID), browse trending titles, view full game details with screenshots, and install games or pick exactly which DLC to add. Missing DLC are appended to the game's lua automatically.
- **Install / Import** — drag and drop `.zip`, `.lua`, or `.manifest` files anywhere in the window, or import from the Library tab. Files are routed to the right Steam folders and missing manifests are backfilled.
- **Patcher** — one-click DLL patches: Capcom cloud-save fix and offline first-run setup, with a restore-to-pristine option.
- **Bypasses** — apply and remove per-game bypasses, with automatic launch-argument handling across all Steam accounts and build-version checks.
- **Dumper** — sign in to Steam (with mobile/2FA support) and dump manifests and depot keys for games you own.
- **Settings** — toggle Veil on/off, manage the Veil collection in your Steam library, change your Steam path, reset Steam's core files, and check for updates.

## How it works

- Manifests are sourced from a primary repository with a fallback, and verified/repaired in the background while Veil is open.
- App art is cached locally on disk so it loads instantly and only downloads once.
- Steam is closed and reopened automatically around operations that need it (patching, bypasses, collection changes).

## Requirements

- Windows 10/11
- Steam

## License

MIT
