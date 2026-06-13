import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch } from "../helpers/try_catch";

class ActivePortElement extends HTMLElement {
  cleanup = [];

  static get observedAttributes() {
    return ["port", "pid", "process"];
  }

  listen(target, type, handler, options) {
    console.assert(!!target, `ActivePort: target missing for "${type}"`);
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  render() {
    this.innerHTML = `
      <div class="active-port">
        <div class="port-left">
          <span class="port-dot"></span>
          <span class="port-num">${this.port}</span>
          <span class="port-proc">${this.process_name}</span>
        </div>
        <button class="kill-btn">✕</button>
      </div>
    `;
  }

  connectedCallback() {
    this.port = this.getAttribute("port");
    this.pid = this.getAttribute("pid");
    this.process_name = this.getAttribute("process") || "unknown";

    this.render();

    this.kill_btn = this.querySelector(".kill-btn");
    this.listen(this.kill_btn, "click", () => this.terminate());
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === "port") this.port = newValue;
    if (name === "pid") this.pid = newValue;
    if (name === "process") this.process_name = newValue;
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
  }

  async terminate() {
    this.kill_btn.setAttribute("disabled", "");

    const [err] = await try_catch(
      SelfServerService.TerminatePort(Number(this.port)),
      "TerminatePort",
    );

    if (err) {
      console.error(err);
      this.kill_btn.removeAttribute("disabled");
      return;
    }

    const parent = this.closest("ss-active-ports-process");
    if (parent) parent.decrement();
    this.remove();
  }
}

if (!customElements.getName(ActivePortElement)) {
  customElements.define("ss-active-port", ActivePortElement);
}
