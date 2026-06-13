class TerminalsProcessElement extends HTMLElement {
  cleanup = [];
  connected = false;

  connectedCallback() {
    this.innerHTML = `
      <details class="processes">
          <summary>
              <div class="process__summary">
                  <span class="glyph chevron"></span>
                  <span
                      class="glyph letter-spacing large marker"
                      ></span
                  >
                  <span class="title">terminals</span>
                  <span class="spacer"></span>
                  <span class="counter">0/0</span>
              </div>
          </summary>
          <div></div>
      </details>
      `;
  }

  disconnectedCallback() {}
}

if (!customElements.getName(TerminalsProcessElement)) {
  customElements.define("ss-terminals-process", TerminalsProcessElement);
}
