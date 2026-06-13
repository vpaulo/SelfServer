import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Events } from "@wailsio/runtime";
import { SelfServerService } from "../../bindings/self_server/internal/services";

class PtyTerminalElement extends HTMLElement {
  terminal = null;
  fit_addon = null;
  resize_observer = null;
  running = false;
  _mounted = false;
  _buf = []; // Uint8Array chunks buffered before mount
  _off_data = null; // cleanup fn from Events.On("pty:data")
  _off_done = null; // cleanup fn from Events.On("pty:done")

  static get observedAttributes() {
    return ["id", "readonly"];
  }

  connectedCallback() {
    this.pty_id = this.getAttribute("id");
    this.is_readonly = this.hasAttribute("readonly");

    // Register per-instance handlers.
    // Events.On returns a cleanup fn — store it so disconnectedCallback
    // can remove ONLY this terminal's handler without nuking all others.
    this._off_data = Events.On("pty:data", ({ data }) => {
      if (data.ID !== this.pty_id) return;
      const raw = Uint8Array.from(atob(data.Data), (c) => c.charCodeAt(0));
      if (this._mounted) {
        this.terminal.write(raw);
      } else {
        this._buf.push(raw);
      }
    });

    this._off_done = Events.On("pty:done", ({ data }) => {
      if (data.ID !== this.pty_id) return;
      this.running = false;
      const color = data.ExitCode === 0 ? "\x1b[32m" : "\x1b[31m";
      const msg = `\r\n${color}[process exited with code ${data.ExitCode}]\x1b[0m`;
      if (this._mounted) {
        this.terminal.writeln(msg);
      } else {
        this._buf.push(new TextEncoder().encode(msg));
      }
    });
  }

  attributeChangedCallback(name, _old, val) {
    if (name === "id") this.pty_id = val;
  }

  disconnectedCallback() {
    // Remove only THIS terminal's listeners — not all "pty:data" handlers
    this._off_data?.();
    this._off_done?.();
    this.resize_observer?.disconnect();
    this.terminal?.dispose();
    this._mounted = false;
    this._buf = [];
  }

  // Called by log_context.show() when this terminal becomes visible
  reveal() {
    if (!this._mounted) this._mount();
    this.fit_addon.fit();
  }

  _mount() {
    this._mounted = true;

    const viewport = document.createElement("div");
    viewport.className = "pty-viewport";
    this.appendChild(viewport);

    this.terminal = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontSize: 12,
      fontFamily: "monospace",
      theme: {
        background: "#141414",
        foreground: "#ffffff",
        cursor: "#ffffff",
      },
    });

    this.fit_addon = new FitAddon();
    this.terminal.loadAddon(this.fit_addon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.open(viewport);
    this.fit_addon.fit();

    this.terminal.onResize(({ cols, rows }) => {
      if (this.pty_id && this.running) {
        SelfServerService.PTYResize(this.pty_id, cols, rows).catch(() => {});
      }
    });

    this.resize_observer = new ResizeObserver(() => this.fit_addon.fit());
    this.resize_observer.observe(viewport);

    if (!this.is_readonly) {
      this.terminal.onData((data) => {
        if (!this.running || !this.pty_id) return;
        SelfServerService.PTYWrite(this.pty_id, btoa(data)).catch(() => {});
      });
    }

    // Flush buffered data (pre-mount events + optional history replay)
    for (const chunk of this._buf) this.terminal.write(chunk);
    this._buf = [];
  }

  // Called when app reloads and the PTY is still alive in Go
  mark_running() {
    this.running = true;
    // Raw log replay is intentionally omitted: replaying escape sequences
    // can corrupt xterm's internal state (alternate screen, cursor pos, etc.)
    // and break subsequent terminal.reset() + write() calls.
    // Live pty:data events since connectedCallback are already buffered in _buf.
  }

  async start(dir, scriptName, pm) {
    if (this.running) return;
    if (!this._mounted) this.reveal();
    this.terminal.reset();
    const { cols, rows } = this.terminal;
    try {
      await SelfServerService.RunScript(
        this.pty_id,
        dir,
        scriptName,
        pm,
        cols,
        rows,
      );
      this.running = true;
    } catch (err) {
      this.terminal.writeln(`\x1b[31m[error] ${err.message ?? err}\x1b[0m`);
    }
  }

  async stop() {
    if (!this.running) return;
    try {
      await SelfServerService.StopScript(this.pty_id);
    } catch (err) {
      if (this._mounted)
        this.terminal.writeln(
          `\x1b[31m[stop error] ${err.message ?? err}\x1b[0m`,
        );
    }
    // Set running=false here so terminal.start() isn't blocked by a pty:done
    // event that may arrive slightly after the StopScript binding returns.
    this.running = false;
  }

  clear() {
    this.terminal?.clear();
  }
}

if (!customElements.getName(PtyTerminalElement)) {
  customElements.define("ss-terminal", PtyTerminalElement);
}
