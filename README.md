# Veil

**The next-generation Steam manifest installer for Windows.**

Veil is a desktop application that installs Steam manifests and their supporting files into a local Steam client, with a modern UI, integrity checking, and automatic self-repair. It is designed to be fast, reliable, and completely self-contained — no browser extensions, no command-line tools, no manual file shuffling.

[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-0A7BBB?style=flat-square)](#requirements)
[![Release](https://img.shields.io/github/v/release/Zyhloh/veil?style=flat-square&color=0A7BBB)](https://github.com/Zyhloh/veil/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-0A7BBB?style=flat-square)](#license)

---

## Features

- **One-click install.** Drop a `.zip`, `.lua`, or `.manifest` file onto the app and Veil routes every file into the correct location inside your Steam installation.
- **Library view.** See every installed manifest grouped by base game, with DLC automatically detected and nested under its parent. Uninstall any app with a single click.
- **Self-healing install.** Veil's injected files are SHA-256 verified continuously while the app is open. If anything goes missing or gets tampered with, Veil repairs it without user intervention.
- **Runs invisibly.** All background process checks use `CREATE_NO_WINDOW`, so there are no stray console windows flashing on your desktop.
- **Built-in updater.** Veil checks GitHub Releases on startup and notifies you when a new version is available. One click downloads and launches the installer.
- **No backend.** There is no telemetry, no account, no external service beyond the public GitHub API for update checks.

## Requirements

- Windows 10 or later (x64)
- A working Steam installation
- Administrator rights are **not** required for normal use

## Installation

1. Download the latest `Veil_x.y.z_x64-setup.exe` from the [Releases page](https://github.com/Zyhloh/veil/releases/latest).
2. Run the installer and follow the prompts.
3. Launch Veil from the Start menu.

On first launch Veil will auto-detect your Steam installation path. You can override it in **Settings** if needed.

## Usage

### Installing manifests

1. Open the **Install** page.
2. Drop a `.zip`, `.lua`, or `.manifest` file onto the drop zone (or click to browse).
3. Veil extracts and places every file into the correct Steam directory:
   - `.lua` files go to `config/stplug-in/`
   - `.manifest` files go to both `config/depotcache/` and `depotcache/`
4. Restart Steam when prompted.

### Managing your library

The **Library** tab lists every app you have installed via Veil. Base games and their DLCs are grouped automatically using data from the public Steam API. Click **Uninstall** on any entry to remove the associated `.lua` and `.manifest` files.

### Enabling Veil injection

In **Settings**, toggle **Enable Veil** to install the required DLL shim (`dwmapi.dll` and `xinput1_4.dll`) and supporting files into your Steam directory. A watchdog will keep those files in sync while Veil is running — if something deletes or replaces them, Veil will restore the correct copies automatically.

Toggling the setting off cleanly removes everything Veil installed.

### Updating

Veil checks `github.com/Zyhloh/veil/releases/latest` on startup. When a newer release is available, a small indicator appears next to the Settings tab and the **Updates** card lights up. Click **Update now** to download the latest installer and hand off to it.

## How it works

Veil is a [Tauri](https://tauri.app) application — a Rust backend bundled with a React frontend, rendered via the system WebView. All file I/O, process management, and HTTP requests happen in the Rust layer; the UI is pure presentation.

- **Install logic** lives in [`src-tauri/src/commands/veil.rs`](src-tauri/src/commands/veil.rs). It hashes every bundled file against its on-disk counterpart and only rewrites mismatches. Before touching files that Steam holds locks on, it gracefully stops the Steam processes, waits for handles to release, writes, and re-verifies.
- **Manifest routing** lives in [`src-tauri/src/commands/veil.rs`](src-tauri/src/commands/veil.rs) as well — `install_manifest_paths` handles zip extraction and per-extension dispatch.
- **The watchdog** is a ~4-second interval in [`src/hooks/useAppInit.ts`](src/hooks/useAppInit.ts) that calls a read-only `verify_veil_dll` command and triggers a repair if anything is out of sync.
- **Auto-update** is a thin wrapper around the public GitHub Releases API in [`src-tauri/src/commands/updater.rs`](src-tauri/src/commands/updater.rs). Downloads are restricted to the `github.com` and `objects.githubusercontent.com` hosts.

## Building from source

### Prerequisites

- [Rust](https://rustup.rs/) 1.77.2 or newer
- [Node.js](https://nodejs.org/) 20 or newer
- Windows 10+ with the WebView2 runtime (present on modern Windows by default)
- Microsoft Visual C++ Build Tools (installed automatically by `rustup` on Windows)

### Build

```bash
git clone https://github.com/Zyhloh/veil.git
cd veil
npm install
npm run tauri:build
```

The installer and MSI will be written to:

```
src-tauri/target/release/bundle/nsis/Veil_<version>_x64-setup.exe
src-tauri/target/release/bundle/msi/Veil_<version>_x64_en-US.msi
```

### Development

```bash
npm run tauri:dev
```

This starts Vite in watch mode and launches Veil with hot module reloading for the frontend. Rust changes trigger a full rebuild on save.

## Project structure

```
veil/
├── src/                    React + TypeScript frontend
│   ├── components/         Layout (sidebar, titlebar)
│   ├── pages/              Install, Library, Settings
│   └── hooks/              App init, update context
├── src-tauri/              Rust backend
│   ├── src/commands/       Tauri command handlers
│   └── resources/          Bundled DLLs and config blobs
└── public/                 Static assets
```

## Tech stack

- **Tauri 2** — native shell and IPC
- **Rust** — backend, file I/O, process control, HTTP
- **React 19** + **TypeScript** — UI
- **Tailwind CSS 4** — styling
- **Framer Motion** — transitions
- **Vite** — frontend build

## License

MIT. See the `license` field in [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml).

## Disclaimer

Veil is provided for educational and personal use. Users are solely responsible for ensuring their use of the tool complies with the terms of service of any third-party platform. The authors assume no liability for misuse.
