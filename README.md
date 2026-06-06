# Veil

A modern Steam manifest manager for Windows. Veil installs game manifests into Steam, keeps them up to date, and bundles the tools around them — a catalog, a manifest dumper, a DLL patcher, cloud-save redirection, and per-game bypasses — behind one clean interface.

Veil 2 is a full ground-up rewrite built on Tauri 2 (Rust + WebView2) with a React front end. The current release is **2.0.4**.

## Download

Grab the latest installer from the [Releases](../../releases) page and run it. Veil is Windows-only and auto-updates itself on launch.

## Features

- **Library** — every manifest you've installed, with live DLC counts pulled per game, per-DLC install/uninstall, and launch-with/without-Steam. Each game also shows whether an online fix exists on online-fix.me, with a one-click link when available (results are cached locally).
- **Catalog** — search the full Steam catalog (fuzzy, exact, and by App ID), browse trending titles, view full game details with screenshots, and install games or pick exactly which DLC to add. Missing DLC are appended to the game's lua automatically.
- **Install / Import** — drag and drop `.zip`, `.lua`, or `.manifest` files anywhere in the window, or import from the Library tab. Files are routed to the right Steam folders and missing manifests are backfilled.
- **Cloud Saves** — redirect Steam Cloud saves for your Veil games to a local folder, leaving your owned Steam games untouched. Applied automatically on startup, with backup and import of your saves as a `.zip`.
- **Patcher** — one-click DLL patches: Capcom cloud-save fix and offline first-run setup, with a restore-to-pristine option.
- **Bypasses** — apply and remove per-game bypasses, with automatic launch-argument handling across all Steam accounts and build-version checks.
- **Dumper** — sign in to Steam (with mobile/2FA support) and dump manifests and depot keys for games you own, saved to a configurable location.
- **Settings** — toggle Veil on/off, manage the Veil collection in your Steam library, change your Steam and game-dump paths, reset Steam's core files, and check for updates.

## How it works

- Manifests are sourced from a primary repository with a fallback, and verified/repaired in the background while Veil is open.
- App art and online-fix lookups are cached locally on disk so they load instantly and only fetch once.
- Cloud Saves works natively inside Steam — saves appear to sync exactly like Steam Cloud, but the data is read and written to your local folder. Only your Veil games are affected; owned games keep using Steam Cloud.
- Steam is closed and reopened automatically around operations that need it (patching, bypasses, collection changes, cloud-save setup).

## Requirements

- Windows 10/11
- Steam

## License

Released under the MIT License — see [LICENSE](LICENSE).
