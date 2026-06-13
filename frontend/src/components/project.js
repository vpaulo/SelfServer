import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch, escape_html } from "../helpers/try_catch";
import { dialog_add_live_server } from "../dialogs";

class ProjectElement extends HTMLElement {
  cleanup = [];
  name = "";
  live_servers_proc = null;
  commands_proc = null;

  listen(target, type, handler, options) {
    console.assert(!!target, `Project: missing target for "${type}"`);
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  render() {
    this.innerHTML = `
      <details class="project" open>
        <summary>
          <div class="project-header">
            <span class="chevron"></span>
            <span class="project-name">${escape_html(this.name)}</span>
            <span class="project-remove" title="Remove project">✕</span>
          </div>
        </summary>
        <div class="project-body">
          <ss-live-server-process></ss-live-server-process>
          <ss-commands-process></ss-commands-process>
          <div class="project-actions">
            <button type="button" class="add-server-btn proj-add-btn">＋ server</button>
            <button type="button" class="add-commands-btn proj-add-btn">＋ commands</button>
          </div>
        </div>
      </details>
    `;
  }

  connectedCallback() {
    this.name = this.getAttribute("name") || "Project";
    this.render();

    this.live_servers_proc = this.querySelector("ss-live-server-process");
    this.commands_proc = this.querySelector("ss-commands-process");

    this.listen(this.querySelector(".project-remove"), "click", (e) =>
      this.remove_project(e),
    );

    this.listen(this.querySelector(".add-server-btn"), "click", () =>
      this.add_server(),
    );

    this.listen(this.querySelector(".add-commands-btn"), "click", () =>
      this.add_command(),
    );

    this.listen(document, "project:server-added", ({ detail }) => {
      if (detail.projectName !== this.name) return;
      this.live_servers_proc.add_server(
        detail.name,
        detail.path,
        detail.port,
        detail.projectName,
      );
    });
  }

  load({ Servers, Commands }) {
    (Servers ?? []).forEach(({ Name, Path, Port }) => {
      this.live_servers_proc.add_server(Name, Path, Port, this.name);
    });
    (Commands ?? []).forEach(({ Path, PM, HiddenScripts }) => {
      this.commands_proc.add_package(
        `${Path}/package.json`,
        PM,
        this.name,
        false,
        HiddenScripts ?? [],
      );
    });
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => {
      fn();
    });
    this.cleanup = [];
    dialog_add_live_server.clean();
  }

  async remove_project(e) {
    e.stopPropagation();
    if (!confirm(`Remove project "${this.name}"?`)) return;

    const [err] = await try_catch(SelfServerService.RemoveProject(this.name));
    if (err) {
      console.error(err);
      return;
    }
    this.remove();
  }

  add_server() {
    dialog_add_live_server.init(this.name);
    dialog_add_live_server.dialog.showModal();
  }

  async add_command() {
    const [err, dir] = await try_catch(SelfServerService.PickFolder());
    if (err || !dir || dir.startsWith("Error") || dir === "Cancelled") return;

    const [, pm] = await try_catch(SelfServerService.DetectPackageManager(dir));
    // TODO: handle error for DetectPackageManager

    await this.commands_proc.add_package(
      `${dir}/package.json`,
      pm || "npm",
      this.name,
    );
  }
}

if (!customElements.getName(ProjectElement)) {
  customElements.define("ss-project", ProjectElement);
}
