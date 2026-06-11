import { Events } from "@wailsio/runtime";
import { SelfServerService } from "../../bindings/self_server/internal/services";
import { dialog_add_project } from "../dialogs";

const THEMES = [null, "dark", "light"]; // null = follow system
const ICONS = { null: "◑", dark: "●", light: "○" };
const LABELS = { null: "system", dark: "dark", light: "light" };

class PlaygroundElement extends HTMLElement {
  cleanup = [];
  projects_container;
  add_project_btn;
  theme_btn;

  theme;

  listen(target, type, handler, options) {
    console.assert(!!target, "Target does not exist");
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  connectedCallback() {
    this.projects_container = this.querySelector(".projects__container");
    this.add_project_btn = this.querySelector("#add-project-btn");
    this.theme_btn = this.querySelector("#theme-toggle-btn");

    dialog_add_project.init();

    this.init_theme();

    this.listen(this.add_project_btn, "click", () =>
      this.show_add_project_modal(),
    );
    this.listen(this.theme_btn, "click", () => this.toggle_theme());
    this.listen(document, "project:new", ({ detail }) => {
      if (!detail.project_name?.trim()) return;
      console.log(">>> ADD PROJECT: ", detail);
      this.add_project({
        Name: detail.project_name.trim(),
        Servers: [],
        Commands: [],
      });
    });

    Events.On("update:projects", ({ data: projects }) => {
      (projects ?? []).forEach((project) => {
        this.add_project(project);
      });
    });

    SelfServerService.AppReady();
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
    dialog_add_project.clean();
    Events.OffAll(); // Remove all events on playground removal
  }

  show_add_project_modal() {
    dialog_add_project.dialog.showModal();
  }

  add_project(project_data) {
    const el = document.createElement("ss-project");
    el.setAttribute("name", project_data.Name);
    this.projects_container.appendChild(el);
    el.load(project_data);
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
