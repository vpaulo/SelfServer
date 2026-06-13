import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch } from "../helpers/try_catch";

class CommandsProcessElement extends HTMLElement {
  cleanup = [];
  total_count = 0;

  render() {
    this.innerHTML = `
      <details class="processes">
        <summary>
          <div class="sub-header">
            <span class="chevron"></span>
            commands
            <span class="sub-count"><span class="total">0</span></span>
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
    this.total_el = this.querySelector(".sub-count .total");
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
  }

  decrement_count(by = 1) {
    this.total_count = Math.max(0, this.total_count - by);
    this.total_el.textContent = this.total_count;
  }

  async add_package(
    package_json_path,
    pm,
    projectName,
    persist = true,
    hiddenScripts = [],
  ) {
    const [err, scripts] = await try_catch(
      SelfServerService.ParsePackageJSON(package_json_path),
      "ParsePackageJSON",
    );
    if (err) {
      console.error(err);
      return;
    }

    const dir = package_json_path.replace(/[/\\]package\.json$/i, "");
    const folder = dir.split(/[/\\]/).filter(Boolean).at(-1) ?? dir;
    const hidden = new Set(hiddenScripts);

    const group = document.createElement("div");
    group.className = "pkg-group";
    group.dataset.dir = dir;
    group.dataset.projectName = projectName;
    group.innerHTML = `
      <div class="pkg-label" title="${dir}">
        <span class="pkg-folder">${folder}</span>
        <button class="pkg-remove act-btn" title="Remove package">✕</button>
      </div>
    `;

    group.querySelector(".pkg-remove").addEventListener("click", async () => {
      const [removeErr] = await try_catch(
        SelfServerService.RemoveCommandPackage(projectName, dir),
        "RemoveCommandPackage",
      );
      if (removeErr) {
        console.error(removeErr);
        return;
      }
      const removed = group.querySelectorAll("ss-command").length;
      group.remove();
      this.decrement_count(removed);
    });

    (scripts ?? []).forEach(({ Name, Command }) => {
      if (hidden.has(Name)) return;
      const id = `${dir}:${Name}`;
      const el = document.createElement("ss-command");
      el.setAttribute("id", id);
      el.setAttribute("name", Name);
      el.setAttribute("command", Command);
      el.setAttribute("dir", dir);
      el.setAttribute("pm", pm || "npm");
      el.setAttribute("project-name", projectName);
      group.appendChild(el);
      this.total_count++;
    });

    this.container.appendChild(group);
    this.total_el.textContent = this.total_count;
    this.details.setAttribute("open", "");

    if (persist) {
      const [saveErr] = await try_catch(
        SelfServerService.AddCommandPackage(projectName, dir, pm || "npm"),
        "AddCommandPackage",
      );
      if (saveErr) console.error(saveErr);
    }
  }
}

if (!customElements.getName(CommandsProcessElement)) {
  customElements.define("ss-commands-process", CommandsProcessElement);
}
