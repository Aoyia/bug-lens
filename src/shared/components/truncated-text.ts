export class TruncatedText extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["text", "title"];
  }

  private spanEl: HTMLSpanElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: inline-block;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        vertical-align: middle;
      }
      span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    this.spanEl = document.createElement("span");
    shadow.appendChild(style);
    shadow.appendChild(this.spanEl);
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(name: string): void {
    if (name === "text") {
      this.render();
    }
  }

  private render(): void {
    const text = this.getAttribute("text") ?? "";
    if (text && this.spanEl.textContent !== text) {
      this.spanEl.textContent = text;
    }
    const customTitle = this.getAttribute("title");
    if (customTitle) {
      this.title = customTitle;
    } else if (this.spanEl.textContent) {
      this.title = this.spanEl.textContent;
    }
  }

  set textContent(value: string | null) {
    const text = value ?? "";
    if (this.spanEl) {
      this.spanEl.textContent = text;
      if (text && !this.hasAttribute("title")) {
        this.title = text;
      }
    }
  }

  get textContent(): string {
    return this.spanEl?.textContent ?? "";
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("truncated-text")
) {
  customElements.define("truncated-text", TruncatedText);
}
