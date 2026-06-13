class LiveServerProcessElement extends HTMLElement {
  static get observedAttributes() {
    return ["active", "total"];
  }

  render() {
    this.innerHTML = `
      <details class="processes">
        <summary>
          <div class="sub-header">
            <span class="chevron"></span>
            live servers
            <span class="sub-count">
              <span class="active active-count">${this.active_count}</span>/<span class="total">${this.total_count}</span>
            </span>
          </div>
        </summary>
        <div class="container"></div>
      </details>
    `;
  }

  connectedCallback() {
    this.active_count = this.getAttribute("active") || "0";
    this.total_count = this.getAttribute("total") || "0";

    this.render();

    this.details = this.querySelector("details");
    this.container = this.details.querySelector(".container");
    this.active_server_count = this.details.querySelector(".active-count");
    this.total_server_count = this.details.querySelector(".sub-count .total");
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === "active") {
      this.active_count = newValue;
      this.active_server_count.innerText = this.active_count;
    }
    if (name === "total") {
      this.total_count = newValue;
      this.total_server_count.innerText = this.total_count;
    }
  }

  disconnectedCallback() {}

  add_server(name, path, port, projectName) {
    const el = document.createElement("ss-live-server");
    el.setAttribute("project-name", projectName || "");
    el.setAttribute("name", name || "");
    el.setAttribute("path", path);
    el.setAttribute("port", port);

    this.container.appendChild(el);
    this.setAttribute("total", Number(this.total_count) + 1);

    if (this.container.children.length > 0) {
      this.details.setAttribute("open", "");
    }
  }
}

if (!customElements.getName(LiveServerProcessElement)) {
  customElements.define("ss-live-server-process", LiveServerProcessElement);
}
