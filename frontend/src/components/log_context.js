import { Events } from "@wailsio/runtime";

class LogContextElement extends HTMLElement {
  cleanup = [];
  terminals = new Map(); // source → <ss-terminal>
  current = null;

  render() {
    this.innerHTML = `
      <div class="log-context">
        <div class="log-context-header" hidden>
          <span class="log-context-title"></span>
          <button class="log-clear" title="Clear output">clear</button>
        </div>
        <div class="log-context-panels" data-empty></div>
      </div>
    `;
  }

  connectedCallback() {
    this.render();

    this.header_el = this.querySelector(".log-context-header");
    this.title_el = this.querySelector(".log-context-title");
    this.panels_el = this.querySelector(".log-context-panels");
    this.clear_btn = this.querySelector(".log-clear");

    // Create a readonly PTY terminal when a live server starts
    Events.On("server:started", ({ data }) => {
      const source = `server:${data.port}`;
      this.ensure_terminal(source, `:${data.port}`, { readonly: true });
    });

    // Script added to sidebar — pre-create its terminal so no output is missed
    const on_add = (e) => {
      const { source, label, dir, script, pm } = e.detail;
      this.ensure_terminal(source, label, { dir, script, pm });
    };
    document.addEventListener("process-add", on_add);
    this.cleanup.push(() =>
      document.removeEventListener("process-add", on_add),
    );

    // Script removed from sidebar — clean up its terminal
    const on_remove = (e) => {
      const { source } = e.detail;
      const term = this.terminals.get(source);
      if (term) {
        term.remove();
        this.terminals.delete(source);
      }
      if (this.current === source) {
        this.current = null;
        this.header_el.setAttribute("hidden", "");
        this.panels_el.setAttribute("data-empty", "");
      }
    };
    document.addEventListener("process-remove", on_remove);
    this.cleanup.push(() =>
      document.removeEventListener("process-remove", on_remove),
    );

    // Show the terminal for the selected process
    const on_select = (e) => {
      const { source, label, dir, script, pm } = e.detail;
      this.ensure_terminal(source, label, {
        dir,
        script,
        pm,
        readonly: !script,
      });
      this.show(source, label);
    };
    document.addEventListener("process-selected", on_select);
    this.cleanup.push(() =>
      document.removeEventListener("process-selected", on_select),
    );

    this.clear_btn.addEventListener("click", () => {
      const term = this.terminals.get(this.current);
      if (term) term.clear();
    });
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
    // Events.Off("server:started");
  }

  ensure_terminal(source, label, { dir, script, pm, readonly } = {}) {
    if (this.terminals.has(source)) return;

    const term = document.createElement("ss-terminal");
    term.setAttribute("id", source);
    if (readonly || !script) term.setAttribute("readonly", "");
    term.setAttribute("hidden", "");

    this.panels_el.appendChild(term);
    this.terminals.set(source, term);
  }

  show(source, label) {
    this.current = source;
    this.title_el.textContent = label;
    this.panels_el.removeAttribute("data-empty");
    this.header_el.removeAttribute("hidden");

    this.terminals.forEach((term, key) => {
      const hide = key !== source;
      term.toggleAttribute("hidden", hide);
      if (!hide) term.reveal();
    });
  }
}

if (!customElements.getName(LogContextElement)) {
  customElements.define("ss-log-context", LogContextElement);
}
