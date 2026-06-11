import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch } from "../helpers/try_catch";

export const dialog_add_live_server = {
  cleanup: [],
  project_name: "",

  init(project_name) {
    this.dialog = document.getElementById("add-live-server-dialog");
    this.server_name = document.getElementById("add-live-server-name");
    this.folder_picker = document.getElementById(
      "add-live-server-dialog-folder-picker",
    );
    this.folder_input = document.getElementById(
      "add-live-server-dialog-folder-input",
    );
    this.server_port = document.getElementById("add-live-server-port");
    this.server_submit = document.getElementById("add-live-server-submit");
    this.server_cancel = document.getElementById("add-live-server-cancel");

    this.project_name = project_name;
    this.dialog.dataset.projectName = project_name;

    this.listen(this.dialog, "close", () => this.close_handler());
    this.listen(this.dialog, "toggle", () => this.toggle_handler());
    this.listen(this.folder_picker, "click", () =>
      this.folder_picker_handler(),
    );
    this.listen(this.server_submit, "click", (e) => this.submit_handler(e));
    this.listen(this.server_cancel, "click", (e) => this.submit_cancel(e));
  },

  clean() {
    this.cleanup.forEach((clean_call) => {
      clean_call();
    });
    this.cleanup = [];
  },

  listen(target, type, handler, options) {
    console.assert(!!target, "DIALOG: [Add Live Server] Target does not exist");
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  },

  close_handler() {
    this.server_name.value = "";
    this.folder_input.value = "";
    this.server_port.value = "";
  },

  async toggle_handler() {
    if (!this.dialog.open) return;
    const [err, port] = await try_catch(SelfServerService.SuggestPort());
    if (!err) this.server_port.value = port;
  },

  async folder_picker_handler() {
    try {
      const path = await SelfServerService.PickFolder();
      this.folder_input.value = path;
    } catch (err) {
      console.error(err);
    }
  },

  async submit_handler(event) {
    event.preventDefault();

    let is_valid_form = true;

    if (this.folder_input.value === "") {
      // TODO: this validation causes a flicker in the app
      this.folder_input.setCustomValidity("Directory path is required.");
      this.folder_input.reportValidity();
      is_valid_form = false;
    }
    if (this.server_port.value === "") {
      this.server_port.setCustomValidity("Port number is required.");
      this.server_port.reportValidity();
      is_valid_form = false;
    }

    if (!is_valid_form) return;

    const projectName = this.dialog.dataset.projectName || "";
    const name = this.server_name.value.trim();
    const path = this.folder_input.value;
    const port = Number(this.server_port.value);

    const [err] = await try_catch(
      SelfServerService.AddLiveServer(projectName, name, path, port),
    );
    if (err) {
      console.error(err);
      return;
    }

    document.dispatchEvent(
      new CustomEvent("project:server-added", {
        detail: { projectName, name, path, port },
      }),
    );

    this.dialog.close("Submit");
  },

  submit_cancel(event) {
    event.preventDefault();
    this.dialog.close("Cancel");
  },
};
