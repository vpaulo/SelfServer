import { Events, Browser } from "@wailsio/runtime";
import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch, escape_html } from "../helpers/try_catch";

class LiveServerElement extends HTMLElement {
  cleanup = [];

  static get observedAttributes() {
    return ["name", "path", "port", "project-name"];
  }

  listen(target, type, handler, options) {
    console.assert(!!target, `Target does not exist: ${target}`);
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  render() {
    this.innerHTML = `
      <div class="server">
        <div class="server-info">
          <span class="server-dot stopped"></span>
          <span class="server-name">${escape_html(this.name)}:${escape_html(this.port)}</span>
          <a class="server-url" hidden href="#"></a>
          <span class="error-msg" hidden></span>
        </div>
        <div class="server-actions">
          <button class="act-btn start-btn" title="Start">▶</button>
          <button class="act-btn restart-btn hidden" title="Restart">↺</button>
          <button class="act-btn stop-btn hidden" title="Stop">■</button>
          <button class="act-btn remove-btn" title="Remove">✕</button>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.name = this.getAttribute("name") || "";
    this.path = this.getAttribute("path");
    this.port = this.getAttribute("port");
    this.project_name = this.getAttribute("project-name") || "";

    this.render();

    this.server_dot = this.querySelector(".server-dot");
    this.start_btn = this.querySelector(".start-btn");
    this.restart_btn = this.querySelector(".restart-btn");
    this.stop_btn = this.querySelector(".stop-btn");
    this.remove_btn = this.querySelector(".remove-btn");
    this.url_link = this.querySelector(".server-url");
    this.error_msg = this.querySelector(".error-msg");

    this.listen(this.querySelector(".server-info"), "click", () => {
      document.dispatchEvent(
        new CustomEvent("process-selected", {
          detail: {
            source: `server:${this.port}`,
            label: `${this.name}:${this.port}`,
          },
        }),
      );
    });

    this.listen(this.start_btn, "click", (e) => this.start_server(e));
    this.listen(this.restart_btn, "click", (e) => this.restart_server(e));
    this.listen(this.stop_btn, "click", (e) => this.stop_server(e));
    this.listen(this.remove_btn, "click", (e) => this.remove_server(e));

    this.listen(this.url_link, "click", (e) => {
      e.preventDefault();
      if (this.url_link.dataset.url) Browser.OpenURL(this.url_link.dataset.url);
    });

    // Check if port is already listening on load
    SelfServerService.IsPortListening(Number(this.port)).then((active) => {
      if (!active) return;
      const url = `http://localhost:${this.port}`;
      this.url_link.dataset.url = url;
      this.url_link.textContent = url;
      this.url_link.removeAttribute("hidden");
      this.error_msg.setAttribute("hidden", "");
      this.server_dot.classList.replace("stopped", "running");
      this.start_btn.classList.add("hidden");
      this.restart_btn.classList.remove("hidden");
      this.stop_btn.classList.remove("hidden");
      const parent = this.closest("ss-live-server-process");
      if (parent)
        parent.setAttribute("active", Number(parent.active_count) + 1);
    });

    this._off_started = Events.On("server:started", ({ data }) => {
      if (data.port !== Number(this.port)) return;
      this.url_link.dataset.url = data.url;
      this.url_link.textContent = data.url;
      this.url_link.removeAttribute("hidden");
      this.error_msg.setAttribute("hidden", "");
      this.server_dot.classList.replace("stopped", "running");
      this.start_btn.classList.add("hidden");
      this.restart_btn.classList.remove("hidden");
      this.stop_btn.classList.remove("hidden");

      const parent = this.closest("ss-live-server-process");
      if (parent)
        parent.setAttribute("active", Number(parent.active_count) + 1);
    });

    this._off_stopped = Events.On("server:stopped", ({ data }) => {
      if (data.port !== Number(this.port)) return;
      this.url_link.setAttribute("hidden", "");
      this.server_dot.classList.replace("running", "stopped");
      this.start_btn.classList.remove("hidden");
      this.restart_btn.classList.add("hidden");
      this.stop_btn.classList.add("hidden");

      const parent = this.closest("ss-live-server-process");
      if (parent)
        parent.setAttribute(
          "active",
          Math.max(0, Number(parent.active_count) - 1),
        );
    });

    this._off_error = Events.On("server:error", ({ data }) => {
      if (data.port !== Number(this.port)) return;
      this.start_btn.classList.remove("hidden");
      this.error_msg.textContent = data.message;
      this.error_msg.removeAttribute("hidden");
    });
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (attr === "name") this.name = newValue;
    if (attr === "path") this.path = newValue;
    if (attr === "port") this.port = newValue;
    if (attr === "project-name") this.project_name = newValue;
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
    this._off_started?.();
    this._off_stopped?.();
    this._off_error?.();
  }

  async start_server() {
    this.start_btn.classList.add("hidden"); // optimistic: prevent double-click
    document.dispatchEvent(
      new CustomEvent("process-selected", {
        detail: {
          source: `server:${this.port}`,
          label: `${this.name}:${this.port}`,
        },
      }),
    );
    const [err] = await try_catch(
      SelfServerService.StartServer(this.path, Number(this.port)),
    );
    if (!err) return;

    if (err.message?.includes("address already in use")) {
      const [, ownerName] = await try_catch(
        SelfServerService.PortOwner(Number(this.port)),
      );
      const label = ownerName || "another process";
      if (
        !confirm(`Port ${this.port} is used by "${label}". Kill it and retry?`)
      ) {
        this.start_btn.classList.remove("hidden");
        return;
      }

      const [killErr] = await try_catch(
        SelfServerService.KillPort(Number(this.port)),
      );
      if (killErr) {
        console.error("kill failed:", killErr);
        this.start_btn.classList.remove("hidden");
        return;
      }

      await new Promise((r) => setTimeout(r, 300));
      await try_catch(
        SelfServerService.StartServer(this.path, Number(this.port)),
      );
    } else {
      this.start_btn.classList.remove("hidden");
      console.error(err);
    }
  }

  async restart_server() {
    document.dispatchEvent(
      new CustomEvent("process-selected", {
        detail: {
          source: `server:${this.port}`,
          label: `${this.name}:${this.port}`,
        },
      }),
    );
    const [err] = await try_catch(
      SelfServerService.RestartServer(Number(this.port)),
    );
    if (err) console.error(err);
  }

  async stop_server() {
    const [err] = await try_catch(
      SelfServerService.StopServer(Number(this.port)),
    );
    if (err) console.error(err);
  }

  async remove_server() {
    const [err] = await try_catch(
      SelfServerService.RemoveServer(this.project_name, Number(this.port)),
    );
    if (err) {
      console.error("remove failed:", err);
      return;
    }
    const parent = this.closest("ss-live-server-process");
    this.remove();
    if (parent) {
      parent.setAttribute("total", Number(parent.total_count) - 1);
    }
  }
}

if (!customElements.getName(LiveServerElement)) {
  customElements.define("ss-live-server", LiveServerElement);
}
