import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch } from "../helpers/try_catch";

class ActivePortsProcessElement extends HTMLElement {
  cleanup = [];
  count = 0;

  listen(target, type, handler, options) {
    console.assert(
      !!target,
      `ActivePortsProcess: target missing for "${type}"`,
    );
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  render() {
    this.innerHTML = `
      <details class="processes">
        <summary>
          <div class="section-header">
            <span class="chevron"></span>
            active ports
            <span class="section-count">${this.count}</span>
            <button class="refresh-btn" title="Refresh">↺</button>
          </div>
        </summary>
        <div class="container"></div>
      </details>
    `;
  }

  connectedCallback() {
    this.render();

    this.details = this.querySelector("details");
    this.container = this.querySelector(".container");
    this.counter_el = this.querySelector(".section-count");
    this.refresh_btn = this.querySelector(".refresh-btn");

    this.listen(this.refresh_btn, "click", (e) => {
      e.stopPropagation();
      this.load();
    });

    this.load();
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
  }

  decrement() {
    this.count = Math.max(0, this.count - 1);
    this.counter_el.textContent = this.count;
  }

  async load() {
    this.refresh_btn.setAttribute("disabled", "");

    const [err, ports] = await try_catch(
      SelfServerService.ListActivePorts(),
      "ListActivePorts",
    );

    this.refresh_btn.removeAttribute("disabled");

    if (err) {
      console.error(err);
      return;
    }

    this.container.innerHTML = "";
    this.count = (ports ?? []).length;
    this.counter_el.textContent = this.count;

    if (this.count > 0) this.details.setAttribute("open", "");

    (ports ?? []).forEach((info) => {
      const el = document.createElement("ss-active-port");
      el.setAttribute("port", info.Port);
      el.setAttribute("pid", info.PID);
      el.setAttribute("process", info.Process);
      this.container.appendChild(el);
    });
  }
}

if (!customElements.getName(ActivePortsProcessElement)) {
  customElements.define("ss-active-ports-process", ActivePortsProcessElement);
}
