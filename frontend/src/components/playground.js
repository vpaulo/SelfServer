const THEMES = [null, "dark", "light"]; // null = follow system
const ICONS = { null: "◑", dark: "●", light: "○" };
const LABELS = { null: "system", dark: "dark", light: "light" };

class PlaygroundElement extends HTMLElement {
  cleanup = [];
  projects_container;
  theme_btn;

  theme;

  listen(target, type, handler, options) {
    console.assert(!!target, "Target does not exist");
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  connectedCallback() {
    this.projects_container = this.querySelector(".projects__container");
    this.theme_btn = this.querySelector("#theme-toggle-btn");

    this.init_theme();

    this.listen(this.theme_btn, "click", () => this.toggle_theme());
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
    dialog_add_live_server.clean();
  }

  init_theme() {
    this.theme = localStorage.getItem("theme") || null;
    this.apply_theme();
  }

  apply_theme() {
    if (this.theme) {
      document.documentElement.dataset.theme = this.theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    this.theme_btn.textContent = ICONS[this.theme];
    this.theme_btn.title = `Theme: ${LABELS[this.theme]}`;
  }

  toggle_theme() {
    this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
    localStorage.setItem("theme", this.theme ?? "");
    this.apply_theme();
  }
}

if (!customElements.getName(PlaygroundElement)) {
  customElements.define("ss-playground", PlaygroundElement);
}
