import { SelfServerService } from "../../bindings/self_server/internal/services";
import { try_catch } from "../helpers/try_catch";

export const dialog_add_project = {
  cleanup: [],

  init() {
    this.dialog = document.getElementById("add-project-dialog");
    this.project_name = document.getElementById("add-project-name");
    this.project_submit = document.getElementById("add-project-submit");
    this.project_cancel = document.getElementById("add-project-cancel");

    this.listen(this.dialog, "close", () => this.close_handler());
    this.listen(this.project_submit, "click", (e) => this.submit_handler(e));
    this.listen(this.project_cancel, "click", (e) => this.submit_cancel(e));
  },

  clean() {
    this.cleanup.forEach((clean_call) => {
      clean_call();
    });
    this.cleanup = [];
  },

  listen(target, type, handler, options) {
    console.assert(!!target, "DIALOG: [Add Project] Target does not exist");
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  },

  close_handler() {
    this.project_name.value = "";
  },

  async submit_handler(event) {
    event.preventDefault();

    let is_valid_form = true;

    if (this.project_name.value.trim() === "") {
      // TODO: this validation causes a flicker in the app
      this.project_name.setCustomValidity("Project name is required.");
      this.project_name.reportValidity();
      is_valid_form = false;
    }

    if (!is_valid_form) return;

    const project_name = this.project_name.value.trim();
    const [err] = await try_catch(
      SelfServerService.AddProject(project_name),
      "Add New Poject",
    );
    if (err) {
      console.error(err);
      return;
    }

    document.dispatchEvent(
      new CustomEvent("project:new", {
        detail: { project_name },
      }),
    );

    this.dialog.close("Submit");
  },

  submit_cancel(event) {
    event.preventDefault();
    this.dialog.close("Cancel");
  },
};
