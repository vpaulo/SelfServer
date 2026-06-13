import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch, escape_html } from "../helpers/try_catch";

class CommandElement extends HTMLElement {
  cleanup = [];
  running = false;

  static get observedAttributes() {
    return ["id", "name", "command", "dir", "pm", "project-name"];
  }

  listen(target, type, handler, options) {
    console.assert(!!target, `CommandScript: missing target for "${type}"`);
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  render() {
    this.innerHTML = `
      <div class="command">
        <div class="cmd-info">
          <span class="cmd-icon idle">▶</span>
          <span class="cmd-name">${escape_html(this.script_name)}</span>
          <span class="cmd-preview">${escape_html(this.raw_command)}</span>
        </div>
        <div class="cmd-actions">
          <button class="act-btn run-btn" title="Run">▶</button>
          <button class="act-btn rerun-btn hidden" title="Rerun">↺</button>
          <button class="act-btn stop-btn hidden" title="Stop">■</button>
          <button class="act-btn remove-btn" title="Remove">✕</button>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.script_id = this.getAttribute("id");
    this.script_name = this.getAttribute("name");
    this.raw_command = this.getAttribute("command");
    this.pkg_dir = this.getAttribute("dir"); // avoid HTMLElement.dir collision
    this.pm = this.getAttribute("pm") || "npm";
    this.project_name = this.getAttribute("project-name") || "";

    this.render();

    this.cmd_icon = this.querySelector(".cmd-icon");
    this.run_btn = this.querySelector(".run-btn");
    this.rerun_btn = this.querySelector(".rerun-btn");
    this.stop_btn = this.querySelector(".stop-btn");
    this.remove_btn = this.querySelector(".remove-btn");

    this.listen(this.querySelector(".cmd-info"), "click", () => {
      document.dispatchEvent(
        new CustomEvent("process-selected", {
          detail: {
            source: this.script_id,
            label: this.script_name,
            dir: this.pkg_dir,
            script: this.script_name,
            pm: this.pm,
          },
        }),
      );
    });

    this.listen(this.run_btn, "click", () => this.start());
    this.listen(this.rerun_btn, "click", () => this.rerun());
    this.listen(this.stop_btn, "click", () => this.stop());
    this.listen(this.remove_btn, "click", () => this.remove_script());

    document.dispatchEvent(
      new CustomEvent("process-add", {
        detail: {
          source: this.script_id,
          label: this.script_name,
          dir: this.pkg_dir,
          script: this.script_name,
          pm: this.pm,
        },
      }),
    );

    // Sync running state after a frontend reload (backend PTY may still be alive)
    SelfServerService.IsScriptRunning(this.script_id).then((running) => {
      if (!running) return;
      this.set_running(true);
      const terminal = document.querySelector(
        `ss-terminal[id="${this.script_id}"]`,
      );
      if (terminal) terminal.mark_running();
    });
  }

  attributeChangedCallback(name, _old, newValue) {
    if (name === "id") this.script_id = newValue;
    if (name === "name") this.script_name = newValue;
    if (name === "command") this.raw_command = newValue;
    if (name === "dir") this.pkg_dir = newValue; // avoid HTMLElement.dir collision
    if (name === "pm") this.pm = newValue;
    if (name === "project-name") this.project_name = newValue;
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
    document.dispatchEvent(
      new CustomEvent("process-remove", { detail: { source: this.script_id } }),
    );
  }

  async start() {
    this.set_running(true);

    document.dispatchEvent(
      new CustomEvent("process-selected", {
        detail: {
          source: this.script_id,
          label: this.script_name,
          dir: this.pkg_dir,
          script: this.script_name,
          pm: this.pm,
        },
      }),
    );

    const terminal = document.querySelector(
      `ss-terminal[id="${this.script_id}"]`,
    );
    if (terminal) {
      await terminal.start(this.pkg_dir, this.script_name, this.pm);
      if (!terminal.running) this.set_running(false);
    } else {
      this.set_running(false);
    }
  }

  async stop() {
    const terminal = document.querySelector(
      `ss-terminal[id="${this.script_id}"]`,
    );
    const [err] = await try_catch(terminal?.stop(), "StopScript");
    if (err) console.error(err);
    this.set_running(false);
  }

  async rerun() {
    await this.stop();
    await this.start();
  }

  async remove_script() {
    if (this.running) await this.stop();
    const [err] = await try_catch(
      SelfServerService.RemoveScript(
        this.project_name,
        this.pkg_dir,
        this.script_name,
      ),
      "RemoveScript",
    );
    if (err) {
      console.error(err);
      return;
    }

    const proc = this.closest("ss-commands-process");
    if (proc) proc.decrement_count();
    this.remove();
  }

  set_running(running) {
    this.running = running;
    this.cmd_icon.classList.toggle("idle", !running);
    this.cmd_icon.classList.toggle("running", running);
    this.cmd_icon.textContent = running ? "■" : "▶";
    this.run_btn.classList.toggle("hidden", running);
    this.rerun_btn.classList.toggle("hidden", !running);
    this.stop_btn.classList.toggle("hidden", !running);
  }
}

if (!customElements.getName(CommandElement)) {
  customElements.define("ss-command", CommandElement);
}
