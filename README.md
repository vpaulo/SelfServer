# SelfServer

```
────────────────────────────────────────────
  ⊹ ࣪ ˖  SelfServer  — local dev, no fuss
────────────────────────────────────────────
```

A desktop app for local front-end development. Drop in a folder and get a live-reloading static server. Add a `package.json` and run your scripts from embedded terminals — all organised by project, all in one window.

No Node daemon to babysit. No browser extension. No config to write.

## Features

- **Live Server** — serves any folder as a static site with instant live reload.<br>　<sub>WebSocket-based · CSS hot-swap without full reload · file-watcher with debounce · path-traversal protection</sub>
- **Script Runner** — run `npm`, `yarn`, or `pnpm` scripts in real embedded terminals.<br>　<sub>PTY · xterm.js · auto-detects package manager · rerun / stop controls · log buffer</sub>
- **Port Manager** — see what's listening in the 5000–5100 range and kill it with one click.<br>　<sub>lsof / netstat · SIGTERM → SIGKILL escalation · works on Linux, macOS, Windows</sub>
- **Multi-project** — group servers and script packages under named projects.<br>　<sub>persisted to TOML · survives restarts · per-project add / remove</sub>
- **Zero runtime deps** — single binary, ships its own web UI, config lives in your user config dir.

## Quick Start

Download the latest release for your platform from the [Releases](../../releases) page, unzip, and run `SelfServer`.

On first launch the app creates an empty config at:

| Platform | Path |
|---|---|
| Linux | `~/.config/SelfServer/self_servers.toml` |
| macOS | `~/Library/Application Support/SelfServer/self_servers.toml` |
| Windows | `%APPDATA%\SelfServer\self_servers.toml` |

Everything is configured from inside the UI — no manual TOML editing needed.

## Usage

### Live Server

1. Click **＋ server** inside any project.
2. Pick a folder, give it a name, confirm the port (suggested automatically).
3. Hit ▶ to start — a URL appears, click it to open in the browser.
4. Edit files in the folder; the browser reloads automatically.

CSS-only changes swap the stylesheet without a full reload. Everything else triggers a full page reload.

### Script Runner

1. Click **＋ commands** inside any project and pick a folder that contains a `package.json`.
2. SelfServer detects `yarn.lock` / `pnpm-lock.yaml` and picks the right package manager.
3. Each script in `scripts` appears as a row — click ▶ to run, ■ to stop, ↺ to rerun.
4. Click the script name to open its terminal panel and see live output.

### Port Manager

The **active ports** panel lists processes listening on ports 5000–5100. Click ✕ next to any entry to send SIGTERM (then SIGKILL if it doesn't exit within 2 s).

If you try to start a live server and the port is taken, SelfServer tells you what process owns it and offers to kill it and retry.

## Config Format

The TOML config is written automatically by the app. The structure, for reference:

```toml
[[project]]
name = "My Site"

[[project.server]]
name    = "frontend"
path    = "/home/user/projects/my-site"
port    = 5000

[[project.command_package]]
path   = "/home/user/projects/my-site"
pm     = "npm"
hidden_script = ["prepare", "postinstall"]   # scripts hidden from the UI
```

## Build from Source

**Requirements:** Go 1.24+, Node 18+, [Wails v3](https://v3.wails.io), [Task](https://taskfile.dev).

```bash
git clone <repo-url>
cd SelfServer

# Development (hot-reload, no packaging)
task dev

# Production binary
task build

# Packaged installer (platform-specific)
task package
```

Cross-compilation via Docker:

```bash
task setup:docker   # one-time: pulls the cross-compile image (~800 MB)
# then use your platform's cross-build tasks
```

Server mode (headless HTTP, no GUI):

```bash
task build:server
task run:server

# or Docker
task build:docker
task run:docker
```

## Architecture

```
main.go                        # Wails app entry point
internal/
  config/   config.go          # TOML load / save
  server/   server.go          # static file server + WebSocket hub + fsnotify watcher
            manager.go         # start / stop / restart lifecycle, concurrency
            kill.go            # port owner lookup + force-kill (lsof / netstat)
  services/ self_server.go     # Wails service: all bindings exposed to the frontend
frontend/src/
  components/                  # vanilla JS web components (no framework)
  dialogs/                     # modal dialogs (add project, add live server)
  helpers/                     # try_catch, escape_html
build/                         # platform Taskfiles, icons, Dockerfiles
```

## License

MIT — see [LICENSE](LICENSE).
